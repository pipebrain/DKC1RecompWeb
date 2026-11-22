#!/usr/bin/env node
// Isolated Chrome keyboard and Markdown-content integration; no runtime packages.
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
let rom=null,visualOnly=false;
for(let i=2;i<process.argv.length;i++){
  if(process.argv[i]==='--rom')rom=resolve(process.argv[++i]);
  else if(process.argv[i]==='--visual')visualOnly=true;
  else if(process.argv[i]==='--help'){console.log('node scripts/keyboard_content_check.mjs [--rom /absolute/game.smc] [--visual]');process.exit(0);}
  else throw new Error(`Unknown option: ${process.argv[i]}`);
}
const stamp=new Date().toISOString().replace(/[:.]/g,'-')+`-${process.pid}`;
const output=join(root,visualOnly?'build/keyboard-content-visual':'build/keyboard-content-check',stamp),profile=join(root,'.local/keyboard-content-check-profile',stamp);
await mkdir(output,{recursive:true});await mkdir(profile,{recursive:true});
const RAW_ID='Representative standard controller';
const rawPad={id:RAW_ID,index:0,connected:true,mapping:'standard',buttons:Array.from({length:12},()=>({pressed:false,touched:false,value:0})),axes:[0,0,0,0,0,0,0,0,0,23/7],timestamp:1};
const report={started:new Date().toISOString(),inputSource:'Real CDP keyboard events and injected standard Gamepad fixture; no physical controller tested.',romLoaded:Boolean(rom),checks:[],javascriptErrors:[],consoleErrors:[],result:'running'};
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
async function setFile(selector,path){const {root:document}=await client.send('DOM.getDocument');const {nodeId}=await client.send('DOM.querySelector',{nodeId:document.nodeId,selector});assert(nodeId,`Missing file picker ${selector}`);await client.send('DOM.setFileInputFiles',{nodeId,files:[path]});}
async function loadRom(){await setFile('#rom-file',rom);await poll(async()=>{const value=await evaluate(`({loaded:window.dkcDebug.status().loaded,loading:window.dkcDebug.status().loading,error:document.querySelector('#status').classList.contains('error'),message:document.querySelector('#status').textContent})`);if(value.error&&!value.loading){const error=new Error(value.message);error.fatal=true;throw error;}return value.loaded&&!value.loading;},'ROM initialization',120000);}

const sourceFiles=['web/index.html','web/style.css','web/main.js','web/ui-shell.js','web/controller-ui.js','web/gamepad-profiles.js','web/keyboard-ui.js','web/keyboard-profiles.js','web/content-pages.js','web/worker.js','web/wasm-imports.js','web/dkc.wasm','web/About.md','web/Help.md','web/dk-coin.png'];
async function sourceHashes(){return Object.fromEntries(await Promise.all(sourceFiles.map(async file=>[file,createHash('sha256').update(await readFile(join(root,file))).digest('hex')])));}
async function keyboard(){return evaluate('window.dkcDebug.keyboard()');}
async function expected(bits,label){await poll(()=>evaluate(`window.__keyboardTest.inputs.at(-1)===${bits}`),label);}
async function menuCommand(menu,command){const compact=await evaluate('getComputedStyle(document.querySelector(".compact-more")).display!=="none"');const id=compact?'more':menu;await click(`[aria-controls="menu-${id}"]`);await click(`#menu-${id} [data-command="${command}"]`);}
async function input(){await menuCommand('config','controllers');await poll(()=>evaluate('document.querySelector("#app-settings").open'),'Input open');}
async function done(){await click('#settings-done');await poll(()=>evaluate('!document.querySelector("#app-settings").open'),'Config close');}
async function learn(action,code){await click(`[data-keyboard-learn="${action}"]`);await press(code);}
async function ready(){await client.send('Page.bringToFront');await poll(()=>evaluate('Boolean(window.dkcDebug?.content)&&document.querySelector("#status").textContent.startsWith("Ready")&&window.dkcDebug.content().about'),'host and Markdown ready');}
async function reloadCase(name){await evaluate(`sessionStorage.setItem('__helpCase',${JSON.stringify(name)})`);await client.send('Page.reload',{ignoreCache:true});await ready();await poll(()=>evaluate('Object.keys(window.dkcDebug.content().errors).length>0||window.dkcDebug.content().help'),'content case settled');}
async function nativeKey(type,code,modifiers=0){await client.send('Page.bringToFront');await poll(()=>evaluate('!document.hidden'),'foreground keyboard target');if(await evaluate('document.activeElement?.id==="screen"&&window.dkcDebug?.status().loaded&&!window.dkcDebug.status().running&&window.dkcDebug.status().pausedReason==="hidden"')){report.headlessForegroundRecoveries=(report.headlessForegroundRecoveries||0)+1;await evaluate('window.dkcDebug.resume()');}const names={ArrowRight:['ArrowRight',39],ArrowLeft:['ArrowLeft',37],ArrowUp:['ArrowUp',38],ArrowDown:['ArrowDown',40],ShiftLeft:['Shift',16],ShiftRight:['Shift',16],Enter:['Enter',13],Space:[' ',32],Escape:['Escape',27],Tab:['Tab',9]};const [key,vk]=names[code]||[code.replace(/^Key/,'').toLowerCase(),code.startsWith('Key')?code.charCodeAt(3):0];await client.send('Input.dispatchKeyEvent',{type:type==='rawKeyDown'?'rawKeyDown':'keyUp',code,key,windowsVirtualKeyCode:vk,nativeVirtualKeyCode:vk,modifiers,location:code==='ShiftRight'?2:code==='ShiftLeft'?1:0});await delay(45);}
async function press(code){await nativeKey('rawKeyDown',code);await nativeKey('keyUp',code);}
async function resume(){
  await client.send('Page.bringToFront');
  await menuCommand('dkm','start-game');
  await poll(()=>evaluate("window.dkcDebug.status().running && document.activeElement===document.getElementById('screen')"),'game running with keyboard focus');
}
async function checkStompHaptics(){
  await menuCommand('dkm','reset-game');
  await poll(()=>evaluate('window.dkcDebug.status().loaded&&!window.dkcDebug.status().loading&&window.dkcDebug.status().frameCount===0'),'fresh stock boot for stomp replay');
  const route=await readFile(join(root,'tests/fixtures/jungle-entry.inputs'),'utf8');
  const runs=route.split(/\r?\n/).map(line=>line.split('#')[0].trim()).filter(Boolean).map(line=>{
    const [mask,frames]=line.split('*');return {buttons:parseInt(mask,16),count:Number(frames)};
  });
  // Walk for 85 frames, jump right for 25, and stop four ticks before the stock rebound at frame 7579.
  runs.push({buttons:128,count:85},{buttons:129,count:25},{buttons:128,count:15});
  const atFall=await evaluate(`window.dkcDebug.replayFingerprints(${JSON.stringify(runs)})`);
  assert.equal(atFall.frameCount,7575);
  await evaluate(`window.__keyboardTest.stompPulses=[];
    window.__keyboardTest.pads[0].vibrationActuator={playEffect:(kind,params)=>{
      window.__keyboardTest.stompPulses.push({kind,params});return Promise.resolve('complete');
    }};`);
  await menuCommand('config','saves');
  await click('#app-settings [data-command="quick-save"]');
  await poll(()=>evaluate('document.querySelector("#save-status").textContent==="Saved state to slot 1."'),'falling snapshot stored');
  await done();
  async function playToStomp(count){
    await evaluate('document.querySelector("#screen").focus();window.__keyboardTest.pads[0].axes[0]=1');
    await expected(128,'assigned controller holds right before the rebound');
    await evaluate('window.dkcDebug.resume()');
    await poll(()=>evaluate(`window.__keyboardTest.stomps===${count}`),'stock game reported a real enemy rebound');
    await evaluate('window.__keyboardTest.pads[0].axes[0]=0;window.dkcDebug.pause()');
  }
  await playToStomp(1);
  assert.deepEqual(await evaluate('window.__keyboardTest.stompPulses'),[
    {kind:'dual-rumble',params:{startDelay:0,duration:55,strongMagnitude:0x2800/65535,weakMagnitude:0x5000/65535}}
  ]);
  await menuCommand('config','devices');await click('#controller-rumble');await done();
  await menuCommand('config','saves');await click('#app-settings [data-command="quick-load"]');
  await poll(()=>evaluate('document.querySelector("#save-status").textContent==="Loaded state from slot 1."'),'falling snapshot restored');
  await done();await playToStomp(2);
  assert.equal(await evaluate('window.__keyboardTest.stompPulses.length'),1,'rumble-off must silence the second real stomp');
  report.checks.push('Real stock Jungle gameplay rebounds from an enemy at frame 7579. The assigned simulated actuator receives the native pulse once. Restoring the same fall with rumble off produces another stomp and no motor request.');
}
async function layout(width,height,theme){await client.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await client.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme},{name:'prefers-reduced-motion',value:'reduce'}]});await client.send('Page.bringToFront');await delay(220);}
try{
  if(!rom&&!visualOnly)throw new Error('Provide --rom with the verified local ROM.');
  report.sources=await sourceHashes();
  origin=`http://127.0.0.1:${await unusedPort()}/`;
  server=spawn(process.env.PYTHON||'python3',[join(root,'scripts/serve.py'),'--port',new URL(origin).port],{cwd:root,stdio:['ignore','pipe','pipe']});log(server,'server.log');await poll(async()=>(await fetch(origin)).ok,'local server');
  chrome=spawn(process.env.CHROME_BIN||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--window-size=1440,900','about:blank'],{cwd:root,stdio:['ignore','pipe','pipe']});log(chrome,'chrome.log');
  const endpoint=await poll(async()=>{const [p,path]=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).trim().split('\n');return `ws://127.0.0.1:${p}${path}`;},'Chrome');client=new CDP(endpoint);await client.ready;report.browser=await client.send('Browser.getVersion',{},null);const target=await client.send('Target.createTarget',{url:'about:blank'},null);session=(await client.send('Target.attachToTarget',{targetId:target.targetId,flatten:true},null)).sessionId;
  client.on('Runtime.exceptionThrown',(data,id)=>{if(id===session)report.javascriptErrors.push(data.exceptionDetails);});client.on('Runtime.consoleAPICalled',(data,id)=>{if(id===session&&data.type==='error')report.consoleErrors.push(data.args.map(item=>item.value??item.description).join(' '));});await client.send('Page.enable');await client.send('Runtime.enable');await client.send('Emulation.setFocusEmulationEnabled',{enabled:true});report.foregroundFocusEmulation=true;
  await client.send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__keyboardTest={inputs:[],snapshots:0,stomps:0,pads:[${JSON.stringify(rawPad)}]};Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>window.__keyboardTest.pads});const originalPost=Worker.prototype.postMessage;Worker.prototype.postMessage=function(message,...args){if(!this.__testObserving){this.__testObserving=true;this.addEventListener('message',event=>{if(event.data?.type==='stomp')window.__keyboardTest.stomps++;});}if(message?.type==='input')window.__keyboardTest.inputs.push(message.buttons);if(message?.type==='snapshot')window.__keyboardTest.snapshots++;return originalPost.call(this,message,...args);};const originalFetch=window.fetch;window.fetch=function(input,options){const url=String(input?.url||input),variant=sessionStorage.getItem('__helpCase');if(url.endsWith('/Help.md')&&variant){if(variant==='missing')return Promise.resolve(new Response('Not found',{status:404}));if(variant==='empty')return Promise.resolve(new Response('   ',{status:200,headers:{'content-type':'text/markdown'}}));if(variant==='html')return Promise.resolve(new Response('<!doctype html><html><body>Fallback</body></html>',{status:200,headers:{'content-type':'text/html'}}));}return originalFetch.call(this,input,options);};`});
  await layout(1440,900,'light');await client.send('Page.navigate',{url:origin});await ready();await poll(()=>evaluate('window.dkcDebug.content().help'),'real Help Markdown loaded');
  if(visualOnly){
    for(const [width,height,theme] of [[1440,900,'light'],[390,844,'light'],[844,390,'dark']]){
      await layout(width,height,theme);await input();
      const cancelVisible=()=>evaluate('getComputedStyle(document.querySelector("#keyboard-capture-cancel")).display!=="none"');
      assert.equal(await cancelVisible(),false,'Cancel learning is visible without a capture');
      await click('[data-keyboard-learn="b"]');assert.equal(await cancelVisible(),true);await press('Escape');assert.equal(await cancelVisible(),false);
      await learn('b','KeyV');assert.equal(await cancelVisible(),false);await click('#keyboard-discard');await screenshot(`keyboard-${width}x${height}.png`);await done();
      await menuCommand('misc','about');await poll(()=>evaluate('document.querySelector("#about-dialog").open'),'About visual');assert.equal(await evaluate('document.querySelector("#about-dialog .dk-coin").className'),'dk-coin');await screenshot(`about-${width}x${height}.png`);await click('#about-dialog [data-close-about]');
      await menuCommand('misc','keyboard');await poll(()=>evaluate('document.querySelector("#help-dialog").open'),'Help visual');const rect=await evaluate('(()=>{const r=document.querySelector("#help-dialog").getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};})()');assert(rect.x>=-1&&rect.y>=-1&&rect.right<=width+1&&rect.bottom<=height+1);await screenshot(`help-${width}x${height}.png`);await click('#help-dialog [data-close-help]');
    }
    report.checks.push('Cancel learning is hidden initially and after Escape/commit, visible only during capture; keyboard, About coin, and Markdown Help fit desktop, portrait, and landscape.');
  }else{
  assert.equal((await keyboard()).mode,'keyboard');assert.equal((await keyboard()).isDefault,true);assert.match(await evaluate('document.querySelector("#menu-config [data-input-label]").textContent'),/Keyboard.*default/i);
  assert.equal(await evaluate('document.querySelector("#about-dialog .app-icon, #about-dialog .about-icon")===null'),true);assert.equal(await evaluate('document.querySelector("#about-dialog .dk-coin").className'),'dk-coin');
  const links=await evaluate('Array.from(document.querySelectorAll("#about-content a")).map(e=>e.href)');assert(links.some(url=>url==='https://github.com/elliotttate/DKC1Recomp'));assert(await evaluate('document.querySelector("#about-content h1")!==null&&document.querySelector("#help-content table")!==null'));assert(await evaluate('document.querySelector("#about-content").textContent.includes("WebAssembly")'));
  const safe=await evaluate(`(async()=>{const {renderMarkdown}=await import('./content-pages.js');const node=document.createElement('div');renderMarkdown(${JSON.stringify('# Safety\n\n<script>window.__markdownExecuted=1</script>\n\n[Bad](javascript:alert(1)) [Good](https://example.com)\n\n<img src=x onerror=window.__markdownExecuted=1>')},node);document.body.append(node);const result={executed:window.__markdownExecuted||null,scripts:node.querySelectorAll('script,img').length,links:[...node.querySelectorAll('a')].map(a=>({href:a.href,rel:a.rel,target:a.target})),text:node.textContent};node.remove();return result;})()`);assert.equal(safe.executed,null);assert.equal(safe.scripts,0);assert.equal(safe.links.length,1);assert.equal(safe.links[0].href,'https://example.com/');assert.match(safe.links[0].rel,/noopener/);report.markdownSafety=safe;
  report.checks.push('About/Help load actual editable Markdown; About uses the DK coin and upstream links; raw HTML and executable links stay inert.');
  await loadRom();originalSram=await evaluate('window.dkcDebug.saveBytes()');const sentinel=[...originalSram];sentinel[2047]^=0x69;await evaluate(`window.dkcDebug.importSave(${JSON.stringify(sentinel)})`);await evaluate('window.dkcDebug.flushSaves()');const padStorage=await evaluate('localStorage.getItem("dkc.controller-settings.v2")');
  await resume();await nativeKey('rawKeyDown','KeyZ');await expected(1,'default Z maps B at worker');await nativeKey('keyUp','KeyZ');await expected(0,'Z releases');
  await nativeKey('rawKeyDown','ShiftLeft',8);await expected(4,'left Shift maps Select');await nativeKey('rawKeyDown','ShiftRight',8);await nativeKey('keyUp','ShiftLeft',8);await expected(4,'right Shift keeps Select held');await nativeKey('keyUp','ShiftRight');await expected(0,'both Shifts release');
  await evaluate('window.__keyboardTest.pads[0].buttons[0]={pressed:true,value:1}');await delay(180);await expected(0,'held pad ignored while Keyboard selected');await input();assert.equal(await evaluate('window.dkcDebug.status().running'),false);assert.equal(await evaluate('document.querySelector("#keyboard-panel").hidden'),false);assert.equal(await evaluate('document.querySelector("#controller-panel").hidden'),true);
  report.checks.push('Keyboard is the true default; actual keys and held-key alternatives reach worker masks, pad input is suppressed, and Config pauses/releases input.');
  await learn('b','KeyV');assert.equal((await keyboard()).dirty,true);assert.deepEqual((await keyboard()).bindings.b,['KeyZ']);assert.deepEqual((await keyboard()).draftBindings.b,['KeyV']);await expected(0,'capture does not reach game');
  await click('#settings-tab-devices');assert.equal(await evaluate('document.querySelector("#app-settings").dataset.section'),'controllers');await click('#settings-done');assert.equal(await evaluate('document.querySelector("#app-settings").open'),true);await setValue('#input-source','gamepad');assert.equal((await keyboard()).mode,'keyboard');assert.equal(await evaluate('document.querySelector("#input-source").value'),'keyboard');
  await click('#keyboard-save');assert.equal((await keyboard()).dirty,false);await done();await resume();await nativeKey('rawKeyDown','KeyZ');await expected(0,'old binding inactive after remap');await nativeKey('keyUp','KeyZ');await nativeKey('rawKeyDown','KeyV');await expected(1,'saved remap reaches worker');await nativeKey('keyUp','KeyV');await expected(0,'remap releases');
  await input();await learn('b','KeyC');await click('#keyboard-discard');assert.deepEqual((await keyboard()).bindings.b,['KeyV']);assert.deepEqual((await keyboard()).draftBindings.b,['KeyV']);
  await click('[data-keyboard-learn="b"]');await press('Tab');assert.equal((await keyboard()).captureAction,'b');assert.match(await evaluate('document.querySelector("#keyboard-message").textContent'),/reserved/i);await press('Escape');assert.equal((await keyboard()).captureAction,null);assert.equal(await evaluate('document.querySelector("#app-settings").open'),true);
  await click('[data-keyboard-learn="b"]');await press('KeyX');assert.deepEqual((await keyboard()).draftBindings.b,['KeyV']);assert.match(await evaluate('document.querySelector("#keyboard-message").textContent'),/already assigned/i);await press('Escape');
  await click('[data-keyboard-clear="r"]');assert.deepEqual((await keyboard()).draftBindings.r,[]);await click('#keyboard-discard');assert.deepEqual((await keyboard()).draftBindings.r,['KeyW']);
  await done();await client.send('Page.reload',{ignoreCache:true});await ready();assert.deepEqual((await keyboard()).bindings.b,['KeyV']);assert.equal((await keyboard()).mode,'keyboard');assert.deepEqual(await evaluate('window.dkcDebug.saveBytes()'),sentinel);assert.equal(await evaluate('localStorage.getItem("dkc.controller-settings.v2")'),padStorage);
  await input();await click('#keyboard-defaults');assert.equal((await keyboard()).dirty,true);await click('#keyboard-save');assert.equal((await keyboard()).isDefault,true);assert.deepEqual((await keyboard()).bindings.b,['KeyZ']);
  await click('[data-keyboard-learn="b"]');await press('Space');assert.deepEqual((await keyboard()).draftBindings.b,['Space']);await click('#keyboard-save');await done();await resume();await nativeKey('rawKeyDown','Space');await expected(1,'Space remapped Jump reaches worker without host pause');assert.equal(await evaluate('window.dkcDebug.status().running'),true);await nativeKey('keyUp','Space');await expected(0,'Space remap releases');await input();await click('#keyboard-defaults');await click('#keyboard-save');
  report.checks.push('Keyboard remap, Save/Discard/defaults, duplicate/reserved rejection, source/tab/close draft guards, and reload persistence pass without altering controller profiles or SRAM.');
  await setValue('#input-source','gamepad');await poll(()=>evaluate('window.dkcDebug.keyboard().mode==="gamepad"'),'Gamepad mode');assert.equal(await evaluate('document.querySelector("#controller-panel").hidden'),false);assert.equal(await evaluate('document.querySelector("#keyboard-panel").hidden'),true);await evaluate('window.__keyboardTest.pads[0].buttons[0]={pressed:true,value:1}');await done();await resume();await expected(1,'held gamepad reaches worker in Gamepad mode');await nativeKey('rawKeyDown','ArrowRight');await expected(1,'keyboard ignored in Gamepad mode');await nativeKey('keyUp','ArrowRight');await evaluate('window.__keyboardTest.pads[0].buttons[0]={pressed:false,value:0}');await expected(0,'pad release');
  await client.send('Page.reload',{ignoreCache:true});await ready();assert.equal((await keyboard()).mode,'gamepad');assert.match(await evaluate('document.querySelector("#menu-config [data-input-label]").textContent'),/Gamepad|Controller/);await input();await setValue('#input-source','keyboard');await done();
  report.checks.push('Input-source switching activates only the selected device and persists across reload; existing gamepad mappings remain available.');
  await evaluate(`window.__keyboardTest.pads.push({...structuredClone(window.__keyboardTest.pads[0]),index:1});window.__keyboardTest.rumble=[];window.__keyboardTest.pads[1].vibrationActuator={playEffect:(kind,params)=>{window.__keyboardTest.rumble.push({kind,params});return Promise.resolve('complete');}};`);
  await input();await setValue('#input-source','both');await setValue('#input-player',1);await setValue('#input-source','both');
  await poll(()=>evaluate('document.querySelector("#controller-device").options.length===3'),'two identical devices receive distinct selectors');
  await setValue('#controller-device',await evaluate('document.querySelector("#controller-device").options[2].value'));
  await learn('b','KeyJ');await click('#keyboard-save');
  await click('#assist-shortcuts summary');
  await click('#assist-shortcut-rows .settings-row:first-child button:nth-child(3)');
  const padButton=(index,button,down)=>evaluate(`window.__keyboardTest.pads[${index}].buttons[${button}]={pressed:${down},value:${down?1:0}}`);
  await padButton(1,6,true);
  await poll(()=>evaluate('document.querySelector("#assist-shortcut-status").textContent==="Controller shortcut saved."'),'capture Player 2 save-state button');
  await padButton(1,6,false);
  await click('#settings-tab-devices');await setValue('#rumble-player',1);await poll(()=>evaluate('!document.querySelector("#controller-rumble-test").disabled'),'P2 vibration API available');
  await click('#controller-rumble-test');assert.equal(await evaluate('window.__keyboardTest.rumble.at(-1)?.params.duration'),55);
  await done();await resume();
  await evaluate('window.__keyboardTest.pads[0].buttons[0]={pressed:true,value:1};window.__keyboardTest.pads[1].buttons[1]={pressed:true,value:1}');
  await nativeKey('rawKeyDown','KeyX');await nativeKey('rawKeyDown','KeyJ');
  await expected(3|(257<<12),'two independent keyboard and pad routes combine into both SNES ports');
  await evaluate('window.__keyboardTest.pads[1].connected=false');
  await expected(3|(1<<12),'disconnect clears held Player 2 pad input and preserves keyboard and Player 1');
  await evaluate('window.__keyboardTest.pads[1].connected=true');
  await expected(3|(257<<12),'same model reconnects on the assigned port');

  await nativeKey('keyUp','KeyJ');await nativeKey('keyUp','KeyX');await evaluate('window.__keyboardTest.pads[0].buttons[0]={pressed:false,value:0};window.__keyboardTest.pads[1].buttons[1]={pressed:false,value:0}');
  await expected(0,'both player ports release');
  await evaluate('window.__keyboardTest.pads.push({...structuredClone(window.__keyboardTest.pads[0]),index:2})');
  await padButton(2,6,true);
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  assert.equal(await evaluate('window.__keyboardTest.snapshots'),0,'unassigned controller triggered a save');
  await padButton(1,6,true);
  await poll(()=>evaluate('window.__keyboardTest.snapshots===1'),'assigned controller saves once while unassigned controller holds the same button');
  await padButton(1,6,false);await padButton(2,6,false);
  report.checks.push('Disconnecting a held Player 2 pad clears only its input. After reconnection the assigned controller can save a state while an unassigned controller holding the same button is ignored.');

  await checkStompHaptics();
  await input();await setValue('#input-source','none');await setValue('#input-player',0);await setValue('#input-source','keyboard');await done();
  report.checks.push('Player 1 and Player 2 accept simultaneous keyboard and gamepad input on independent SNES ports, including two controllers with identical IDs. Test rumble selects the requested player and sends the native 55 ms pulse to an injected actuator.');
  const legacy=await evaluate(`(()=>{
    const keys=JSON.parse(localStorage.getItem('dkc.keyboard-settings.v2'));
    keys.version=1;keys.assistKeys['rewind-step']='Backspace';keys.assistKeys['fast-forward']='Tab';
    const pads=JSON.parse(localStorage.getItem('dkc.controller-settings.v2'));
    pads.assistBindings['fast-forward']={type:'button',index:7,threshold:0.5};
    for(const [kind,value] of [['keyboard',keys],['controller',pads]]){
      localStorage.setItem('dkc.'+kind+'-settings.v1',JSON.stringify(value));
      localStorage.removeItem('dkc.'+kind+'-settings.v2');
    }
    return [JSON.stringify(keys),JSON.stringify(pads)];
  })()`);
  await reloadCase('');
  await evaluate(`(()=>{
    const create=URL.createObjectURL;
    URL.createObjectURL=function(blob){
      if(blob.type==='application/json')window.__keyboardTest.exported=blob.text();
      return create.call(this,blob);
    };
  })()`);
  await menuCommand('config','save-config');
  const migrated=await poll(()=>evaluate('window.__keyboardTest.exported?.then(JSON.parse)'),'export migrated configuration');
  assert.deepEqual(migrated.keyboard.player2.bindings.b,['KeyJ']);
  assert.equal(migrated.controllers.assistBindings['quick-save'].index,6);
  assert.deepEqual(Object.keys(migrated.keyboard.assistKeys).sort(),['quick-load','quick-save']);
  assert.deepEqual(Object.keys(migrated.controllers.assistBindings).sort(),['quick-load','quick-save']);
  assert.deepEqual(await evaluate('[localStorage.getItem("dkc.keyboard-settings.v1"),localStorage.getItem("dkc.controller-settings.v1")]'),legacy);
  report.checks.push('Previous browser input records reopen with the two player assignments and save shortcut intact. Export drops retired shortcuts and the previous records stay available.');
  for(const [width,height,theme] of [[1440,900,'light'],[390,844,'light'],[844,390,'dark']]){
    await layout(width,height,theme);await input();await screenshot(`keyboard-${width}x${height}.png`);assert(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'));await done();await menuCommand('misc','about');await poll(()=>evaluate('document.querySelector("#about-dialog").open'),'About dialog');await screenshot(`about-${width}x${height}.png`);await click('#about-dialog [data-close-about]');await menuCommand('misc','keyboard');await poll(()=>evaluate('document.querySelector("#help-dialog").open'),'Help dialog');await screenshot(`help-${width}x${height}.png`);const rect=await evaluate('(()=>{const r=document.querySelector("#help-dialog").getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};})()');assert(rect.x>=-1&&rect.y>=-1&&rect.right<=width+1&&rect.bottom<=height+1);await click('#help-dialog [data-close-help]');
  }
  for(const variant of ['missing','empty','html']){await reloadCase(variant);assert.equal(await evaluate('window.dkcDebug.content().help'),false);assert.equal(await evaluate('window.dkcDebug.content().about'),true);assert.equal(await evaluate('Array.from(document.querySelectorAll("[data-command=keyboard]")).every(button=>button.disabled)'),true);await menuCommand('misc','about');assert.equal(await evaluate('document.querySelector("#about-dialog").open'),true);await click('#about-dialog [data-close-about]');}
  await evaluate('localStorage.setItem("dkc.keyboard-settings.v2","{invalid")');await reloadCase('');assert.equal((await keyboard()).mode,'keyboard');assert.equal((await keyboard()).isDefault,true);assert.equal((await keyboard()).storageAvailable,false);await input();assert.equal(await evaluate('document.querySelector("#keyboard-save").disabled'),false,'Corrupt fallback must allow saving repaired settings');await click('#keyboard-save');assert.equal((await keyboard()).storageAvailable,true);assert.equal(await evaluate('JSON.parse(localStorage.getItem("dkc.keyboard-settings.v2")).schema'),'dkc.keyboard-settings');await done();report.checks.push('Corrupt keyboard storage safely falls back to default keys and can be repaired with Save; Space can be remapped to a game action without pausing play.');
  await reloadCase('');assert.equal(await evaluate('window.dkcDebug.content().help'),true);assert.equal(await evaluate('Array.from(document.querySelectorAll("[data-command=keyboard]")).every(button=>!button.disabled)'),true);await evaluate(`window.dkcDebug.importSave(${JSON.stringify(originalSram)})`);await evaluate('window.dkcDebug.flushSaves()');originalSram=null;
  report.checks.push('Missing, empty, and HTML-fallback Help disables every Help command while About remains usable; restoring Markdown re-enables Help. Desktop/portrait/landscape content and keyboard UI fit.');
  }
  report.sourcesAfter=await sourceHashes();report.sourceUnchanged=JSON.stringify(report.sources)===JSON.stringify(report.sourcesAfter);assert(report.sourceUnchanged,'Production source changed during verification.');assert.equal(report.javascriptErrors.length,0);assert.equal(report.consoleErrors.length,0);report.result='passed';
}catch(error){report.result='failed';report.error={message:error.message,stack:error.stack};process.exitCode=1;if(client&&session)try{report.failureState=await evaluate('({keyboard:window.dkcDebug?.keyboard(),content:window.dkcDebug?.content(),state:window.dkcDebug?.status(),active:document.activeElement?.outerHTML,input:window.__keyboardTest?.inputs.slice(-10)})');await screenshot('failure.png');}catch{}}
finally{
  if(originalSram&&client&&session)try{if(!await evaluate('window.dkcDebug.status().loaded'))await loadRom();await evaluate(`window.dkcDebug.importSave(${JSON.stringify(originalSram)})`);await evaluate('window.dkcDebug.flushSaves()');report.originalSramRestored=true;}catch{}
  if(client){try{await client.send('Browser.close',{},null,5000);}catch{}client.socket.close();}if(chrome?.exitCode===null){await Promise.race([new Promise(yes=>chrome.once('exit',yes)),delay(3000)]);if(chrome.exitCode===null)chrome.kill('SIGTERM');}for(const stream of streams)stream.end();if(server?.exitCode===null)server.kill('SIGTERM');await rm(profile,{recursive:true,force:true,maxRetries:4,retryDelay:100}).catch(()=>{});report.finished=new Date().toISOString();await writeFile(join(output,'evidence.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({result:report.result,checks:report.checks,error:report.error?.message,evidence:join(output,'evidence.json')},null,2));
}
