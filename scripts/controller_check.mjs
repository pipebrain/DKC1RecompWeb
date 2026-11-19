#!/usr/bin/env node
// Browser regression with injected representative inputs, not physical hardware.
import assert from 'node:assert/strict';
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
  else if(process.argv[i]==='--help'){console.log('node scripts/controller_check.mjs [--rom /absolute/game.smc]');process.exit(0);}
  else throw new Error(`Unknown option: ${process.argv[i]}`);
}
const stamp=new Date().toISOString().replace(/[:.]/g,'-')+`-${process.pid}`;
const output=join(root,'build/controller-check',stamp),profile=join(root,'.local/controller-check-profile',stamp);
await mkdir(output,{recursive:true});await mkdir(profile,{recursive:true});
const RAW_ID='8BitDo SN30 Pro+ (Vendor: 2dc8 Product: 6102)';
const rawPad={id:RAW_ID,index:0,connected:true,mapping:'',buttons:Array.from({length:12},()=>({pressed:false,touched:false,value:0})),axes:[0,0,0,0,0,0,0,0,0,23/7],timestamp:1};
const report={started:new Date().toISOString(),inputSource:'Injected representative standard/raw Gamepad API fixtures; no physical controller tested.',romLoaded:Boolean(rom),checks:[],javascriptErrors:[],consoleErrors:[],result:'running'};
let server,chrome,client,session,origin,originalSram;
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
async function controllers(){return evaluate('window.dkcDebug.controllers()');}
async function openPanel(){await click('[aria-controls="menu-config"]');await click('#menu-config [data-command="controllers"]');await poll(()=>evaluate('document.querySelector("#app-settings").open'),'Input settings open');if(await evaluate('document.querySelector("#input-source").value!=="gamepad"'))await setValue('#input-source','gamepad');await poll(async()=>Boolean((await controllers()).open),'controller panel open');}
async function closePanel(){await click('#settings-done');await poll(async()=>!(await controllers()).open,'controller panel close');}
async function snapshot(pad){await evaluate(`window.__controllerTest.pads=${JSON.stringify(pad?[pad]:[])}`);await delay(100);}
function raw(buttons=[],axes={}){const pad=structuredClone(rawPad);for(const index of buttons)pad.buttons[index]={pressed:true,touched:true,value:1};for(const [index,value]of Object.entries(axes))pad.axes[index]=value;return pad;}
async function expectInput(bits,label){await poll(()=>evaluate(`window.__controllerTest.inputs.at(-1)===${bits}`),label);assert.equal((await controllers()).outputBits,bits,label);}
async function bind(action,type,index,extra={}){
  await setValue('#controller-bind-action',action);await setValue('#controller-bind-type',type);await setValue('#controller-bind-index',index);
  if(type==='axis-negative'||type==='axis-positive'){await setValue('#controller-bind-rest',extra.rest??0);await setValue('#controller-bind-threshold',extra.threshold??.35);}
  if(type==='axis-value'){await setValue('#controller-bind-value',extra.value??0);await setValue('#controller-bind-tolerance',extra.tolerance??.08);}
  await click('#controller-bind-add');
}
async function setFile(selector,path){const {root:document}=await client.send('DOM.getDocument');const {nodeId}=await client.send('DOM.querySelector',{nodeId:document.nodeId,selector});assert(nodeId,`Missing file picker ${selector}`);await client.send('DOM.setFileInputFiles',{nodeId,files:[path]});}
async function loadRom(){await setFile('#rom-file',rom);await poll(async()=>{const value=await evaluate(`({loaded:window.dkcDebug.status().loaded,loading:window.dkcDebug.status().loading,error:document.querySelector('#status').classList.contains('error'),message:document.querySelector('#status').textContent})`);if(value.error&&!value.loading){const error=new Error(value.message);error.fatal=true;throw error;}return value.loaded&&!value.loading;},'ROM initialization',120000);}
async function reload(){const loaded=client.event('Page.loadEventFired');await client.send('Page.reload',{ignoreCache:true});await loaded;await poll(()=>evaluate(`document.readyState==='complete'&&Boolean(window.dkcDebug?.controllers)&&document.querySelector('#status').textContent.startsWith('Ready')`),'reloaded controller host');}

try{
  origin=`http://127.0.0.1:${await unusedPort()}/`;
  server=spawn(process.env.PYTHON||'python3',[join(root,'scripts/serve.py'),'--port',new URL(origin).port],{cwd:root,stdio:['ignore','pipe','pipe']});log(server,'server.log');
  await poll(async()=>{const response=await fetch(origin);return response.ok;},'local server');
  chrome=spawn(process.env.CHROME_BIN||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--window-size=1280,1000','about:blank'],{cwd:root,stdio:['ignore','pipe','pipe']});log(chrome,'chrome.log');
  const endpoint=await poll(async()=>{const [p,path]=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).trim().split('\n');return `ws://127.0.0.1:${p}${path}`;},'Chrome');
  client=new CDP(endpoint);await client.ready;report.browser=await client.send('Browser.getVersion',{},null);
  const target=await client.send('Target.createTarget',{url:'about:blank'},null);session=(await client.send('Target.attachToTarget',{targetId:target.targetId,flatten:true},null)).sessionId;
  client.on('Runtime.exceptionThrown',(data,id)=>{if(id===session)report.javascriptErrors.push(data.exceptionDetails);});
  client.on('Runtime.consoleAPICalled',(data,id)=>{if(id===session&&data.type==='error')report.consoleErrors.push(data.args.map(item=>item.value??item.description).join(' '));});
  await client.send('Page.enable');await client.send('Runtime.enable');await client.send('Network.enable');report.networkFailures=[];client.on('Network.loadingFailed',(data,id)=>{if(id===session)report.networkFailures.push(data);});
  await client.send('Emulation.setFocusEmulationEnabled',{enabled:true});await client.send('Page.bringToFront');report.foregroundFocusEmulation=true;
  await client.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:output,eventsEnabled:true},null);
  const downloads=[];client.on('Browser.downloadWillBegin',data=>downloads.push(data));
  await client.send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__controllerTest={pads:[${JSON.stringify(rawPad)}],inputs:[],exports:[]};Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>window.__controllerTest.pads});const originalWorkerPost=Worker.prototype.postMessage;Worker.prototype.postMessage=function(message,...rest){if(message?.type==='input')window.__controllerTest.inputs.push(message.buttons);return originalWorkerPost.call(this,message,...rest);};const originalURL=URL.createObjectURL;URL.createObjectURL=function(object){if(object instanceof Blob)object.text().then(text=>window.__controllerTest.exports.push({text,type:object.type}));return originalURL.call(this,object);};`});
  await client.send('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
  await client.send('Page.navigate',{url:origin});
  await poll(()=>evaluate(`Boolean(window.dkcDebug?.controllers&&document.querySelector('#status').textContent.startsWith('Ready'))`),'controller host');
  await openPanel();await closePanel();
  await poll(async()=>(await controllers()).device?.id===RAW_ID,'raw controller discovery');
  assert.equal((await controllers()).device.mapping,'');
  report.checks.push('Representative raw controller is discovered and displayed despite mapping="".');
  if(rom){await loadRom();await evaluate('window.dkcDebug.runFrames(600,0)');assert.equal((await evaluate('window.dkcDebug.frameHash()')).sha256,'a7366146a96b47e75d48d3814bfe0859c71f68bcc3fac3d7429befb9b50430dd');}
  const standard={...structuredClone(rawPad),id:'Representative standard controller',mapping:'standard',buttons:Array.from({length:17},()=>({pressed:false,touched:false,value:0})),axes:[0,0,0,0]};
  await snapshot(standard);await poll(async()=>(await controllers()).device?.id===standard.id,'standard controller selection');
  standard.buttons[0]={pressed:true,touched:true,value:1};await snapshot(standard);await expectInput(1,'unchanged standard B button reaches worker');
  standard.buttons[0]={pressed:false,touched:false,value:0};await snapshot(standard);await expectInput(0,'standard release reaches worker');
  await openPanel();assert.equal((await controllers()).profile.id,'standard');
  assert.equal(await evaluate(`document.querySelector('#controller-name').disabled&&document.querySelector('#controller-save').disabled`),true,'Built-in profile is editable.');
  await click('#controller-export');await poll(()=>evaluate('window.__controllerTest.exports.length>0'),'default profile export');
  report.defaultExport=JSON.parse((await evaluate('window.__controllerTest.exports.at(-1)')).text);
  assert.notEqual(report.defaultExport.id,'standard','Default export must be an importable custom copy.');
  assert.equal(await evaluate(`(async()=>{const {parseProfile}=await import('./gamepad-profiles.js');return parseProfile(window.__controllerTest.exports.at(-1).text).version;})()`),1);
  assert.equal((await controllers()).profile.id,'standard','Export changed the active default profile.');
  await evaluate('window.__controllerTest.exports=[]');await closePanel();
  report.checks.push('Built-in standard mapping stays read-only, retains button/release behavior, and exports an importable custom copy.');
  await snapshot(raw());await poll(async()=>(await controllers()).device?.id===RAW_ID,'raw controller re-selection');
  await openPanel();await click('#controller-new');await setValue('#controller-name','SN30 representative raw');await click('.controller-manual > summary');
  for(const [action,index]of [['b',0],['y',7],['select',10],['start',11]])await bind(action,'button',index);
  await bind('left','axis-negative',0);await bind('right','axis-positive',0);await bind('up','axis-negative',1);await bind('down','axis-positive',1);
  await bind('l','axis-positive',2);await bind('r','axis-negative',5);
  for(const action of ['up','right','down','left'])await bind(action,`hat-${action}`,9);
  await bind('x','axis-value',9,{value:0,tolerance:.05});
  await setValue('#controller-capture-mode','button');await click('[data-controller-listen][data-action="a"]');
  await poll(async()=>Boolean((await controllers()).capturing),'button capture begins');await snapshot(raw([2]));
  await poll(async()=>!(await controllers()).capturing,'button capture commits');await snapshot(raw());
  const draft=await controllers();assert(draft.dirty,'Profile bindings were not marked unsaved.');assert.equal(draft.profile.name,'SN30 representative raw');
  await click('#settings-done');assert.equal((await controllers()).open,true,'Unsaved profile was silently discarded on close.');
  await click('#controller-save');await poll(async()=>!(await controllers()).dirty,'profile save');
  const saved=await controllers();report.savedProfile=saved.profile;
  assert(saved.savedProfiles.some(item=>item.name==='SN30 representative raw'));
  await evaluate(`document.querySelector('#controller-panel').scrollIntoView({block:'start'})`);await screenshot('profile-editor.png');await closePanel();
  await evaluate(`document.querySelector('#screen').focus({preventScroll:true})`);assert.equal(await evaluate(`document.activeElement===document.querySelector('#screen')`),true);
  await snapshot(raw([0,7,10,11]));await expectInput(15,'raw B0/B7/B10/B11 mapping reaches worker');
  await snapshot(raw([2]));await expectInput(256,'learned button binding reaches worker');
  await snapshot(raw([],{0:.7,1:-.7}));await expectInput(144,'raw stick diagonal reaches worker');
  await snapshot(raw([],{0:.2,1:-.2}));await expectInput(0,'deadzone suppresses analog drift');
  await snapshot(raw([],{2:.8,5:-.8}));await expectInput(3072,'nonstandard axes2 and5 reach worker');
  await snapshot(raw([],{9:-5/7}));await expectInput(144,'8-way hat diagonal activates Up and Right');
  await snapshot(raw([],{9:0}));await expectInput(512,'exact axis-value binding supports arbitrary hat conventions');
  await snapshot(raw());await expectInput(0,'out-of-range hat neutral releases all controls');
  await snapshot(null);await expectInput(0,'disconnect releases input');await snapshot(raw());
  report.checks.push('Custom raw button, learned button, signed axes0/1/2/5, deadzone, exact axis values, hat diagonal/neutral, and disconnect masks reach the actual worker input boundary.');
  if(rom){
    await evaluate('window.dkcDebug.resume()');await snapshot(raw([0]));await expectInput(1,'controller input while game runs');await delay(120);await openPanel();
    assert.equal((await evaluate('window.dkcDebug.refresh()')).running,false,'Opening controller settings did not pause the game.');await expectInput(0,'editor does not leak bindings to game');
    report.checks.push('Opening profile editor pauses the loaded game and releases controller input.');
    originalSram=await evaluate('window.dkcDebug.saveBytes()');const sentinel=[...originalSram];sentinel[2047]^=0x5a;
    await evaluate(`(async()=>{await window.dkcDebug.importSave(${JSON.stringify(sentinel)});await window.dkcDebug.flushSaves();})()`);report.sramSentinel=sentinel;
  }else await openPanel();
  await setValue('#controller-name','Unsaved rename');await click('#settings-done');assert.equal((await controllers()).open,true);
  await click('#controller-discard');assert.equal((await controllers()).profile.name,'SN30 representative raw');assert.equal((await controllers()).dirty,false);
  await click('#controller-export');await poll(()=>evaluate('window.__controllerTest.exports.length>0'),'profile JSON export');
  const exported=JSON.parse((await evaluate('window.__controllerTest.exports.at(-1)')).text);assert.equal(exported.schema,'dkc.controller-profile');assert.equal(exported.version,1);assert.equal(exported.name,'SN30 representative raw');report.exportedProfile=exported;
  await poll(()=>downloads.length>0,'native profile download');report.downloads=downloads.map(({suggestedFilename})=>suggestedFilename);
  const bad=join(output,'unsupported-profile.json');await writeFile(bad,JSON.stringify({...exported,version:999}));await setFile('#controller-import',bad);
  await poll(()=>evaluate(`document.querySelector('#controller-message').textContent.toLowerCase().includes('version')||document.querySelector('#controller-message').textContent.toLowerCase().includes('unsupported')`),'invalid profile rejection');
  assert.equal((await controllers()).profile.name,'SN30 representative raw');
  const imported=join(output,'imported-profile.json');await writeFile(imported,JSON.stringify({...exported,name:'Imported representative raw'}));await setFile('#controller-import',imported);
  await poll(async()=>(await controllers()).profile.name==='Imported representative raw','profile import draft');assert.equal((await controllers()).dirty,true);
  await click('#controller-save');await poll(async()=>!(await controllers()).dirty,'imported profile save');
  await setValue('#controller-profile',report.savedProfile.id);await poll(async()=>(await controllers()).profile.name==='SN30 representative raw','saved profile load');
  report.checks.push('New/edit/save/discard, JSON export/download, malformed import rejection, import/save, and loading an existing profile pass through the visible UI.');
  const beforeReload=await controllers();await closePanel();await reload();await poll(async()=>(await controllers()).device?.id===RAW_ID,'raw controller after reload');
  const afterReload=await controllers();assert.equal(afterReload.profile.id,beforeReload.profile.id,'Selected profile did not survive reload.');assert(afterReload.savedProfiles.some(item=>item.name==='Imported representative raw'));
  await snapshot(raw([10,11]));await expectInput(12,'saved raw mapping restored after page reload');await snapshot(raw());
  report.checks.push('Saved profiles and per-controller selection persist across page reload.');
  if(rom){await loadRom();assert.deepEqual(await evaluate('window.dkcDebug.saveBytes()'),report.sramSentinel,'Controller profile storage changed persisted cartridge SRAM.');await evaluate(`(async()=>{await window.dkcDebug.importSave(${JSON.stringify(originalSram)});await window.dkcDebug.flushSaves();})()`);originalSram=null;delete report.sramSentinel;report.checks.push('Controller save/import/reload leaves the separate cartridge SRAM intact; original test bytes restored.');}
  await openPanel();await evaluate(`document.querySelector('#controller-panel').scrollIntoView({block:'start'})`);await screenshot('profile-restored.png');
  report.final=await controllers();assert.equal(report.javascriptErrors.length,0);assert.equal(report.consoleErrors.length,0);report.result='passed';
}catch(error){report.result='failed';report.error={message:error.message,stack:error.stack};process.exitCode=1;if(client&&session)try{report.failureHost=await evaluate('({url:location.href,ready:document.readyState,status:document.querySelector("#status")?.textContent,debug:typeof window.dkcDebug,resources:performance.getEntriesByType("resource").map(r=>r.name)})');await screenshot('failure.png');report.failureState=await controllers();report.failureInput=await evaluate('window.__controllerTest.inputs.slice(-20)');}catch{}}
finally{
  if(originalSram&&client&&session)try{await evaluate(`(async()=>{await window.dkcDebug.pause();await window.dkcDebug.importSave(${JSON.stringify(originalSram)});await window.dkcDebug.flushSaves();})()`);report.originalSramRestored=true;}catch{}
  if(client){try{await client.send('Browser.close',{},null,5000);}catch{}client.socket.close();}
  if(chrome?.exitCode===null){await Promise.race([new Promise(yes=>chrome.once('exit',yes)),delay(3000)]);if(chrome.exitCode===null)chrome.kill('SIGTERM');}
  if(server?.exitCode===null){server.kill('SIGINT');await Promise.race([new Promise(yes=>server.once('exit',yes)),delay(3000)]);if(server.exitCode===null)server.kill('SIGTERM');}
  await rm(profile,{recursive:true,force:true});for(const stream of streams)stream.end();report.finished=new Date().toISOString();
  await writeFile(join(output,'evidence.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({result:report.result,checks:report.checks,error:report.error?.message,evidence:join(output,'evidence.json')},null,2));
}
