#!/usr/bin/env node
// Node 22+ and Chrome only. No npm packages; the page receives its ROM by file picker.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createWriteStream} from 'node:fs';
import {mkdir,readFile,writeFile,rm,stat} from 'node:fs/promises';
import {createServer} from 'node:net';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const NATIVE_FRAMES={
  600:'a7366146a96b47e75d48d3814bfe0859c71f68bcc3fac3d7429befb9b50430dd',
  1800:'11ff5115d6bd6ea09175e7b44f5290387b07164bdd9f0b8118f78ad422de56f8',
  3600:'7e6fee75bf9eada584bc414d140805999cd635baacea7d6bedbf1156551bce24',
  5100:'60878dca94a5a87f77729991bdd301e211e94738ec1fb1556812aa4b5f63ff70',
};
const options={frames:600,smoke:false,rom:null,input:null,expectedFrame:null};
for(let i=2;i<process.argv.length;i++){
  const arg=process.argv[i];
  if(arg==='--smoke')options.smoke=true;
  else if(arg==='--rom')options.rom=resolve(process.argv[++i]||'');
  else if(arg==='--input')options.input=resolve(process.argv[++i]||'');
  else if(arg==='--expected-frame')options.expectedFrame=(process.argv[++i]||'').toLowerCase();
  else if(arg==='--frames')options.frames=Number(process.argv[++i]);
  else if(arg==='--help'){console.log('node scripts/browser_check.mjs --smoke\nnode scripts/browser_check.mjs --rom /absolute/game.smc [--frames 600] [--input /absolute/masks.txt] [--expected-frame SHA256]\nInput: one hex joypad mask per line; # or // comments and hex*decimal-count runs are accepted.');process.exit(0);}
  else throw new Error(`Unknown argument: ${arg}`);
}
if(!options.smoke&&!options.rom)throw new Error('--rom is required unless --smoke is selected.');
if(!Number.isInteger(options.frames)||options.frames<0||options.frames>100000)throw new Error('--frames must be an integer from 0 to 100,000.');
if(options.expectedFrame!==null&&!/^[0-9a-f]{64}$/.test(options.expectedFrame))throw new Error('--expected-frame must contain exactly 64 hexadecimal characters.');
if(options.smoke&&(options.input||options.expectedFrame))throw new Error('--input and --expected-frame require a game check, not --smoke.');
if(options.rom)await stat(options.rom);
let inputRuns=null,inputSummary=null;
if(options.input){
  const text=await readFile(options.input,'utf8');inputRuns=[];let totalFrames=0;
  for(const [index,raw] of text.split(/\r?\n/).entries()){
    const line=raw.replace(/#.*$|\/\/.*$/g,'').trim();if(!line)continue;
    const match=/^(?:0x)?([0-9a-f]{1,3})(?:\s*\*\s*([0-9]+))?$/i.exec(line);
    if(!match)throw new Error(`Invalid input schedule at line ${index+1}: expected a hex mask or hex*decimal-count.`);
    const buttons=Number.parseInt(match[1],16),count=match[2]?Number(match[2]):1;
    if(buttons>4095||!Number.isSafeInteger(count)||count<1||totalFrames+count>100000)throw new Error(`Invalid input mask or run length at line ${index+1}.`);
    totalFrames+=count;
    const previous=inputRuns.at(-1);if(previous?.buttons===buttons)previous.count+=count;else inputRuns.push({buttons,count});
  }
  assert.equal(totalFrames,options.frames,'Input schedule frame count must equal --frames.');
  inputSummary={path:options.input,totalFrames,runs:inputRuns.length,sha256:createHash('sha256').update(text).digest('hex')};
}
if(typeof WebSocket!=='function')throw new Error('Use Node 22 or newer with its built-in WebSocket.');
const stamp=new Date().toISOString().replace(/[:.]/g,'-')+`-${process.pid}`;
const output=join(root,'build','browser-check',stamp);
const profileRoot=join(root,'.local','chrome-check-profile',stamp);
await mkdir(output,{recursive:true});await mkdir(profileRoot,{recursive:true});
const report={started:new Date().toISOString(),mode:options.smoke?'smoke':'game',framesRequested:options.frames,input:inputSummary,expectedFrame:options.expectedFrame,attempts:[],checks:[],javascriptErrors:[],consoleErrors:[],result:'running'};
let server=null,chrome=null,client=null,session=null,originalSave=null,origin=null,profile=null;
const streams=[];
const sourceFiles=['scripts/serve.py','web/index.html','web/style.css','web/main.js','web/ui-shell.js','web/start-shortcut.js','web/pause-presentation.js','web/controller-ui.js','web/gamepad-profiles.js','web/keyboard-ui.js','web/keyboard-profiles.js','web/content-pages.js','web/About.md','web/Help.md','web/worker.js','web/audio-worklet.js','web/graphics.js','web/dkc.wasm'];
async function sourceHashes(){return Object.fromEntries(await Promise.all(sourceFiles.map(async file=>[file,createHash('sha256').update(await readFile(join(root,file))).digest('hex')])));}

class CDP{
  constructor(url){
    this.next=1;this.pending=new Map();this.listeners=new Map();this.socket=new WebSocket(url);
    this.ready=new Promise((resolve,reject)=>{this.socket.addEventListener('open',resolve,{once:true});this.socket.addEventListener('error',()=>reject(new Error('CDP WebSocket failed.')),{once:true});});
    this.socket.addEventListener('message',event=>{
      const message=JSON.parse(event.data);
      if(message.id){const task=this.pending.get(message.id);if(!task)return;this.pending.delete(message.id);clearTimeout(task.timer);message.error?task.reject(new Error(`${task.method}: ${message.error.message}`)):task.resolve(message.result||{});}
      else for(const callback of this.listeners.get(message.method)||[])callback(message.params,message.sessionId);
    });
    this.socket.addEventListener('close',()=>{for(const task of this.pending.values()){clearTimeout(task.timer);task.reject(new Error(`CDP closed during ${task.method}`));}this.pending.clear();});
  }
  on(method,callback){const list=this.listeners.get(method)||[];list.push(callback);this.listeners.set(method,list);return ()=>{const current=this.listeners.get(method)||[];this.listeners.set(method,current.filter(value=>value!==callback));};}
  event(method,sessionId,timeout=30000){return new Promise((resolve,reject)=>{const cancel=this.on(method,(data,id)=>{if(id!==sessionId)return;clearTimeout(timer);cancel();resolve(data);});const timer=setTimeout(()=>{cancel();reject(new Error(`CDP event timeout: ${method}`));},timeout);});}
  async send(method,params={},sessionId=null,timeout=120000){
    await this.ready;const id=this.next++;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`CDP timeout: ${method}`));},timeout);this.pending.set(id,{resolve,reject,timer,method});const message={id,method,params};if(sessionId)message.sessionId=sessionId;this.socket.send(JSON.stringify(message));});
  }
  close(){this.socket.close();}
}
function logProcess(child,name){
  const stream=createWriteStream(join(output,name));streams.push(stream);
  child.stdout?.on('data',data=>stream.write(data));child.stderr?.on('data',data=>stream.write(data));
}
async function unusedPort(){const holder=createServer();await new Promise((yes,no)=>{holder.once('error',no);holder.listen(0,'127.0.0.1',yes);});const port=holder.address().port;await new Promise(resolve=>holder.close(resolve));return port;}
async function poll(action,description,timeout=15000){
  const end=Date.now()+timeout;let last;
  while(Date.now()<end){try{const value=await action();if(value)return value;}catch(error){if(error.fatal)throw error;last=error;}await delay(75);}
  throw new Error(`Timed out waiting for ${description}${last?`: ${last.message}`:''}`);
}
async function evaluate(expression,timeout=120000){
  const result=await client.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true},session,timeout);
  if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
  return result.result?.value;
}
async function waitReady(){
  await poll(()=>evaluate(`Boolean(window.dkcDebug && document.querySelector('#status'))`),'browser host script');
  await poll(()=>evaluate(`document.querySelector('#status').textContent!=='Checking WebGPU…'`),'WebGPU initialization',30000);
  const status=await evaluate(`({message:document.querySelector('#status').textContent,error:document.querySelector('#status').classList.contains('error'),debug:window.dkcDebug.status()})`);
  return status;
}
async function screenshot(name){
  const result=await client.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false},session);
  await writeFile(join(output,name),Buffer.from(result.data,'base64'));
}
async function closeChrome(){
  if(client){try{await client.send('Browser.close',{},null,5000);}catch{}client.close();client=null;}
  if(chrome){const child=chrome;chrome=null;if(child.exitCode===null)await Promise.race([new Promise(resolve=>child.once('exit',resolve)),delay(5000)]);if(child.exitCode===null){child.kill('SIGTERM');await Promise.race([new Promise(resolve=>child.once('exit',resolve)),delay(2000)]);}}
  session=null;
}
async function launch(extraFlags,attempt){
  profile=join(profileRoot,String(attempt));await mkdir(profile,{recursive:true});
  const flags=['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--window-size=1280,1100',...extraFlags,'about:blank'];
  const binary=process.env.CHROME_BIN||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  chrome=spawn(binary,flags,{cwd:root,stdio:['ignore','pipe','pipe']});logProcess(chrome,`chrome-${attempt}.log`);
  let launchError=null;chrome.once('error',error=>{launchError=error;});
  const active=await poll(async()=>{if(launchError)throw launchError;if(chrome.exitCode!==null)throw new Error(`Chrome exited ${chrome.exitCode}`);const file=await readFile(join(profile,'DevToolsActivePort'),'utf8');const [port,path]=file.trim().split('\n');return port&&path?`ws://127.0.0.1:${port}${path}`:false;},'Chrome DevTools endpoint',30000);
  client=new CDP(active);await client.ready;
  const attemptReport={flags,binary,version:await client.send('Browser.getVersion'),webgpu:null,network:[],lifecycle:[]};report.attempts.push(attemptReport);
  client.on('Runtime.exceptionThrown',(data,id)=>{if(id===session)report.javascriptErrors.push(data.exceptionDetails);});
  client.on('Runtime.consoleAPICalled',(data,id)=>{if(id===session&&data.type==='error')report.consoleErrors.push(data.args.map(a=>a.value??a.description).join(' '));});
  const target=await client.send('Target.createTarget',{url:'about:blank'});
  const attached=await client.send('Target.attachToTarget',{targetId:target.targetId,flatten:true});session=attached.sessionId;
  await client.send('Runtime.enable',{},session);await client.send('Page.enable',{},session);
  await client.send('Network.enable',{},session);
  await client.send('Page.setLifecycleEventsEnabled',{enabled:true},session);
  client.on('Network.requestWillBeSent',(data,id)=>{if(id===session)attemptReport.network.push({event:'request',id:data.requestId,url:data.request.url,type:data.type});});
  client.on('Network.loadingFinished',(data,id)=>{if(id===session)attemptReport.network.push({event:'finished',id:data.requestId});});
  client.on('Network.loadingFailed',(data,id)=>{if(id===session)attemptReport.network.push({event:'failed',id:data.requestId,error:data.errorText,canceled:data.canceled});});
  client.on('Page.lifecycleEvent',(data,id)=>{if(id===session)attemptReport.lifecycle.push({name:data.name,timestamp:data.timestamp});});
  // Keep this isolated headless target foreground-visible while exercising
  // real-time audio and input. Normal app visibility handling is unchanged.
  await client.send('Emulation.setFocusEmulationEnabled',{enabled:true},session);
  attemptReport.foregroundFocusEmulation=true;
  await client.send('Emulation.setDeviceMetricsOverride',{width:1280,height:1100,deviceScaleFactor:1,mobile:false},session);
  await client.send('Page.navigate',{url:origin},session);
  await client.send('Page.bringToFront',{},session);
  const ready=await waitReady();
  attemptReport.webgpu=await evaluate(`(async()=>{const adapter=await navigator.gpu?.requestAdapter();return {secureContext:isSecureContext,available:Boolean(navigator.gpu),adapter:Boolean(adapter),info:adapter?{vendor:adapter.info.vendor,architecture:adapter.info.architecture,device:adapter.info.device,description:adapter.info.description}:null,status:document.querySelector('#status').textContent};})()`);
  attemptReport.ready=ready;
  try{attemptReport.systemGpu=(await client.send('SystemInfo.getInfo')).gpu;}catch(error){attemptReport.systemGpuError=error.message;}
  return ready;
}
async function selectRom(){
  const {root:document}=await client.send('DOM.getDocument',{},session);
  const {nodeId}=await client.send('DOM.querySelector',{nodeId:document.nodeId,selector:'#rom-file'},session);
  assert(nodeId,'ROM picker is missing.');
  await client.send('DOM.setFileInputFiles',{files:[options.rom],nodeId},session);
  await poll(async()=>{
    const value=await evaluate(`({debug:window.dkcDebug.status(),message:document.querySelector('#status').textContent,error:document.querySelector('#status').classList.contains('error')})`);
    if(value.error&&!value.debug.loading){const error=new Error(value.message);error.fatal=true;throw error;}
    return value.debug.loaded&&!value.debug.loading?value:false;
  },'verified ROM and standalone Wasm initialization',180000);
  const state=await evaluate('window.dkcDebug.status()');assert.equal(state.running,false,'ROM should initialize paused.');return state;
}
async function reloadAndSelect(){const loaded=client.event('Page.loadEventFired',session);await client.send('Page.reload',{ignoreCache:true},session);await loaded;await poll(()=>evaluate(`document.readyState==='complete' && Boolean(window.dkcDebug)`),'page reload',30000);const ready=await waitReady();assert(!ready.error,ready.message);return selectRom();}
function bytesEqual(actual,expected,message){assert.deepEqual(actual,expected,message);}

try{
  report.sources=await sourceHashes();
  const port=await unusedPort();origin=`http://127.0.0.1:${port}/`;
  server=spawn(process.env.PYTHON||'python3',[join(root,'scripts','serve.py'),'--port',String(port)],{cwd:root,stdio:['ignore','pipe','pipe']});logProcess(server,'server.log');
  await poll(async()=>{const response=await fetch(origin);return response.ok;},'localhost web-root server');
  let ready=await launch([],1);
  if(!report.attempts.at(-1).webgpu.adapter){
    await screenshot('standard-flags.png');await closeChrome();
    ready=await launch(['--enable-unsafe-webgpu'],2);
    report.unsafeWebgpuFlagRequired=true;
  }else report.unsafeWebgpuFlagRequired=false;
  assert(report.attempts.at(-1).webgpu.adapter,'WebGPU adapter is unavailable even with the explicit fallback flag.');
  assert(!ready.error,ready.message);assert.match(ready.message,/Ready/);
  report.checks.push('Handwritten host loads and obtains a WebGPU adapter.');
  await screenshot('ready.png');
  if(!options.smoke){
    report.initial=await selectRom();report.imports=report.initial.imports;
    assert.equal(report.initial.loaded,true);assert.equal(report.initial.running,false);
    report.checks.push('ROM picker verifies supported local ROM and initializes standalone Wasm paused.');
    if(inputRuns){
      for(const run of inputRuns)report.run=await evaluate(`window.dkcDebug.runFrames(${run.count},${run.buttons})`);
      if(!inputRuns.length)report.run=await evaluate('window.dkcDebug.refresh()');
      assert.equal(report.run.frameCount,options.frames,'Replayed input schedule did not produce exactly --frames frames.');
      report.checks.push(`Exact ${options.frames}-frame input schedule replayed in ${inputRuns.length} runs.`);
    }else report.run=await evaluate(`window.dkcDebug.runFrames(${options.frames},0)`);
    report.frame=await evaluate('window.dkcDebug.frameHash()');assert.equal(report.frame.frameCount,options.frames);
    const expectedFrame=options.expectedFrame||(!inputRuns&&NATIVE_FRAMES[options.frames]);
    if(expectedFrame){assert.equal(report.frame.sha256,expectedFrame,`${options.frames}-frame framebuffer differs from native oracle.`);report.checks.push(`${options.frames}-frame browser framebuffer matches the native oracle.`);}
    await poll(()=>evaluate(`window.dkcDebug.status().presentedFrame>=${options.frames}`),'WebGPU presentation of final frame');
    await screenshot('game.png');
    originalSave=await evaluate('window.dkcDebug.saveBytes()');assert.equal(originalSave.length,2048);
    const invalid=await evaluate(`(async()=>{try{await window.dkcDebug.importSave([1,2]);return false;}catch(error){return /2,048/.test(error.message);}})()`);
    assert(invalid,'Incorrectly sized SRAM was not rejected.');
    bytesEqual(await evaluate('window.dkcDebug.saveBytes()'),originalSave,'Rejected SRAM import changed memory.');
    const sentinel=[...originalSave];sentinel[2047]^=0x5a;
    await evaluate(`(async()=>{await window.dkcDebug.importSave(${JSON.stringify(sentinel)});await window.dkcDebug.flushSaves();})()`);
    bytesEqual(await evaluate('window.dkcDebug.saveBytes()'),sentinel,'SRAM import/export round trip failed.');
    await reloadAndSelect();bytesEqual(await evaluate('window.dkcDebug.saveBytes()'),sentinel,'IndexedDB SRAM did not survive page reload.');
    await evaluate(`(async()=>{await window.dkcDebug.importSave(${JSON.stringify(originalSave)});await window.dkcDebug.flushSaves();})()`);
    await reloadAndSelect();bytesEqual(await evaluate('window.dkcDebug.saveBytes()'),originalSave,'Original SRAM was not restored persistently.');
    report.saveRestored=true;originalSave=null;report.checks.push('2,048-byte SRAM import/export and IndexedDB page-reload persistence; original bytes restored.');
    const before=await evaluate('window.dkcDebug.refresh()');
    await evaluate('window.dkcDebug.enableSound(true)');
    await evaluate('window.dkcDebug.resume()');await delay(1800);
    const playing=await evaluate('window.dkcDebug.status()');
    const paused=await evaluate('window.dkcDebug.pause()');
    await evaluate('window.dkcDebug.enableSound(false)');
    assert.equal(playing.sound,true,'Sound was not enabled.');
    assert.equal(playing.audioContextState,'running','AudioContext did not run.');
    assert.equal(playing.audioStats.type,'audio-stats','AudioWorklet did not report processing during real-time play.');
    for(const key of ['queuedFrames','underruns','overruns'])assert(Number.isInteger(playing.audioStats[key])&&playing.audioStats[key]>=0,`AudioWorklet did not report a valid ${key} count.`);
    report.audio={contextState:playing.audioContextState,stats:playing.audioStats,observationMs:1800,listeningQualityAssessed:false};
    report.checks.push('AudioContext and PCM AudioWorklet run during play and report queue/underrun/overrun counters; sound reset afterward.');
    assert.equal(await evaluate('window.dkcDebug.status().sound'),false,'Sound did not disable after the audio check.');
    assert(paused.frameCount>before.frameCount,'Resume did not advance game frames.');assert(paused.frameCount-before.frameCount<240,'Fixed-step game ran implausibly fast.');
    await delay(200);const still=await evaluate('window.dkcDebug.refresh()');assert.equal(still.frameCount,paused.frameCount,'Game advanced while paused.');
    report.pacing={framesAdvanced:paused.frameCount-before.frameCount,pausedFrame:paused.frameCount};report.checks.push('Resume advances bounded fixed steps; paused game remains at the same frame.');
    report.final=await evaluate('window.dkcDebug.status()');await screenshot('final.png');
  }
  assert.equal(report.javascriptErrors.length,0,'Page raised JavaScript exceptions.');assert.equal(report.consoleErrors.length,0,'Page logged JavaScript errors.');
  report.sourcesAfter=await sourceHashes();report.sourceUnchanged=JSON.stringify(report.sources)===JSON.stringify(report.sourcesAfter);
  assert(report.sourceUnchanged,'Production source changed during browser verification.');
  report.result='passed';
}catch(error){
  report.result='failed';report.error={message:error.message,stack:error.stack};process.exitCode=1;
  if(client&&session)try{report.failureState=await evaluate(`({url:location.href,ready:document.readyState,visibility:document.visibilityState,focused:document.hasFocus(),message:document.querySelector('#status')?.textContent,debug:window.dkcDebug?.status(),resources:performance.getEntriesByType('resource').map(value=>({name:value.name,duration:value.duration,transferSize:value.transferSize}))})`);await screenshot('failure.png');}catch{}
}finally{
  if(originalSave&&client&&session){try{await evaluate(`(async()=>{await window.dkcDebug.pause();await window.dkcDebug.importSave(${JSON.stringify(originalSave)});await window.dkcDebug.flushSaves();})()`);report.saveRestored=true;}catch(error){report.restoreError=error.message;}}
  await closeChrome();
  if(server){const child=server;server=null;if(child.exitCode===null){child.kill('SIGINT');await Promise.race([new Promise(resolve=>child.once('exit',resolve)),delay(3000)]);}if(child.exitCode===null)child.kill('SIGTERM');}
  await rm(profileRoot,{recursive:true,force:true});report.isolatedProfileRemoved=true;
  for(const stream of streams)stream.end();
  report.finished=new Date().toISOString();report.output=output;
  await writeFile(join(output,'evidence.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({result:report.result,mode:report.mode,unsafeWebgpuFlagRequired:report.unsafeWebgpuFlagRequired,checks:report.checks,error:report.error?.message,evidence:join(output,'evidence.json')},null,2));
}
