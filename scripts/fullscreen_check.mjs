#!/usr/bin/env node
// Focused real-fullscreen/paused-resize regression. Node 22 and Chrome; no packages.
import assert from 'node:assert/strict';
import {checkVideoPixels} from './video_filter_check.mjs';
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
  else if(process.argv[i]==='--help'){console.log('node scripts/fullscreen_check.mjs [--rom /absolute/game.smc]');process.exit(0);}
  else throw new Error(`Unknown option: ${process.argv[i]}`);
}
const stamp=new Date().toISOString().replace(/[:.]/g,'-')+`-${process.pid}`;
const output=join(root,'build/fullscreen-check',stamp),profile=join(root,'.local/fullscreen-check-profile',stamp);
await mkdir(output,{recursive:true});await mkdir(profile,{recursive:true});
const report={started:new Date().toISOString(),actualFullscreen:true,romLoaded:Boolean(rom),cases:[],javascriptErrors:[],result:'running'};
let server,chrome,client,session;
const streams=[];
class CDP{
  constructor(url){
    this.id=1;this.pending=new Map();this.listeners=new Map();this.socket=new WebSocket(url);
    this.ready=new Promise((yes,no)=>{this.socket.addEventListener('open',yes,{once:true});this.socket.addEventListener('error',no,{once:true});});
    this.socket.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.id){const entry=this.pending.get(data.id);if(!entry)return;this.pending.delete(data.id);clearTimeout(entry.timer);data.error?entry.no(new Error(data.error.message)):entry.yes(data.result||{});}else for(const callback of this.listeners.get(data.method)||[])callback(data.params,data.sessionId);});
    this.socket.addEventListener('close',()=>{for(const entry of this.pending.values()){clearTimeout(entry.timer);entry.no(new Error('CDP closed.'));}this.pending.clear();});
  }
  on(name,callback){const callbacks=this.listeners.get(name)||[];callbacks.push(callback);this.listeners.set(name,callbacks);}
  async send(method,params={},target=session,timeout=60000){await this.ready;const id=this.id++;return new Promise((yes,no)=>{const timer=setTimeout(()=>{this.pending.delete(id);no(new Error(`Timeout: ${method}`));},timeout);this.pending.set(id,{yes,no,timer});const command={id,method,params};if(target)command.sessionId=target;this.socket.send(JSON.stringify(command));});}
}
function log(child,name){const stream=createWriteStream(join(output,name));streams.push(stream);child.stdout?.on('data',data=>stream.write(data));child.stderr?.on('data',data=>stream.write(data));}
async function poll(action,name,timeout=20000){let last;const deadline=Date.now()+timeout;while(Date.now()<deadline){try{const value=await action();if(value)return value;}catch(error){last=error;if(error.fatal)throw error;}await delay(50);}throw new Error(`Timed out: ${name}${last?` (${last.message})`:''}`);}
async function evaluate(expression){const result=await client.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result?.value;}
async function screenshot(name){const result=await client.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});await writeFile(join(output,name),Buffer.from(result.data,'base64'));}
async function port(){const holder=createServer();await new Promise((yes,no)=>{holder.once('error',no);holder.listen(0,'127.0.0.1',yes);});const value=holder.address().port;await new Promise(yes=>holder.close(yes));return value;}
const geometry=`(()=>{const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};const canvas=document.querySelector('#screen'),navigation=document.querySelector('.app-menubar'),player=document.querySelector('.player');return {fullscreen:document.fullscreenElement?.className,fullscreenHasNavigation:document.fullscreenElement?.contains(navigation)||false,navigationSeparate:!player.contains(navigation),removedRegions:document.querySelectorAll('.menubar-caption,.app-navigation,.toolbar,.app-status,#placeholder').length,canvasFocused:document.activeElement===canvas,bottomHitIsScreen:Boolean(document.elementFromPoint(innerWidth/2,innerHeight-2)?.closest('.screen-wrap')),viewport:{width:innerWidth,height:innerHeight},player:rect('.player'),screen:rect('.screen-wrap'),canvas:rect('#screen'),navigation:rect('.app-menubar'),buffer:{width:canvas.width,height:canvas.height},dpr:devicePixelRatio,gpuViewport:window.__lastGameViewport||null,frameCount:window.dkcDebug.status().frameCount};})()`;
function contained(inner,outer,label){assert(inner.x>=outer.x-1&&inner.y>=outer.y-1&&inner.right<=outer.right+1&&inner.bottom<=outer.bottom+1,`${label} is clipped: ${JSON.stringify({inner,outer})}`);}

async function menu(group, command) {
  await evaluate(`(() => {
    const trigger = [...document.querySelectorAll('[aria-controls="menu-${group}"],[aria-controls="menu-more"]')]
      .find(button=>button.getClientRects().length);
    trigger.click();
    const section=document.getElementById(trigger.getAttribute('aria-controls'));
    const item=section.querySelector('[data-command="${command}"]');
    if(!item || item.disabled || !item.getClientRects().length)throw new Error('Unavailable ${command} command');
    item.click();
  })()`);
}
async function selectVideo(key,value) {
  await evaluate(`(() => {
    const control=document.querySelector('#settings-pane-video [data-pref="${key}"]');
    if(control.type==='checkbox')control.checked=${JSON.stringify(value)};
    else control.value=${JSON.stringify(value)};
    control.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
}
async function openVideo(){
  await menu('config','video');
  await poll(()=>evaluate("document.querySelector('#app-settings').open"),'Video settings');
}
async function enterFullscreen(){
  await evaluate("document.querySelector('#settings-pane-video [data-command=fullscreen]').click()");
  await poll(()=>evaluate("document.fullscreenElement===document.querySelector('.screen-wrap')"),'screen-only fullscreen');
}
async function leaveFullscreen(){
  await client.send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode:27});
  await client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode:27});
  await poll(()=>evaluate('!document.fullscreenElement'),'fullscreen exit');
}
try{
  const origin=`http://127.0.0.1:${await port()}/`;
  server=spawn(process.env.PYTHON||'python3',[join(root,'scripts/serve.py'),'--port',new URL(origin).port],{cwd:root,stdio:['ignore','pipe','pipe']});log(server,'server.log');
  await poll(async()=>{const response=await fetch(origin);return response.ok;},'local server');
  const flags=['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--window-size=1280,720','about:blank'];
  report.chromeFlags=flags;
  chrome=spawn(process.env.CHROME_BIN||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',flags,{cwd:root,stdio:['ignore','pipe','pipe']});log(chrome,'chrome.log');
  const endpoint=await poll(async()=>{const [p,path]=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).trim().split('\n');return `ws://127.0.0.1:${p}${path}`;},'Chrome');
  client=new CDP(endpoint);await client.ready;report.browser=await client.send('Browser.getVersion',{},null);
  const target=await client.send('Target.createTarget',{url:'about:blank'},null);session=(await client.send('Target.attachToTarget',{targetId:target.targetId,flatten:true},null)).sessionId;
  client.on('Runtime.exceptionThrown',(data,id)=>{if(id===session)report.javascriptErrors.push(data.exceptionDetails);});
  await client.send('Page.enable');await client.send('Runtime.enable');
  await client.send('Page.addScriptToEvaluateOnNewDocument',{source:`if(globalThis.GPURenderPassEncoder){const original=GPURenderPassEncoder.prototype.setViewport;GPURenderPassEncoder.prototype.setViewport=function(...args){window.__lastGameViewport=args;window.__gameDraws=(window.__gameDraws||0)+1;return original.apply(this,args);};}`});
  await client.send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,screenWidth:1280,screenHeight:720,deviceScaleFactor:1,mobile:false});
  await client.send('Page.navigate',{url:origin});
  await poll(()=>evaluate(`Boolean(window.dkcDebug&&document.querySelector('#status').textContent.startsWith('Ready'))`),'WebGPU player');
  report.videoPixels=await evaluate('('+checkVideoPixels.toString()+')()');
  if(rom){
    const {root:document}=await client.send('DOM.getDocument');
    const {nodeId}=await client.send('DOM.querySelector',{nodeId:document.nodeId,selector:'#rom-file'});
    await client.send('DOM.setFileInputFiles',{nodeId,files:[rom]});
    await poll(async()=>{const result=await evaluate(`({loaded:window.dkcDebug.status().loaded,loading:window.dkcDebug.status().loading,error:document.querySelector('#status').classList.contains('error'),message:document.querySelector('#status').textContent})`);if(result.error&&!result.loading){const error=new Error(result.message);error.fatal=true;throw error;}return result.loaded&&!result.loading;},'ROM',120000);
    await evaluate('window.dkcDebug.runFrames(600,0)');
    await poll(()=>evaluate('window.dkcDebug.status().presentedFrame===600'),'paused source presentation');
    report.sourceHash=await evaluate('window.dkcDebug.frameHash()');
    assert.equal(report.sourceHash.sha256,'a7366146a96b47e75d48d3814bfe0859c71f68bcc3fac3d7429befb9b50430dd');
  }
  report.before=await evaluate(geometry);
  assert.equal(report.before.navigationSeparate,true,'Navigation must not be inside the player.');
  assert.equal(report.before.removedRegions,0,'Removed regions must not exist.');
  await openVideo();
  await enterFullscreen();
  await poll(()=>evaluate(`document.activeElement===document.querySelector('#screen')`),'keyboard focus after fullscreen entry');
  const sizes=[[1280,720,1],[1920,1080,1],[1024,768,1],[800,1000,1],[480,320,1],[1280,720,2]];
  for(const [width,height,dpr] of sizes){
    const caseReport={requested:{width,height,dpr}};report.cases.push(caseReport);
    const previousDraws=await evaluate('window.__gameDraws||0');
    await client.send('Emulation.setDeviceMetricsOverride',{width,height,screenWidth:width,screenHeight:height,deviceScaleFactor:dpr,mobile:false});
    await delay(150);
    await poll(()=>evaluate(`window.__lastGameViewport&&document.querySelector('#screen').width===Math.max(1,Math.round(document.querySelector('#screen').getBoundingClientRect().width*devicePixelRatio))&&document.querySelector('#screen').height===Math.max(1,Math.round(document.querySelector('#screen').getBoundingClientRect().height*devicePixelRatio))`),'paused resize redraw');
    const g=await evaluate(geometry);caseReport.geometry=g;
    const viewport={x:0,y:0,right:g.viewport.width,bottom:g.viewport.height};
    assert.equal(g.fullscreen,'screen-wrap');
    assert.equal(g.fullscreenHasNavigation,false,'Navigation must remain outside fullscreen.');
    assert.equal(g.navigationSeparate,true,'Navigation moved into player.');assert.equal(g.removedRegions,0,'Removed regions reappeared.');
    assert.equal(g.canvasFocused,true,'Fullscreen game lost keyboard focus.');
    for(const name of ['screen','canvas'])contained(g[name],viewport,name);
    contained(g.canvas,g.screen,'canvas in screen');
    assert(Math.abs(g.screen.x)<1&&Math.abs(g.screen.y)<1&&Math.abs(g.screen.width-g.viewport.width)<1&&Math.abs(g.screen.height-g.viewport.height)<1,'Fullscreen screen must fill the whole viewport without reserving navigation space.');
    assert.equal(g.bottomHitIsScreen,true,'Controls or another page element cover the fullscreen game.');
    assert(g.screen.height>0&&g.canvas.height>0,'Screen collapsed.');
    assert.equal(g.buffer.width,Math.max(1,Math.round(g.canvas.width*g.dpr)));
    assert.equal(g.buffer.height,Math.max(1,Math.round(g.canvas.height*g.dpr)));
    const [x,y,w,h]=g.gpuViewport;
    assert(Math.abs(w/h-4/3)<1e-5,'GPU game aspect is not 4:3.');
    assert(x>=-.01&&y>=-.01&&x+w<=g.buffer.width+.01&&y+h<=g.buffer.height+.01,'GPU game viewport clips the canvas.');
    assert(Math.abs(x-(g.buffer.width-w)/2)<.01&&Math.abs(y-(g.buffer.height-h)/2)<.01,'GPU game viewport is not centered.');
    assert(Math.abs(w-g.buffer.width)<.02||Math.abs(h-g.buffer.height)<.02,'Game does not use the largest contained scale.');
    if(rom)assert.equal(g.frameCount,600,'Fullscreen/resize advanced the paused simulation.');
    caseReport.drawsBefore=previousDraws;caseReport.drawsAfter=await evaluate('window.__gameDraws||0');
    await screenshot(`${width}x${height}-dpr${dpr}.png`);
  }
  await leaveFullscreen();
  await delay(150);report.after=await evaluate(geometry);
  assert.equal(report.after.canvasFocused,true,'Keyboard focus must return to the game after fullscreen exit.');
  assert.equal(report.after.navigationSeparate,true,'Navigation must remain separate after fullscreen exit.');assert.equal(report.after.removedRegions,0);
  if(rom){assert.equal(report.after.frameCount,600);report.finalSourceHash=await evaluate('window.dkcDebug.frameHash()');assert.deepEqual(report.finalSourceHash,report.sourceHash);}
  // Change source geometry from each real Config menu. Work through the
  // compact menu as well, then check windowed and fullscreen containment.
  report.videoModes=[];
  for(const [width,height] of [[440,680],[1200,780]]){
    await client.send('Emulation.setDeviceMetricsOverride',{width,height,screenWidth:width,screenHeight:height,deviceScaleFactor:1,mobile:false});
    for(const [aspect,pixels] of [['16:9',342],['16:10',308],['4:3',256]]){
      await openVideo();
      await selectVideo('aspect',aspect);
      const pixelAspect=width===440?'square':'snes';
      await selectVideo('pixelAspect',pixelAspect);
      const ratio=pixels/224*(pixelAspect==='square'?1:7/6);
      const checkRatio=()=>poll(()=>evaluate(`window.__lastGameViewport && Math.abs(window.__lastGameViewport[2]/window.__lastGameViewport[3]-${ratio})<.00001`),'wide framebuffer aspect');
      await checkRatio();
      const windowed=await evaluate(geometry);
      await enterFullscreen();await checkRatio();
      const full=await evaluate(geometry);
      const [x,y,w,h]=full.gpuViewport;
      assert(Math.abs(x-(full.buffer.width-w)/2)<.02 && Math.abs(y-(full.buffer.height-h)/2)<.02);
      assert(x>=-.01 && y>=-.01 && x+w<=full.buffer.width+.01 && y+h<=full.buffer.height+.01);
      assert(Math.abs(w-full.buffer.width)<.02 || Math.abs(h-full.buffer.height)<.02);
      assert.equal(full.fullscreenHasNavigation,false);
      assert.equal(full.navigationSeparate,true);
      if(rom)assert.equal(full.frameCount,600);
      report.videoModes.push({width,height,aspect,pixelAspect,windowed:windowed.gpuViewport,fullscreen:full.gpuViewport});
      await leaveFullscreen();
    }
  }
  if(rom){
    await openVideo();await selectVideo('fullscreenOnStart',true);
    await evaluate("document.querySelector('#settings-done').click()");
    await poll(()=>evaluate("!document.querySelector('#app-settings').open"),'closed Video');
    await menu('dkm','reset-game');
    await poll(()=>evaluate("window.dkcDebug.status().loaded && !window.dkcDebug.status().hasStarted && !window.dkcDebug.status().loading"),'fresh ROM');
    await menu('dkm','start-game');
    await poll(()=>evaluate("window.dkcDebug.status().running && document.fullscreenElement===document.querySelector('.screen-wrap')"),'fullscreen on Start');
    report.fullscreenOnStart=true;
    await leaveFullscreen();
  }
  assert.equal(report.javascriptErrors.length,0,'JavaScript exception during fullscreen.');
  report.result='passed';
}catch(error){report.result='failed';report.error={message:error.message,stack:error.stack};process.exitCode=1;if(client&&session)try{report.failureGeometry=await evaluate(geometry);await screenshot('failure.png');}catch{}}
finally{
  if(client){try{await client.send('Browser.close',{},null,5000);}catch{}client.socket.close();}
  if(chrome?.exitCode===null){await Promise.race([new Promise(yes=>chrome.once('exit',yes)),delay(3000)]);if(chrome.exitCode===null)chrome.kill('SIGTERM');}
  if(server?.exitCode===null){server.kill('SIGINT');await Promise.race([new Promise(yes=>server.once('exit',yes)),delay(3000)]);if(server.exitCode===null)server.kill('SIGTERM');}
  await rm(profile,{recursive:true,force:true});for(const stream of streams)stream.end();
  report.finished=new Date().toISOString();await writeFile(join(output,'evidence.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({result:report.result,cases:report.cases.length,error:report.error?.message,evidence:join(output,'evidence.json')},null,2));
}
