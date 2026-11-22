#!/usr/bin/env node
// Actual Chrome pause-state/overlay integration with native keys and injected pads.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {mkdir,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {createServer} from 'node:net';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
let rom=null,startupOnly=false;
for(let i=2;i<process.argv.length;i++){
  if(process.argv[i]==='--rom')rom=resolve(process.argv[++i]);
  else if(process.argv[i]==='--startup')startupOnly=true;
  else if(process.argv[i]==='--help'){console.log('node scripts/pause_overlay_check.mjs [--rom /absolute/game.smc | --startup]');process.exit(0);}
  else throw new Error(`Unknown option: ${process.argv[i]}`);
}
const stamp=new Date().toISOString().replace(/[:.]/g,'-')+`-${process.pid}`;
const output=join(root,'build/pause-overlay-check',stamp),profile=join(root,'.local/pause-overlay-check-profile',stamp);
await mkdir(output,{recursive:true});await mkdir(profile,{recursive:true});
const RAW_ID='Representative standard controller';
const rawPad={id:RAW_ID,index:0,connected:true,mapping:'standard',buttons:Array.from({length:17},()=>({pressed:false,touched:false,value:0})),axes:[0,0,0,0],timestamp:1};
const report={started:new Date().toISOString(),inputSource:'Real CDP keyboard events and injected standard/raw Gamepad API fixtures; no physical controller tested.',romLoaded:Boolean(rom),checks:[],javascriptErrors:[],consoleErrors:[],result:'running'};
let server,chrome,client,session,origin;
const streams=[];
report.networkFailures=[];const networkRequests=new Map();
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

async function sourceHashes(){const files=(await readdir(join(root,'web'))).filter(file=>/\.(?:js|css|html|md|png|wasm)$/.test(file)).sort();const hashes=Object.fromEntries(await Promise.all(files.map(async file=>['web/'+file,createHash('sha256').update(await readFile(join(root,'web',file))).digest('hex')])));hashes['scripts/serve.py']=createHash('sha256').update(await readFile(join(root,'scripts/serve.py'))).digest('hex');return hashes;}
async function settle(){await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');await delay(80);}
async function focus(){await evaluate('document.querySelector("#screen").focus()');await settle();}
async function state(){return evaluate('window.dkcDebug.status()');}
async function paused(label){await settle();assert.equal((await state()).running,false,label);}
async function inputBits(bits,label){await poll(()=>evaluate(`window.__pauseTest.inputs.at(-1)===${bits}`),label);}
async function resumeCount(){return evaluate('window.__pauseTest.commands.filter(command=>command.type==="resume").length');}
async function resetRecords(){await evaluate('window.__pauseTest.commands=[];window.__pauseTest.inputs=[]');}
async function key(type,code,repeat=false,modifiers=0){
  const names={Enter:['Enter',13],Space:[' ',32],Escape:['Escape',27]};
  const [key,vk]=names[code]||[code.replace(/^Key/,'').toLowerCase(),code.startsWith('Key')?code.charCodeAt(3):0];
  await client.send('Input.dispatchKeyEvent',{type:type==='down'?'rawKeyDown':'keyUp',code,key,windowsVirtualKeyCode:vk,nativeVirtualKeyCode:vk,autoRepeat:repeat,modifiers});await delay(40);
}
async function press(code){await key('down',code);await key('up',code);}
async function menuCommand(group,command){
  const desktop=await evaluate(`Boolean(document.querySelector('[aria-controls="menu-${group}"]').getClientRects().length)`);
  const menu=desktop?group:'more';await click(`[aria-controls="menu-${menu}"]`);await click(`#menu-${menu} [data-command="${command}"]`);
}
async function input(){await menuCommand('config','controllers');await poll(()=>evaluate('document.querySelector("#app-settings").open'),'Input sheet');await settle();}
async function done(){await click('#settings-done');await poll(()=>evaluate('!document.querySelector("#app-settings").open'),'Input sheet closed');await focus();}
async function pad(buttons=[],{raw=false,connected=true}={}){
  const value=structuredClone(rawPad);value.id=raw?'Representative raw controller':RAW_ID;value.mapping=raw?'':'standard';value.connected=connected;
  for(const index of buttons)value.buttons[index]={pressed:true,touched:true,value:1};
  await evaluate(`window.__pauseTest.pads=${connected?JSON.stringify([value]):'[]'}`);await settle();
}
async function freshStart(button=9,raw=false){await pad([],{raw});await pad([button],{raw});await poll(async()=>(await state()).running,'gamepad resumes');}
async function rawBindStart(){
  await setValue('#controller-bind-action','start');await setValue('#controller-bind-type','button');await setValue('#controller-bind-index',11);await click('#controller-bind-add');
}

async function overlay(){return evaluate(`(()=>{const e=document.querySelector('#pause-overlay');return {hidden:e.hidden,display:getComputedStyle(e).display,title:document.querySelector('#pause-title').textContent,input:document.querySelector('#pause-input').textContent,hint:document.querySelector('#pause-hint').textContent,text:e.innerText,pointerEvents:getComputedStyle(e).pointerEvents};})()`);}
async function labels(expected,{disabled=false}={}){const values=await evaluate(`Array.from(document.querySelectorAll('[data-start-game]')).map(e=>({text:e.textContent.trim(),disabled:e.disabled}))`);assert.equal(values.length,2);for(const value of values){assert.equal(value.text,expected);assert.equal(value.disabled,disabled);}return values;}
async function shown(title){await poll(async()=>{const e=await overlay();return !e.hidden&&e.display!=='none'&&(!title||title.test(e.title));},'pause overlay shown');return overlay();}
async function hidden(){await poll(async()=>{const e=await overlay();return e.hidden||e.display==='none';},'pause overlay hidden');}
async function viewport(width,height,theme='light',dpr=1){await client.send('Emulation.setDeviceMetricsOverride',{width,height,screenWidth:width,screenHeight:height,deviceScaleFactor:dpr,mobile:false});await client.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme},{name:'prefers-reduced-motion',value:'reduce'}]});await settle();}
async function canvasClick(){const point=await evaluate(`(()=>{const r=document.querySelector('#screen').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);const hit=await evaluate(`document.elementFromPoint(${point.x},${point.y})?.id`);assert.equal(hit,'screen','Pause overlay intercepts pointer focus');await client.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await client.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});await settle();assert.equal(await evaluate('document.activeElement.id'),'screen');}
async function bounds(name){const value=await evaluate(`(()=>{const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};const overlay=document.querySelector('#pause-overlay');return {viewport:{width:innerWidth,height:innerHeight},screen:rect(document.querySelector('.screen-wrap')),overlay:rect(overlay),card:rect(overlay.firstElementChild),text:Array.from(overlay.querySelectorAll('h1,h2,h3,p')).map(e=>({text:e.textContent,rect:rect(e),scrollWidth:e.scrollWidth,clientWidth:e.clientWidth})),scrollWidth:document.documentElement.scrollWidth,nav:document.querySelectorAll('.app-menubar').length,mainNav:document.querySelector('.app-window').querySelectorAll('nav').length,mainControlsOutsideNav:Array.from(document.querySelector('.app-window').querySelectorAll('button,input,select,textarea,a[href]')).filter(e=>!e.closest('.app-menubar')).length,removed:document.querySelectorAll('.menubar-caption,.app-navigation,.toolbar,.app-status').length,overlayControls:overlay.querySelectorAll('button,input,select,textarea,a[href]').length,fullscreen:document.fullscreenElement?.className||null};})()`);const inside=(r,b)=>r.x>=b.x-1&&r.y>=b.y-1&&r.right<=b.right+1&&r.bottom<=b.bottom+1;assert(inside(value.card,value.screen),`${name}: pause card outside game screen ${JSON.stringify(value)}`);for(const text of value.text){assert(inside(text.rect,value.screen),`${name}: text outside game screen`);assert(text.scrollWidth<=text.clientWidth+1,`${name}: overflowing pause text ${text.text}`);}assert(value.scrollWidth<=value.viewport.width+1,`${name}: page horizontal overflow`);assert.equal(value.nav,1);assert.equal(value.mainNav,1);assert.equal(value.mainControlsOutsideNav,0);assert.equal(value.removed,0);assert.equal(value.overlayControls,0);report.layouts??=[];report.layouts.push({name,...value});await screenshot(name+'.png');}
try{
  if(!rom&&!startupOnly)throw new Error('Provide --rom with the verified local ROM, or choose --startup.');
  report.sources=await sourceHashes();origin=`http://127.0.0.1:${await unusedPort()}/`;
  server=spawn(process.env.PYTHON||'python3',[join(root,'scripts/serve.py'),'--port',new URL(origin).port],{cwd:root,stdio:['ignore','pipe','pipe']});log(server,'server.log');await poll(async()=>(await fetch(origin)).ok,'local server');
  chrome=spawn(process.env.CHROME_BIN||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--window-size=1440,900','about:blank'],{cwd:root,stdio:['ignore','pipe','pipe']});log(chrome,'chrome.log');
  const endpoint=await poll(async()=>{const [port,path]=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).trim().split('\n');return `ws://127.0.0.1:${port}${path}`;},'Chrome');
  client=new CDP(endpoint);await client.ready;report.browser=await client.send('Browser.getVersion',{},null);
  const target=await client.send('Target.createTarget',{url:'about:blank'},null);session=(await client.send('Target.attachToTarget',{targetId:target.targetId,flatten:true},null)).sessionId;
  client.on('Runtime.exceptionThrown',(data,id)=>{if(id===session)report.javascriptErrors.push(data.exceptionDetails);});
  client.on('Runtime.consoleAPICalled',(data,id)=>{if(id===session&&data.type==='error')report.consoleErrors.push(data.args.map(item=>item.value??item.description).join(' '));});
  client.on('Network.requestWillBeSent',(data,id)=>{if(id===session)networkRequests.set(data.requestId,data.request.url);});client.on('Network.loadingFailed',(data,id)=>{if(id===session)report.networkFailures.push({url:networkRequests.get(data.requestId),error:data.errorText,canceled:data.canceled});});
  await client.send('Network.enable');await client.send('Page.enable');await client.send('Runtime.enable');await client.send('Emulation.setFocusEmulationEnabled',{enabled:true});report.foregroundFocusEmulation=true;
  await client.send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__pauseTest={inputs:[],commands:[],pads:[${JSON.stringify(rawPad)}]};Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>window.__pauseTest.pads});const originalPost=Worker.prototype.postMessage;Worker.prototype.postMessage=function(message,...args){if(message?.type==='input')window.__pauseTest.inputs.push(message.buttons);if(['resume','pause','input'].includes(message?.type))window.__pauseTest.commands.push({...message});if(message?.type==='load'&&window.__pauseTest.holdLoad){window.__pauseTest.releaseLoad=()=>originalPost.call(this,message,...args);return;}const result=originalPost.call(this,message,...args);if(message?.type==='resume'&&window.__pauseTest.pauseImmediately){window.__pauseTest.pauseImmediately=false;originalPost.call(this,{type:'pause',id:-9876,reason:'zero-frame-fixture'});}return result;};const onmessage=Object.getOwnPropertyDescriptor(Worker.prototype,'onmessage');Object.defineProperty(Worker.prototype,'onmessage',{configurable:true,get(){return onmessage.get.call(this)},set(handler){window.__pauseTest.deliver=message=>handler.call(this,{data:message});onmessage.set.call(this,handler);}});`});
  await client.send('Page.navigate',{url:origin});await client.send('Page.bringToFront');await poll(()=>evaluate('Boolean(window.dkcDebug)&&document.querySelector("#status").textContent.startsWith("Ready")'),'host ready');
  if(startupOnly){
    report.startup=[];await client.send('Network.setCacheDisabled',{cacheDisabled:true});
    for(let index=0;index<6;index++){
      const previous=await evaluate('performance.timeOrigin');await client.send('Page.reload',{ignoreCache:true});
      await poll(()=>evaluate(`performance.timeOrigin!==${previous}&&Boolean(window.dkcDebug)&&document.querySelector('#status').textContent.startsWith('Ready')`),'cold module startup '+(index+1));
      report.startup.push(await evaluate(`({iteration:${index+1},timeOrigin:performance.timeOrigin,loaded:window.dkcDebug.status().loaded,ready:document.readyState,message:document.querySelector('#status').textContent,resources:performance.getEntriesByType('resource').map(item=>item.name)})`));
    }
    assert.equal(report.networkFailures.length,0);assert.equal(report.javascriptErrors.length,0);assert.equal(report.consoleErrors.length,0);report.checks.push('Six cache-disabled cold reloads initialize the full module graph and WebGPU host without network/JavaScript/console failures.');
  }else{
  await hidden();await labels('Start Game',{disabled:true});assert.equal((await state()).hasStarted,false);
  await evaluate('window.__pauseTest.holdLoad=true');await setFile('#rom-file',rom);await poll(()=>evaluate('Boolean(window.__pauseTest.releaseLoad)'),'load held at worker request');await hidden();await labels('Start Game',{disabled:true});await evaluate('window.__pauseTest.holdLoad=false;window.__pauseTest.releaseLoad()');await poll(async()=>{const s=await state();return s.loaded&&!s.loading;},'initial ROM ready',120000);
  let visible=await shown(/ready|start/i);assert.match(visible.input,/keyboard/i);assert.match(visible.input+' '+visible.hint,/Return/i);await labels('Start Game');await canvasClick();visible=await shown(/ready|start/i);assert.match(visible.hint,/Return/i);assert.equal(visible.pointerEvents,'none');await screenshot('ready-keyboard.png');
  report.checks.push('Unloaded/loading overlay stays hidden and Start Game disabled; fresh loaded game shows Ready to Start and the saved default Keyboard/Return input. Overlay passes pointer focus through to canvas.');

  await input();assert.equal((await state()).hasStarted,false);await labels('Start Game');await shown(/ready|start/i);await done();
  await evaluate('window.__pauseTest.pauseImmediately=true;window.dkcDebug.resume()');await poll(async()=>{const s=await state();return !s.running&&s.pausedReason==='zero-frame-fixture';},'zero-frame paused start');let s=await state();assert.equal(s.frameCount,0);assert.equal(s.hasStarted,true);await labels('Resume Game');await shown(/paused/i);report.zeroFrameState=s;report.zeroFrameFixture='Queues an actual worker pause immediately after its resume, before the first scheduled frame.';
  const invalid=await evaluate(`(async()=>{try{await window.dkcDebug.loadRom(new ArrayBuffer(1));return false;}catch(error){return /4,194,304/.test(error.message);}})()`);assert.equal(invalid,true);assert.equal((await state()).hasStarted,true);await labels('Resume Game');await shown(/paused/i);await click('[aria-controls="menu-dkm"]');await focus();
  await menuCommand('dkm','start-game');await poll(async()=>(await state()).running,'DKM resumes');await labels('Pause Game');await hidden();await menuCommand('dkm','start-game');await paused('DKM Pause Game did not pause');await labels('Resume Game');await shown(/paused/i);
  await menuCommand('dkm','reset-game');await poll(async()=>{const s=await state();return s.loaded&&!s.loading&&s.frameCount===0;},'DKM reload ready',120000);assert.equal((await state()).hasStarted,false);await labels('Start Game');await shown(/ready|start/i);
  report.checks.push('Worker-owned hasStarted distinguishes an immediate frame-zero pause, survives rejected ROM validation, and stays false when Config opens before first start; DKM toggles Start/Pause/Resume and Reload returns to Start Game.');

  await focus();await resetRecords();await key('down','Enter');await poll(async()=>(await state()).running,'Return quick start');await hidden();assert.equal(await evaluate('window.__pauseTest.inputs.some(bits=>Boolean(bits&8))'),false,'Resume press leaked Start');await key('down','Enter',true);assert.equal(await resumeCount(),1);await key('up','Enter');await key('down','Enter');await inputBits(8,'running Start reaches SNES');assert.equal((await state()).running,true);await key('up','Enter');await inputBits(0,'running Start releases');
  await input();await shown(/paused/i);assert.match((await overlay()).hint,/close|settings|save|discard|dialog/i);await click('[data-keyboard-learn="start"]');await press('KeyP');await click('#keyboard-save');await done();visible=await shown(/paused/i);assert.match(visible.input+' '+visible.hint,/\bP\b/);assert.doesNotMatch(visible.input+' '+visible.hint,/Return/);await screenshot('paused-keyboard-custom.png');
  await click('[aria-controls="menu-config"]');await settle();assert.match((await overlay()).hint,/close.*menu|menu.*close/i);await click('[aria-controls="menu-config"]');await focus();await key('down','KeyP');await poll(async()=>(await state()).running,'custom P resume');await key('up','KeyP');await input();await click('[data-keyboard-clear="start"]');await click('#keyboard-save');await done();visible=await shown(/paused/i);assert.match(visible.input,/keyboard/i);assert.match(visible.hint,/Space/);await press('Space');await poll(async()=>(await state()).running,'Space fallback resume');await input();await click('[data-keyboard-learn="start"]');await press('Enter');await click('#keyboard-save');await done();
  report.checks.push('Quick Start still consumes resume through release; subsequent Start reaches SNES. Overlay follows committed keyboard remaps/unassigned Start and shows menu/dialog guards with Space fallback.');

  await input();await setValue('#input-source','gamepad');await pad([]);await done();visible=await shown(/paused/i);assert.match(visible.input,/controller|gamepad/i);assert.match(visible.input+' '+visible.hint,/B9|button 9/i);await freshStart();await hidden();await pad([]);await input();await pad([],{raw:true});await done();visible=await shown(/paused/i);assert.match(visible.input+' '+visible.hint,/Config|Input|map|profile/i);await pad([9],{raw:true});await paused('Unmapped raw default resumed');await pad([],{raw:true});
  await input();await click('#controller-new');await setValue('#controller-name','Raw Start profile with a deliberately long descriptive name for wrapping');await rawBindStart();await click('#controller-save');assert.equal((await evaluate('window.dkcDebug.controllers()')).dirty,false);await done();visible=await shown(/paused/i);assert.match(visible.input+' '+visible.hint,/B11|button 11/i);await freshStart(11,true);await hidden();await pad([],{raw:true});await evaluate('window.dkcDebug.pause()');await pad([],{connected:false});await shown(/paused/i);
  await poll(async()=>{const {input,hint}=await overlay();return /connect|disconnected/i.test(input+' '+hint);},'disconnected controller guidance');await pad([],{raw:true});await focus();await shown(/paused/i);
  report.checks.push('Overlay follows selected standard B9/custom raw B11 profiles, cannot promise unmapped raw Start, and explains a disconnected controller. Controller fixtures are injected; no hardware tested.');

  await viewport(390,844,'light');await menuCommand('dkm','start-game');await poll(async()=>(await state()).running,'compact DKM resumes');await labels('Pause Game');await menuCommand('dkm','start-game');await paused('compact DKM did not pause');await labels('Resume Game');await shown(/paused/i);await viewport(1440,900,'light');
  await menuCommand('dkm','reset-game');await poll(async()=>{const s=await state();return s.loaded&&!s.loading&&s.frameCount===0;},'native replay reload',120000);await evaluate('window.dkcDebug.runFrames(600,0)');const native=await evaluate('window.dkcDebug.frameHash()');assert.equal(native.sha256,'a7366146a96b47e75d48d3814bfe0859c71f68bcc3fac3d7429befb9b50430dd');report.native600=native;await shown(/paused/i);await focus();
  for(const [width,height,theme,dpr] of [[1440,900,'light',1],[390,844,'light',1],[844,390,'dark',2],[320,568,'dark',1]]){await viewport(width,height,theme,dpr);await focus();await shown(/paused/i);await bounds(`paused-${width}x${height}-${theme}`);}
  await viewport(1440,900,'dark');await evaluate('document.querySelector(".screen-wrap").requestFullscreen()');await poll(()=>evaluate('document.fullscreenElement?.classList.contains("screen-wrap")'),'screen-only fullscreen');for(const [width,height] of [[1440,900],[390,844],[844,390]]){await viewport(width,height,'dark');await focus();await shown(/paused/i);await bounds(`fullscreen-${width}x${height}`);}await evaluate('document.exitFullscreen()');await settle();
  report.checks.push('Compact DKM state toggles, native 600-frame oracle, four responsive paused layouts, and three screen-only fullscreen layouts pass; overlays contain no controls and keep one navigation.');

  // The original game still receives a separate Start bit for each SNES port.
  const p2Start=8<<12;
  await pad([]);await input();await setValue('#input-source','none');await settle();
  await setValue('#input-player',1);await settle();await setValue('#input-source','both');await settle();
  await click('[data-keyboard-learn="start"]');await press('Space');await click('#keyboard-save');await done();
  visible=await shown(/paused/i);assert.match(visible.input,/Player 2/);assert.match(visible.hint,/Space/);assert.match(visible.hint,/B9/);
  await resetRecords();await key('down','Space');await poll(async()=>(await state()).running,'Player 2 mapped Space resumes');
  assert.equal(await resumeCount(),1);assert(!await evaluate('window.__pauseTest.inputs.some(mask=>mask&0x8008)'));
  await key('up','Space');await key('down','Space');await inputBits(p2Start,'second Space reaches port 2 Start only');
  assert((await state()).running);await key('up','Space');await inputBits(0,'release Player 2 keyboard Start');
  await evaluate('dkcDebug.pause()');await focus();await resetRecords();await freshStart();
  assert.equal(await resumeCount(),1);assert(!await evaluate('window.__pauseTest.inputs.some(mask=>mask&0x8008)'));
  await pad([]);await pad([9]);await inputBits(p2Start,'second pad Start reaches port 2 only');
  await pad([]);await inputBits(0,'release Player 2 gamepad Start');await evaluate('dkcDebug.pause()');await focus();
  report.checks.push('With Player 1 disabled, the overlay shows Player 2’s assigned Space and controller B9. Each can resume once, consumes that press, and sends the next Start exclusively to SNES port 2.');

  await viewport(1440,900,'light');await evaluate('window.__pauseTest.deliver({type:"error",error:"Controlled pause-overlay error fixture"})');await settle();await labels('Resume Game',{disabled:true});visible=await shown(/stopped|error/i);assert.doesNotMatch(visible.hint,/press.*(?:B11|Return).*resume/i);report.errorFixture='Controlled worker error message drives UI error presentation; no watchdog or actual core failure induced.';await client.send('Page.reload',{ignoreCache:true});await poll(()=>evaluate('Boolean(window.dkcDebug)&&document.querySelector("#status").textContent.startsWith("Ready")'),'page reload after controlled error');const restored=await state();
  assert(restored.loaded&&!restored.loading&&!restored.running&&!restored.hasStarted&&!restored.playbackError);
  await shown(/ready|start/i);await labels('Start Game');
  report.expectedConsoleErrors=report.consoleErrors.filter(message=>message.startsWith('Controlled pause-overlay error fixture'));report.unexpectedConsoleErrors=report.consoleErrors.filter(message=>!message.startsWith('Controlled pause-overlay error fixture'));assert.equal(report.expectedConsoleErrors.length,1);assert.equal(report.unexpectedConsoleErrors.length,0);assert.equal(report.javascriptErrors.length,0);
  report.checks.push('Controlled worker error disables playback and replaces resume instructions with page-reload guidance; reopening the page restores the remembered ROM at Start Game.');
  }
  report.finalState=await state();report.sourcesAfter=await sourceHashes();report.sourceUnchanged=JSON.stringify(report.sources)===JSON.stringify(report.sourcesAfter);assert(report.sourceUnchanged,'Production source changed during verification.');report.result='passed';
}catch(error){report.result='failed';report.error={message:error.message,stack:error.stack};process.exitCode=1;if(client&&session)try{report.failureState=await evaluate('({keyboard:window.dkcDebug?.keyboard(),controllers:window.dkcDebug?.controllers(),state:window.dkcDebug?.status(),active:{tag:document.activeElement?.tagName,id:document.activeElement?.id},overlay:document.querySelector("#pause-overlay")?.outerHTML,input:window.__pauseTest?.inputs.slice(-12),commands:window.__pauseTest?.commands.slice(-20)})');await screenshot('failure.png');}catch{}}
finally{
  if(client){try{await client.send('Browser.close',{},null,5000);}catch{}client.socket.close();}if(chrome?.exitCode===null){await Promise.race([new Promise(yes=>chrome.once('exit',yes)),delay(3000)]);if(chrome.exitCode===null)chrome.kill('SIGTERM');}for(const stream of streams)stream.end();if(server?.exitCode===null)server.kill('SIGTERM');for(const child of [chrome,server]){child?.stdout?.destroy();child?.stderr?.destroy();child?.unref();}await rm(profile,{recursive:true,force:true,maxRetries:4,retryDelay:100}).catch(()=>{});report.finished=new Date().toISOString();await writeFile(join(output,'evidence.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({result:report.result,checks:report.checks,error:report.error?.message,evidence:join(output,'evidence.json')},null,2));
}
