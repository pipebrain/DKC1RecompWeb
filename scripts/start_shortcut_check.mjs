#!/usr/bin/env node
// Actual Chrome Start-shortcut integration with native keys and injected pads.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {createServer} from 'node:net';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
let rom=null;
for(let i=2;i<process.argv.length;i++){
  if(process.argv[i]==='--rom')rom=resolve(process.argv[++i]);
  else if(process.argv[i]==='--help'){console.log('node scripts/start_shortcut_check.mjs --rom /absolute/game.smc');process.exit(0);}
  else throw new Error(`Unknown option: ${process.argv[i]}`);
}
const stamp=new Date().toISOString().replace(/[:.]/g,'-')+`-${process.pid}`;
const output=join(root,'build/start-shortcut-check',stamp),profile=join(root,'.local/start-shortcut-check-profile',stamp);
await mkdir(output,{recursive:true});await mkdir(profile,{recursive:true});
const RAW_ID='Representative standard controller';
const rawPad={id:RAW_ID,index:0,connected:true,mapping:'standard',buttons:Array.from({length:17},()=>({pressed:false,touched:false,value:0})),axes:[0,0,0,0],timestamp:1};
const report={started:new Date().toISOString(),inputSource:'Real CDP keyboard events and injected standard/raw Gamepad API fixtures; no physical controller tested.',romLoaded:Boolean(rom),checks:[],javascriptErrors:[],consoleErrors:[],result:'running'};
let server,chrome,client,session,origin;
const streams=[];
class CDP{
  constructor(url){
    this.id=1;this.pending=new Map();this.listeners=new Map();this.socket=new WebSocket(url);
    this.ready=new Promise((yes,no)=>{this.socket.addEventListener('open',yes,{once:true});this.socket.addEventListener('error',no,{once:true});});
    this.socket.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.id){const entry=this.pending.get(data.id);if(!entry)return;this.pending.delete(data.id);clearTimeout(entry.timer);data.error?entry.no(new Error(data.error.message)):entry.yes(data.result||{});}else for(const callback of this.listeners.get(data.method)||[])callback(data.params,data.sessionId);});
    this.socket.addEventListener('close',()=>{for(const entry of this.pending.values()){clearTimeout(entry.timer);entry.no(new Error('CDP closed.'));}this.pending.clear();});
  }
  on(name,callback){const callbacks=this.listeners.get(name)||[];callbacks.push(callback);this.listeners.set(name,callbacks);return ()=>{this.listeners.set(name,(this.listeners.get(name)||[]).filter(value=>value!==callback));};}
  event(name,target=session,timeout=30000){return new Promise((yes,no)=>{const cancel=this.on(name,(data,id)=>{if(id!==target)return;clearTimeout(timer);cancel();yes(data);});const timer=setTimeout(()=>{cancel();no(new Error(`Timeout: ${name}`));},timeout);});}
  async send(method,params={},target=session,timeout=60000){await this.ready;const id=this.id++;return new Promise((yes,no)=>{const timer=setTimeout(()=>{this.pending.delete(id);no(new Error(`Timeout: ${method}`));},timeout);this.pending.set(id,{yes,no,timer});const command={id,method,params};if(target)command.sessionId=target;this.socket.send(JSON.stringify(command));});}
}
function log(child,name){const stream=createWriteStream(join(output,name));streams.push(stream);child.stdout?.on('data',data=>stream.write(data));child.stderr?.on('data',data=>stream.write(data));}
async function poll(action,name,timeout=20000){let last;const deadline=Date.now()+timeout;while(Date.now()<deadline){try{const value=await action();if(value)return value;}catch(error){last=error;if(error.fatal)throw error;}await delay(60);}throw new Error(`Timed out: ${name}${last?` (${last.message})`:''}`);}
async function evaluate(expression){const result=await client.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result?.value;}
async function screenshot(name){const result=await client.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});await writeFile(join(output,name),Buffer.from(result.data,'base64'));}
async function unusedPort(){const holder=createServer();await new Promise((yes,no)=>{holder.once('error',no);holder.listen(0,'127.0.0.1',yes);});const value=holder.address().port;await new Promise(yes=>holder.close(yes));return value;}
async function click(selector){await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);await delay(60);}
async function setValue(selector,value){await evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});element.value=${JSON.stringify(String(value))};element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}));})()`);}
async function setFile(selector,path){const {root:document}=await client.send('DOM.getDocument');const {nodeId}=await client.send('DOM.querySelector',{nodeId:document.nodeId,selector});assert(nodeId,`Missing file picker ${selector}`);await client.send('DOM.setFileInputFiles',{nodeId,files:[path]});}
async function loadRom(){await setFile('#rom-file',rom);await poll(async()=>{const value=await evaluate(`({loaded:window.dkcDebug.status().loaded,loading:window.dkcDebug.status().loading,error:document.querySelector('#status').classList.contains('error'),message:document.querySelector('#status').textContent})`);if(value.error&&!value.loading){const error=new Error(value.message);error.fatal=true;throw error;}return value.loaded&&!value.loading;},'ROM initialization',120000);}

const sourceFiles=['web/main.js','web/ui-shell.js','web/start-shortcut.js','web/pause-presentation.js','web/controller-ui.js','web/gamepad-profiles.js','web/keyboard-ui.js','web/keyboard-profiles.js','web/worker.js','web/Help.md','web/dkc.wasm'];
async function sourceHashes(){return Object.fromEntries(await Promise.all(sourceFiles.map(async file=>[file,createHash('sha256').update(await readFile(join(root,file))).digest('hex')])));}
async function settle(){await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');await delay(80);}
async function focus(){await evaluate('document.querySelector("#screen").focus()');await settle();}
async function state(){return evaluate('window.dkcDebug.status()');}
async function paused(label){await settle();assert.equal((await state()).running,false,label);}
async function inputBits(bits,label){await poll(()=>evaluate(`window.__startTest.inputs.at(-1)===${bits}`),label);}
async function resumeCount(){return evaluate('window.__startTest.commands.filter(command=>command.type==="resume").length');}
async function resetRecords(){await evaluate('window.__startTest.commands=[];window.__startTest.inputs=[]');}
async function key(type,code,repeat=false,modifiers=0){
  const names={Enter:['Enter',13],Space:[' ',32],Escape:['Escape',27]};
  const [key,vk]=names[code]||[code.replace(/^Key/,'').toLowerCase(),code.startsWith('Key')?code.charCodeAt(3):0];
  await client.send('Input.dispatchKeyEvent',{type:type==='down'?'rawKeyDown':'keyUp',code,key,windowsVirtualKeyCode:vk,nativeVirtualKeyCode:vk,autoRepeat:repeat,modifiers});await delay(40);
}
async function press(code){await key('down',code);await key('up',code);}
async function menuCommand(menu,command){await click(`[aria-controls="menu-${menu}"]`);await click(`#menu-${menu} [data-command="${command}"]`);}
async function input(){await menuCommand('config','controllers');await poll(()=>evaluate('document.querySelector("#app-settings").open'),'Input sheet');}
async function done(){await click('#settings-done');await poll(()=>evaluate('!document.querySelector("#app-settings").open'),'Input sheet closed');await focus();}
async function pad(buttons=[],{raw=false,connected=true}={}){
  const value=structuredClone(rawPad);value.id=raw?'Representative raw controller':RAW_ID;value.mapping=raw?'':'standard';value.connected=connected;
  for(const index of buttons)value.buttons[index]={pressed:true,touched:true,value:1};
  await evaluate(`window.__startTest.pads=${connected?JSON.stringify([value]):'[]'}`);await settle();
}
async function freshStart(button=9,raw=false){await pad([],{raw});await pad([button],{raw});await poll(async()=>(await state()).running,'gamepad resumes');}
async function keyboardResume(code='Enter'){
  await resetRecords();await key('down',code);await poll(async()=>(await state()).running,'keyboard resumes');
  assert.equal(await resumeCount(),1);await settle();assert.equal(await evaluate('window.__startTest.inputs.some(bits=>(bits&8)!==0)'),false,'Resume Start leaked to game');
  await key('down',code,true);await settle();assert.equal(await resumeCount(),1,'Key repeat reissued resume');assert.equal(await evaluate('window.__startTest.inputs.some(bits=>(bits&8)!==0)'),false,'Repeated resume Start leaked');
  await key('up',code);await settle();
}
async function rawBindStart(){
  await setValue('#controller-bind-action','start');await setValue('#controller-bind-type','button');await setValue('#controller-bind-index',11);await click('#controller-bind-add');
}
try{
  if(!rom)throw new Error('Provide --rom with the verified local ROM.');
  report.sources=await sourceHashes();origin=`http://127.0.0.1:${await unusedPort()}/`;
  server=spawn(process.env.PYTHON||'python3',[join(root,'scripts/serve.py'),'--port',new URL(origin).port],{cwd:root,stdio:['ignore','pipe','pipe']});log(server,'server.log');await poll(async()=>(await fetch(origin)).ok,'local server');
  chrome=spawn(process.env.CHROME_BIN||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--window-size=1440,900','about:blank'],{cwd:root,stdio:['ignore','pipe','pipe']});log(chrome,'chrome.log');
  const endpoint=await poll(async()=>{const [port,path]=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).trim().split('\n');return `ws://127.0.0.1:${port}${path}`;},'Chrome');
  client=new CDP(endpoint);await client.ready;report.browser=await client.send('Browser.getVersion',{},null);
  const target=await client.send('Target.createTarget',{url:'about:blank'},null);session=(await client.send('Target.attachToTarget',{targetId:target.targetId,flatten:true},null)).sessionId;
  client.on('Runtime.exceptionThrown',(data,id)=>{if(id===session)report.javascriptErrors.push(data.exceptionDetails);});
  client.on('Runtime.consoleAPICalled',(data,id)=>{if(id===session&&data.type==='error')report.consoleErrors.push(data.args.map(item=>item.value??item.description).join(' '));});
  await client.send('Page.enable');await client.send('Runtime.enable');await client.send('Emulation.setFocusEmulationEnabled',{enabled:true});report.foregroundFocusEmulation=true;
  await client.send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__startTest={inputs:[],commands:[],pads:[${JSON.stringify(rawPad)}]};Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>window.__startTest.pads});const originalPost=Worker.prototype.postMessage;Worker.prototype.postMessage=function(message,...args){if(message?.type==='input')window.__startTest.inputs.push(message.buttons);if(['resume','pause','input'].includes(message?.type))window.__startTest.commands.push({...message});if(message?.type==='resume'&&window.__startTest.deferWorkerResume)window.__startTest.resumeId=message.id;return originalPost.call(this,message,...args);};const onmessage=Object.getOwnPropertyDescriptor(Worker.prototype,'onmessage');Object.defineProperty(Worker.prototype,'onmessage',{configurable:true,get(){return onmessage.get.call(this)},set(handler){onmessage.set.call(this,event=>{if(window.__startTest.deferWorkerResume&&event.data?.type==='response'&&event.data.id===window.__startTest.resumeId){window.__startTest.finishWorkerResume=()=>handler.call(this,event);return;}handler.call(this,event);});}});`});
  await client.send('Page.navigate',{url:origin});await client.send('Page.bringToFront');await poll(()=>evaluate('Boolean(window.dkcDebug)&&document.querySelector("#status").textContent.startsWith("Ready")'),'host ready');
  await focus();await press('Enter');assert.equal(await resumeCount(),0,'Unloaded Start requested resume');
  await loadRom();await focus();await key('down','Enter',false,2);await paused('Ctrl+Return resumed game');await key('up','Enter');await keyboardResume();
  await key('down','Enter');await inputBits(8,'running Enter reaches SNES');assert.equal((await state()).running,true);await key('up','Enter');await inputBits(0,'running Start release');
  report.checks.push('Default Return quick-starts and is swallowed through key repeat/release; the next press during play reaches SNES Start without host pause.');

  await evaluate('window.dkcDebug.pause()');await focus();await key('down','Enter');await poll(async()=>(await state()).running,'second resume');await evaluate('window.dkcDebug.pause()');await key('down','Enter',true);await paused('Held/repeating Start resumed after pause');await key('up','Enter');await keyboardResume();
  report.checks.push('Pausing while Start is held requires release and a fresh press before another resume.');

  await input();await click('[data-keyboard-learn="start"]');await press('KeyP');assert.equal((await evaluate('window.dkcDebug.keyboard()')).dirty,true);await press('Enter');await paused('Dirty keyboard editor resumed');await click('#settings-done');assert.equal(await evaluate('document.querySelector("#app-settings").open'),true);await click('#keyboard-save');await done();
  await press('Enter');await paused('Old Return binding resumed after remap');await keyboardResume('KeyP');await key('down','KeyP');await inputBits(8,'custom keyboard Start reaches SNES');await key('up','KeyP');await inputBits(0,'custom keyboard Start releases');
  await input();await click('[data-keyboard-learn="start"]');await press('Space');await click('#keyboard-save');await done();await keyboardResume('Space');await key('down','Space');await inputBits(8,'Space mapped Start reaches SNES during play');assert.equal((await state()).running,true);await key('up','Space');await input();await click('[data-keyboard-learn="start"]');await press('KeyP');await click('#keyboard-save');await done();
  await input();await click('[data-keyboard-learn="b"]');await press('KeyP');await paused('Keyboard capture resumed');assert.equal((await evaluate('window.dkcDebug.keyboard()')).captureAction,'b');await press('Escape');await done();
  report.checks.push('Custom keyboard Start replaces Return, including a Space mapping without shortcut conflict; input capture and unsaved settings block quick resume.');

  await click('[aria-controls="menu-config"]');await focus();await key('down','KeyP');await paused('Open menu allowed keyboard resume');await click('[aria-controls="menu-config"]');await focus();await key('down','KeyP',true);await paused('Held keyboard Start resumed after menu close');await key('up','KeyP');
  await pad([9]);await paused('Gamepad resumed while Keyboard was selected');await pad([]);
  await menuCommand('misc','about');await press('KeyP');await paused('About allowed resume');await click('#about-dialog [data-close-about]');await focus();
  report.checks.push('Open menus/About and inactive gamepad source block quick resume.');

  await input();await setValue('#input-source','gamepad');await pad([9]);await done();await paused('Held Start resumed on input-source/sheet transition');await resetRecords();await freshStart();assert.equal(await resumeCount(),1);assert.equal(await evaluate('window.__startTest.inputs.some(bits=>(bits&8)!==0)'),false,'Gamepad resume Start leaked');
  await settle();assert.equal(await resumeCount(),1,'Held gamepad repeatedly requested resume');await pad([]);await pad([9]);await inputBits(8,'running pad Start reaches SNES');assert.equal((await state()).running,true);await press('KeyP');assert.equal((await state()).running,true);await pad([]);await inputBits(0,'pad Start releases');
  report.checks.push('Selected standard gamepad quick-resumes once, consumes Start until release, then passes running Start through; source changes with held Start require release.');

  await evaluate('window.dkcDebug.pause()');await click('[aria-controls="menu-config"]');await pad([9]);await click('[aria-controls="menu-config"]');await focus();await paused('Held Start resumed after menu close');await freshStart();await pad([]);
  await input();await pad([9]);await done();await paused('Held Start resumed after Input close');await freshStart();await pad([]);
  await evaluate('window.dkcDebug.pause()');await pad([],{connected:false});await pad([9]);await focus();await paused('Connected held Start resumed');await freshStart();await pad([]);
  report.checks.push('Gamepad Start held through menu/sheet close or reconnection cannot resume until released.');

  await input();await pad([],{raw:true});await poll(()=>evaluate('window.dkcDebug.controllers().device?.mapping===""'),'raw pad selected');await click('#controller-new');await setValue('#controller-name','Raw Start shortcut fixture');await rawBindStart();await click('#controller-save');await done();
  await pad([9],{raw:true});await paused('Unmapped raw B9 resumed');await resetRecords();await freshStart(11,true);assert.equal(await resumeCount(),1);assert.equal(await evaluate('window.__startTest.inputs.some(bits=>(bits&8)!==0)'),false,'Raw Start resume leaked');await pad([],{raw:true});await pad([11],{raw:true});await inputBits(8,'custom raw B11 reaches SNES while running');await pad([],{raw:true});
  await input();await setValue('#controller-capture-mode','button');await click('[data-controller-listen][data-action="start"]');await pad([11],{raw:true});await paused('Controller capture resumed game');assert.equal((await evaluate('window.dkcDebug.controllers()')).dirty,true);await click('#settings-done');assert.equal(await evaluate('document.querySelector("#app-settings").open'),true);await click('#controller-discard');await done();await paused('Held controller capture resumed after close');await pad([],{raw:true});
  report.checks.push('Custom raw B11 Start is honored; unmapped B9, controller capture, and dirty drafts do not resume.');

  await evaluate('window.dkcDebug.pause()');await evaluate('document.querySelector("[aria-controls=menu-config]").focus()');await pad([11],{raw:true});await paused('Unfocused canvas allowed controller resume');await focus();await paused('Held controller resumed when canvas regained focus');await freshStart(11,true);await pad([],{raw:true});
  await evaluate('window.dkcDebug.pause()');
  const background=await client.send('Target.createTarget',{url:'about:blank'},null),backgroundSession=(await client.send('Target.attachToTarget',{targetId:background.targetId,flatten:true},null)).sessionId;
  await client.send('Page.enable',{},backgroundSession);await client.send('Emulation.setFocusEmulationEnabled',{enabled:false});await client.send('Page.bringToFront',{},backgroundSession);
  await poll(()=>evaluate('document.hidden||!document.hasFocus()'),'real background target');report.backgroundState=await evaluate('({hidden:document.hidden,focused:document.hasFocus()})');
  await evaluate('window.__startTest.pads[0].buttons[11]={pressed:true,touched:true,value:1}');await delay(150);assert.equal((await state()).running,false);
  await client.send('Page.bringToFront');await client.send('Emulation.setFocusEmulationEnabled',{enabled:true});await client.send('Target.closeTarget',{targetId:background.targetId},null);await focus();report.returnedForegroundState=await evaluate('({hidden:document.hidden,focused:document.hasFocus()})');assert(!report.returnedForegroundState.hidden&&report.returnedForegroundState.focused);await paused('Held Start resumed after real target background/return');await freshStart(11,true);await pad([],{raw:true});
  report.checks.push('Actual canvas focus and a real second-target background/return require a fresh Start after returning.');

  await evaluate('window.dkcDebug.pause()');await resetRecords();await pad([],{raw:true});await evaluate('window.__startTest.deferWorkerResume=true');await pad([11],{raw:true});await poll(()=>evaluate('Boolean(window.__startTest.finishWorkerResume)'),'held worker resume response');assert.equal(await resumeCount(),1);
  await evaluate('window.dispatchEvent(new Event("blur"))');await delay(180);await evaluate('window.__startTest.deferWorkerResume=false;window.__startTest.finishWorkerResume()');await delay(180);await paused('Stale resume reply resurrected host state');assert.equal((await evaluate('window.dkcDebug.refresh()')).running,false,'Worker kept running after cancelled dispatched resume');await pad([],{raw:true});await focus();
  report.workerRaceLimit='Dispatch-to-reply cancellation is forced by delaying only the actual worker resume response; cancellation uses an injected blur event.';
  report.checks.push('Blur after worker resume dispatch queues pause; releasing a delayed stale resume response leaves both host and worker paused.');

  await input();await setValue('#input-source','keyboard');await done();await evaluate('window.dkcDebug.enableSound(true)');
  await evaluate(`(()=>{const original=AudioContext.prototype.resume;window.__startTest.originalAudioResume=original;AudioContext.prototype.resume=function(){if(window.__startTest.deferAudio){window.__startTest.audioCalls=(window.__startTest.audioCalls||0)+1;return new Promise(resolve=>window.__startTest.finishAudio=()=>original.call(this).then(resolve));}return original.call(this);};window.__startTest.deferAudio=true;})()`);
  await resetRecords();await key('down','KeyP');await poll(()=>evaluate('Boolean(window.__startTest.finishAudio)'),'deferred audio resume');await key('down','KeyP',true);assert.equal(await evaluate('window.__startTest.audioCalls'),1,'Repeated key duplicated pending audio resume');await input();await evaluate('window.__startTest.deferAudio=false;window.__startTest.finishAudio()');await key('up','KeyP');await paused('Stale audio completion resumed behind settings');assert.equal(await resumeCount(),0,'Stale resume reached worker');await done();await keyboardResume('KeyP');
  await evaluate('AudioContext.prototype.resume=window.__startTest.originalAudioResume');await evaluate('window.dkcDebug.enableSound(false)');
  report.checks.push('An in-flight audio resume is issued once and cancelled by opening Settings; completing audio later cannot resume behind the sheet.');

  await evaluate('window.dkcDebug.pause()');await screenshot('paused.png');report.finalState=await state();report.sourcesAfter=await sourceHashes();report.sourceUnchanged=JSON.stringify(report.sources)===JSON.stringify(report.sourcesAfter);assert(report.sourceUnchanged,'Production source changed during verification.');assert.equal(report.javascriptErrors.length,0);assert.equal(report.consoleErrors.length,0);report.result='passed';
}catch(error){report.result='failed';report.error={message:error.message,stack:error.stack};process.exitCode=1;if(client&&session)try{report.failureState=await evaluate('({keyboard:window.dkcDebug?.keyboard(),controllers:window.dkcDebug?.controllers(),state:window.dkcDebug?.status(),active:document.activeElement?.outerHTML,input:window.__startTest?.inputs.slice(-12),commands:window.__startTest?.commands.slice(-20)})');await screenshot('failure.png');}catch{}}
finally{
  if(client){try{await client.send('Browser.close',{},null,5000);}catch{}client.socket.close();}if(chrome?.exitCode===null){await Promise.race([new Promise(yes=>chrome.once('exit',yes)),delay(3000)]);if(chrome.exitCode===null)chrome.kill('SIGTERM');}for(const stream of streams)stream.end();if(server?.exitCode===null)server.kill('SIGTERM');await rm(profile,{recursive:true,force:true,maxRetries:4,retryDelay:100}).catch(()=>{});report.finished=new Date().toISOString();await writeFile(join(output,'evidence.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({result:report.result,checks:report.checks,error:report.error?.message,evidence:join(output,'evidence.json')},null,2));
}
