#!/usr/bin/env node
// Real Chrome UI, menu, dialog, and responsive presentation checks. No packages.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,rm,stat} from 'node:fs/promises';
import {createServer} from 'node:net';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
let rom=null,inputTabsOnly=false,dkmMenuOnly=false,romStorageOnly=false;
for(let i=2;i<process.argv.length;i++){
  if(process.argv[i]==='--rom')rom=resolve(process.argv[++i]);
  else if(process.argv[i]==='--input-tabs')inputTabsOnly=true;
  else if(process.argv[i]==='--dkm-menu')dkmMenuOnly=true;
  else if(process.argv[i]==='--rom-storage')romStorageOnly=true;
  else if(process.argv[i]==='--help'){console.log('node scripts/ui_check.mjs [--rom /absolute/game.smc] [--input-tabs|--dkm-menu|--rom-storage]');process.exit(0);}
  else throw new Error(`Unknown option: ${process.argv[i]}`);
}
if(romStorageOnly&&!rom)throw new Error('--rom-storage requires --rom /path/to/game.smc');
if(rom)await stat(rom);
const stamp=new Date().toISOString().replace(/[:.]/g,'-')+`-${process.pid}`;
const output=join(root,romStorageOnly?'build/rom-storage-check':dkmMenuOnly?'build/dkm-menu-check':inputTabsOnly?'build/input-tabs-check':'build/ui-check',stamp),profile=join(root,'.local/ui-check-profile',stamp);
await mkdir(output,{recursive:true});await mkdir(profile,{recursive:true});
const report={started:new Date().toISOString(),romLoaded:Boolean(rom),checks:[],layouts:[],javascriptErrors:[],consoleErrors:[],result:'running'};
let server,chrome,client,session;
const fileChoosers=[];
const streams=[];
class CDP{
  constructor(url){
    this.id=1;this.pending=new Map();this.listeners=new Map();this.socket=new WebSocket(url);
    this.ready=new Promise((yes,no)=>{this.socket.addEventListener('open',yes,{once:true});this.socket.addEventListener('error',no,{once:true});});
    this.socket.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.id){const item=this.pending.get(data.id);if(!item)return;this.pending.delete(data.id);clearTimeout(item.timer);data.error?item.no(new Error(data.error.message)):item.yes(data.result||{});}else for(const callback of this.listeners.get(data.method)||[])callback(data.params,data.sessionId);});
    this.socket.addEventListener('close',()=>{for(const item of this.pending.values()){clearTimeout(item.timer);item.no(new Error('CDP closed.'));}this.pending.clear();});
  }
  on(name,callback){const list=this.listeners.get(name)||[];list.push(callback);this.listeners.set(name,list);return ()=>this.listeners.set(name,(this.listeners.get(name)||[]).filter(item=>item!==callback));}
  async send(method,params={},target=session,timeout=60000){await this.ready;const id=this.id++;return new Promise((yes,no)=>{const timer=setTimeout(()=>{this.pending.delete(id);no(new Error(`Timeout: ${method}`));},timeout);this.pending.set(id,{yes,no,timer});const command={id,method,params};if(target)command.sessionId=target;this.socket.send(JSON.stringify(command));});}
}
function log(child,name){const stream=createWriteStream(join(output,name));streams.push(stream);child.stdout?.on('data',data=>stream.write(data));child.stderr?.on('data',data=>stream.write(data));}
async function poll(action,name,timeout=20000){let last;const deadline=Date.now()+timeout;while(Date.now()<deadline){try{const value=await action();if(value)return value;}catch(error){last=error;if(error.fatal)throw error;}await delay(60);}throw new Error(`Timed out: ${name}${last?` (${last.message})`:''}`);}
async function evaluate(expression){const data=await client.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(data.exceptionDetails)throw new Error(data.exceptionDetails.exception?.description||data.exceptionDetails.text);return data.result?.value;}
async function click(selector){await evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(!element)throw new Error('Missing '+${JSON.stringify(selector)});element.click();})()`);await delay(75);}
async function assertSound(enabled){
  const actual=await inPage(()=>{
    const button=document.querySelector('[data-sound-label]');
    return [window.dkcDebug.status().sound,button.getAttribute('aria-pressed'),button.textContent.trim()];
  });
  assert.deepEqual(actual,[enabled,String(enabled),enabled?'Sound On':'Sound Off']);
}
async function outputPeak(duration){
  return inPage(async milliseconds=>{
    const analyser=window.__uiTest.outputAnalyser;
    const samples=new Float32Array(analyser.fftSize);
    const end=performance.now()+milliseconds;
    let peak=0;
    do {
      analyser.getFloatTimeDomainData(samples);
      for(const sample of samples)peak=Math.max(peak,Math.abs(sample));
      await new Promise(requestAnimationFrame);
    } while(performance.now()<end);
    return peak;
  },duration);
}
async function pointerClick(selector){const point=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);await client.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});await client.send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});await delay(75);}
async function screenshot(name){const data=await client.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});await writeFile(join(output,name),Buffer.from(data.data,'base64'));}
async function unusedPort(){const holder=createServer();await new Promise((yes,no)=>{holder.once('error',no);holder.listen(0,'127.0.0.1',yes);});const value=holder.address().port;await new Promise(yes=>holder.close(yes));return value;}
async function key(value,code=value,virtual=null,modifiers=0){const known={ArrowDown:40,ArrowUp:38,ArrowLeft:37,ArrowRight:39,Escape:27,Enter:13,Home:36,End:35,Tab:9,' ':32};const vk=virtual??known[value]??0;await client.send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:value,code,windowsVirtualKeyCode:vk,nativeVirtualKeyCode:vk,modifiers});await client.send('Input.dispatchKeyEvent',{type:'keyUp',key:value,code,windowsVirtualKeyCode:vk,nativeVirtualKeyCode:vk,modifiers});await delay(40);}
async function visible(selector){return evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(!element)return false;const style=getComputedStyle(element),rect=element.getBoundingClientRect();return style.display!=='none'&&style.visibility!=='hidden'&&rect.width>0&&rect.height>0&&!element.closest('[hidden]');})()`);}
function menuName(name){return ({mobile:'more',file:'dkm',app:'config',view:'config',game:'config'})[name]||name;}
async function openMenu(name){name=menuName(name);await click(`[aria-controls="menu-${name}"]`);await poll(()=>visible(`#menu-${name}`),`${name} menu`);}
async function command(menu,name){
  if(menu==='app'&&name==='settings')name='controllers';
  if(menu==='mobile'&&name==='settings')name='controllers';
  if(menu==='game'||menu==='view'){
    const section=({toggle:'speed',audio:'sound',fullscreen:'video'})[name];
    const wasRunning=await evaluate('window.dkcDebug.status().running');
    await command('config',section);
    await poll(()=>evaluate(`document.querySelector('#app-settings').open`),`${section} settings open`);
    if(name==='toggle'&&wasRunning){await closeSettings();return;}
    await click(`[data-settings-pane="${section}"] [data-command="${name}"]`);
    if(name==='audio')await closeSettings();
    return;
  }
  menu=menuName(menu);
  if(menu!=='more'&&await visible('.compact-more > .menu-trigger'))menu='more';
  await openMenu(menu);await click(`#menu-${menu} [data-command="${name}"]`);
  // Legacy controller-profile scenarios explicitly select Gamepad; fresh keyboard defaults have their own regression.
  if(name==='controllers')await gamepadSource();
}
async function fileCommand(menu,name,expectedInput){
  const before=fileChoosers.length;await command(menu,name);
  await poll(()=>fileChoosers.length>before,`native ${expectedInput} picker`);
  const {backendNodeId}=fileChoosers.at(-1);const {node}=await client.send('DOM.describeNode',{backendNodeId});
  const attributes=node.attributes||[];assert.equal(attributes[attributes.indexOf('id')+1],expectedInput,'Menu opened the wrong file picker.');
  await client.send('DOM.setFileInputFiles',{backendNodeId,files:[]});
  await client.send('Page.bringToFront');await poll(()=>evaluate('!document.hidden'),'page foreground after native picker');
}
async function gamepadSource(){if(await evaluate('document.querySelector("#input-source").value!=="gamepad"')){await evaluate('(()=>{const input=document.querySelector("#input-source");input.value="gamepad";input.dispatchEvent(new Event("change",{bubbles:true}));})()');await poll(()=>evaluate('window.dkcDebug.keyboard().mode==="gamepad"'),'Gamepad source selected');}}
async function settingsTab(name){
  if(name==='keyboard'){
    if(await evaluate(`Boolean(document.querySelector('#help-dialog')?.open)`))return;
    if(await evaluate(`document.querySelector('#app-settings').open`))await closeSettings();
    await command('misc','keyboard');await poll(()=>evaluate(`document.querySelector('#help-dialog').open`),'Help dialog');return;
  }
  if(await evaluate(`Boolean(document.querySelector('#help-dialog')?.open)`))await closeSettings();
  if(!await evaluate(`document.querySelector('#app-settings').open`)){await command('config',name);await poll(()=>visible(`[data-settings-pane="${name}"]`),`${name} settings pane`);return;}
  if(['controllers','devices','options'].includes(name)&&!await visible(`[data-settings-tab="${name}"]`))await click('#settings-page-input');
  await click(`[data-settings-tab="${name}"]`);await poll(()=>visible(`[data-settings-pane="${name}"]`),`${name} settings pane`);
  if(name==='controllers')await gamepadSource();
}
async function closeSettings(){
  if(await evaluate(`Boolean(document.querySelector('#help-dialog')?.open)`)){await click('#help-dialog [data-close-help]');await poll(()=>evaluate(`!document.querySelector('#help-dialog').open`),'Help closed');return;}
  await click('#settings-done');await poll(()=>evaluate(`!document.querySelector('#app-settings').open`),'settings closed');
}
async function viewport(width,height,dpr=1,theme='light'){
  await client.send('Emulation.setDeviceMetricsOverride',{width,height,screenWidth:width,screenHeight:height,deviceScaleFactor:dpr,mobile:false});
  await client.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme},{name:'prefers-reduced-motion',value:'reduce'}]});
  await delay(180);
}
const geometry=`(()=>{const rect=selector=>{const e=document.querySelector(selector),r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};const canvas=document.querySelector('#screen'),navigation=document.querySelector('.app-menubar'),player=document.querySelector('.player');return {window:{width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight},player:rect('.player'),screen:rect('.screen-wrap'),canvas:rect('#screen'),navigation:rect('.app-menubar'),navigationSeparate:!player.contains(navigation),buffer:{width:canvas.width,height:canvas.height},gpuViewport:window.__lastGameViewport||null,background:getComputedStyle(document.body).backgroundColor,frameCount:window.dkcDebug.status().frameCount};})()`;
async function assertMenuOnly(){
  const layout=await evaluate(`(()=>{const app=document.querySelector('.app-window'),game=document.querySelector('.game-workspace').cloneNode(true);game.querySelector('#pause-overlay')?.remove();return {removedRegions:app.querySelectorAll('.menubar-caption,.app-navigation,.toolbar,.app-status,#placeholder,.empty-state').length,navigations:app.querySelectorAll('nav').length,allControlsInNavigation:[...app.querySelectorAll('button,input,select,textarea,a[href]')].every(e=>Boolean(e.closest('.app-menubar'))),gameText:game.textContent.trim(),gameControls:document.querySelector('.game-workspace').querySelectorAll('button,input,select,textarea,a[href]').length};})()`);
  assert.equal(layout.removedRegions,0,'Superseded interface regions still exist in the DOM.');
  assert.equal(layout.navigations,1,'Main interface must contain one navigation element.');
  assert.equal(layout.allControlsInNavigation,true,'Main controls exist outside application navigation.');
  assert.equal(layout.gameText,'','Game area contains text outside the requested pause overlay.');
  assert.equal(layout.gameControls,0,'Game area contains application controls.');
}
async function assertCoinAndMenus(){
  const value=await evaluate(`(()=>{const coin=document.querySelector('.menu-coin'),headings=[...document.querySelectorAll('#app-menubar > button, #app-menubar > .menu-group > button')].filter(e=>e.getClientRects().length);return {coin:Boolean(coin),interactive:coin?Boolean(coin.closest('button,a[href]')||coin.hasAttribute('tabindex')||coin.hasAttribute('aria-controls')||coin.getAttribute('role')==='button'):true,headings:headings.map(e=>e.textContent.trim()),disabled:headings.filter(e=>e.disabled).map(e=>e.textContent.trim())};})()`);
  assert(value.coin,'DK coin mark is missing.');assert.equal(value.interactive,false,'DK coin must be a static mark with no submenu.');
  assert.deepEqual(value.headings,['DKM','Config','Cheat','NetPlay','Misc'],'Menu order differs from the requested structure.');
  assert(value.disabled.includes('Cheat')&&value.disabled.includes('NetPlay'),'Unimplemented Cheat/NetPlay commands must stay disabled.');
  const order=await evaluate(`Array.from(document.querySelectorAll('#menu-config [data-command]')).map(e=>e.dataset.command)`);
  assert.deepEqual(order,['controllers','devices','options','video','sound','paths','saves','speed'],'Config ordering differs from the requested structure.');
  assert(await evaluate(`!document.querySelector('#menu-config [data-command="paths"]').disabled&&!document.querySelector('[data-settings-tab="paths"]').disabled`),'ROM storage settings must be reachable through Paths.');
  const artwork=await evaluate(`(async()=>{const image=new Image();image.src='./dk-coin.png';await image.decode();const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext('2d');context.drawImage(image,0,0);const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;let transparent=0,opaque=0,colored=0;for(let i=0;i<pixels.length;i+=4){if(pixels[i+3]===0)transparent++;if(pixels[i+3]>200){opaque++;if(Math.max(pixels[i],pixels[i+1],pixels[i+2])-Math.min(pixels[i],pixels[i+1],pixels[i+2])>2)colored++;}}return {width:canvas.width,height:canvas.height,transparent,opaque,colored};})()`);
  assert(artwork.width>0&&artwork.height>0&&artwork.transparent>0&&artwork.opaque>0,'Coin image must load with real transparent and opaque pixels.');assert.equal(artwork.colored,0,'Coin artwork is not monochrome.');
  report.coinArtwork=artwork;
  report.navigation=value;
}
async function resetAndVerify(menu){
  const original=await evaluate('window.dkcDebug.saveBytes()');
  const sentinel=original.map((value,index)=>(value+index*17+3)&255);
  const profiles=await evaluate(`localStorage.getItem('dkc.controller-settings.v1')`);
  const beforePickers=fileChoosers.length;
  try{
    await evaluate(`window.dkcDebug.importSave(${JSON.stringify(sentinel)})`);await evaluate('window.dkcDebug.flushSaves()');
    await command(menu,'reset-game');
    await poll(()=>evaluate('window.dkcDebug.status().loaded&&!window.dkcDebug.status().loading&&window.dkcDebug.status().frameCount===0'),'reset creates fresh paused game',120000);
    assert.equal(await evaluate('window.dkcDebug.status().running'),false,'Reset should leave the game paused.');
    assert.equal(fileChoosers.length,beforePickers,'Reset prompted for the already selected ROM.');
    assert.deepEqual(await evaluate('window.dkcDebug.saveBytes()'),sentinel,'Reset lost cartridge SRAM.');
    assert.equal(await evaluate(`localStorage.getItem('dkc.controller-settings.v1')`),profiles,'Reset changed controller profiles.');
    await evaluate('window.dkcDebug.runFrames(600,0)');
    assert.equal((await evaluate('window.dkcDebug.frameHash()')).sha256,'a7366146a96b47e75d48d3814bfe0859c71f68bcc3fac3d7429befb9b50430dd','Reset replay differs from clean native intro.');
  }finally{await evaluate(`window.dkcDebug.importSave(${JSON.stringify(original)})`);await evaluate('window.dkcDebug.flushSaves()');}
  report.checks.push(`${menu==='mobile'?'Compact':'DKM'} Reset reuses the ROM, restarts at frame zero, preserves SRAM/profiles, and replays the native 600-frame oracle.`);
}
function contain(rect,width,height,label){assert(rect.x>=-1&&rect.y>=-1&&rect.right<=width+1&&rect.bottom<=height+1,`${label} is outside viewport: ${JSON.stringify(rect)}`);}
async function inPage(action,...args){return evaluate('('+action.toString()+')('+args.map(value=>JSON.stringify(value)).join(',')+')');}
async function romStorageChecks(){
  async function pickRom(){
    const {root:doc}=await client.send('DOM.getDocument');
    const {nodeId}=await client.send('DOM.querySelector',{nodeId:doc.nodeId,selector:'#rom-file'});
    await client.send('DOM.setFileInputFiles',{nodeId,files:[rom]});
    await poll(()=>inPage(()=>window.dkcDebug.status().loaded&&!window.dkcDebug.status().loading&&!document.querySelector('#rom-file').files.length),'ROM picker completion');
  }
  async function reopen(){
    const old=await evaluate('performance.timeOrigin');
    await client.send('Page.reload');
    await poll(()=>inPage(time=>performance.timeOrigin!==time&&window.dkcDebug&&!document.querySelector('#remember-rom').disabled,old),'player storage initialization');
  }
  async function inspect(){
    return inPage(async()=>{
      const storage=await import('./storage.js');
      const {enabled,image}=await storage.readRememberedRom();
      const bytes=await storage.loadSave();
      return {enabled,length:image?.byteLength||0,sram:bytes?[...new Uint8Array(bytes)]:null};
    });
  }
  const selectPaths=async()=>{await command('config','paths');await poll(()=>visible('#remember-rom'),'ROM preference in Paths');};
  await selectPaths();assert.equal(await inPage(()=>document.querySelector('#remember-rom').checked),true);await closeSettings();
  await pickRom();
  const sample=Array.from({length:2048},(_,i)=>i%251);
  await inPage(async data=>{await window.dkcDebug.importSave(data);await window.dkcDebug.flushSaves();},sample);
  assert.deepEqual(await inspect(),{enabled:true,length:4194304,sram:sample});
  await reopen();
  const restored=await evaluate('window.dkcDebug.status()');
  assert(restored.loaded&&restored.paused&&!restored.hasStarted&&restored.frameCount===0);
  assert.deepEqual(await evaluate('window.dkcDebug.saveBytes()'),sample);
  report.checks.push('A verified selection reopens at frame zero with its existing SRAM and Start Game available.');

  await fileCommand('file','open-rom','rom-file');
  await inPage(()=>{
    const dt=new DataTransfer();
    dt.items.add(new File([new Uint8Array(4194304)],'invalid.smc'));
    const input=document.querySelector('#rom-file');input.files=dt.files;input.dispatchEvent(new Event('change'));
  });
  await poll(()=>inPage(()=>document.querySelector('#status').textContent.includes('SHA-256')),'invalid replacement rejected');
  await key('Escape');
  assert.deepEqual(await evaluate('window.dkcDebug.saveBytes()'),sample);
  await reopen();assert.equal(await evaluate('window.dkcDebug.status().loaded'),true);
  report.checks.push('Canceling or choosing a wrong-digest ROM preserves the playable cartridge, remembered copy and SRAM.');

  await viewport(390,844);await selectPaths();await click('#remember-rom');
  await poll(()=>inPage(()=>!document.querySelector('#remember-rom').disabled),'forget commit');
  assert.deepEqual(await inspect(),{enabled:false,length:0,sram:sample});
  assert.equal(await evaluate('window.dkcDebug.status().loaded'),true);
  await reopen();assert.equal(await evaluate('window.dkcDebug.status().loaded'),false);
  await pickRom();assert.deepEqual(await inspect(),{enabled:false,length:0,sram:sample});
  await selectPaths();await click('#remember-rom');await closeSettings();
  assert.deepEqual(await inspect(),{enabled:true,length:4194304,sram:sample});
  report.checks.push('Compact Paths removes the local ROM, preserves SRAM across reopening and reselection, and can remember the active cartridge again.');

  await inPage(async()=>{const {setRememberRom}=await import('./storage.js');await setRememberRom(true,new ArrayBuffer(4194304));});
  await reopen();assert.equal(await evaluate('window.dkcDebug.status().loaded'),false);
  assert.match(await evaluate("document.querySelector('#status').textContent"),/SHA-256/);
  await key('Escape');await pickRom();await reopen();
  assert.equal(await evaluate('window.dkcDebug.status().loaded'),true);
  assert.deepEqual(await evaluate('window.dkcDebug.saveBytes()'),sample);
  report.checks.push('A corrupt remembered ROM fails verification, and choosing the original repairs it with SRAM intact.');

  // Simulate the browser refusing only ROM storage. The real SRAM database stays available.
  const {identifier}=await client.send('Page.addScriptToEvaluateOnNewDocument',{source:`const original=IDBFactory.prototype.open;IDBFactory.prototype.open=function(name,...rest){if(name==='dkc-browser-rom')throw new DOMException('Storage refused','SecurityError');return original.call(this,name,...rest);};`});
  await reopen();assert.match(await evaluate("document.querySelector('#status').textContent"),/Storage refused/);
  await key('Escape');await pickRom();
  assert.equal(await evaluate('window.dkcDebug.status().loaded'),true);
  assert.match(await evaluate("document.querySelector('#rom-storage-status').textContent"),/Storage refused/);
  assert.deepEqual(await evaluate('window.dkcDebug.saveBytes()'),sample);
  await client.send('Page.removeScriptToEvaluateOnNewDocument',{identifier});
  await reopen();assert.equal(await evaluate('window.dkcDebug.status().loaded'),true);
  report.checks.push('A denied ROM database allows manual selection and play, reports the failure and keeps the previous ROM and SRAM.');
}
async function inputTabsChecks(){
  await assertMenuOnly();
  if(rom){
    const {root:document}=await client.send('DOM.getDocument');
    const {nodeId}=await client.send('DOM.querySelector',{nodeId:document.nodeId,selector:'#rom-file'});
    await client.send('DOM.setFileInputFiles',{nodeId,files:[rom]});
    await poll(()=>evaluate('window.dkcDebug.status().loaded&&!window.dkcDebug.status().loading'),'focused fixture ROM',120000);
    await evaluate('window.dkcDebug.resume()');
    await poll(()=>evaluate('window.dkcDebug.status().running'),'game running before input settings');
  }
  const inputNames=['controllers','devices','options'];
  for(const [width,height,theme] of [[1440,900,'light'],[390,844,'light'],[844,390,'dark'],[320,568,'dark']]){
    await viewport(width,height,1,theme);await client.send('Page.bringToFront');
    for(const name of inputNames){
      await command('config',name);await poll(()=>visible('[data-settings-pane="'+name+'"]'),name+' from menu');
      const shape=await inPage((names)=>{
        const rect=element=>{const r=element.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
        const page=document.querySelector('#input-settings-page'),sidebar=document.querySelector('.settings-navigation'),buttons=names.map(item=>document.querySelector('#settings-tab-'+item));
        return {section:document.querySelector('#app-settings').dataset.section,pageHidden:page.hidden,inputSelected:document.querySelector('#settings-page-input').getAttribute('aria-selected'),sidebarInputCount:sidebar.querySelectorAll('[data-settings-page="input"]').length,sidebarChildren:sidebar.querySelectorAll('[data-settings-tab="controllers"],[data-settings-tab="devices"],[data-settings-tab="options"]').length,tabParentsSame:buttons.every(button=>button.parentElement===buttons[0].parentElement),tablistRole:buttons[0].parentElement.getAttribute('role'),tabs:buttons.map(button=>({selected:button.getAttribute('aria-selected'),rect:rect(button)})),dialog:rect(document.querySelector('#app-settings')),scrollWidth:document.documentElement.scrollWidth,viewport:{width:innerWidth,height:innerHeight}};
      },inputNames);
      assert.equal(shape.section,name);assert.equal(shape.pageHidden,false);
      assert.equal(shape.inputSelected,'true','Input sidebar must stay selected for all three child tabs.');
      assert.equal(shape.sidebarInputCount,1);assert.equal(shape.sidebarChildren,0,'Child tabs were duplicated in the main sidebar.');
      assert.equal(shape.tabParentsSame,true);assert.equal(shape.tablistRole,'tablist');
      assert.deepEqual(shape.tabs.map(tab=>tab.selected),inputNames.map(item=>String(item===name)));
      for(const item of inputNames)assert(await visible('#settings-tab-'+item),'Input tab is hidden: '+item);
      const ys=shape.tabs.map(tab=>tab.rect.y);assert(Math.max(...ys)-Math.min(...ys)<=1,'Input child tabs are not horizontal.');
      for(const tab of shape.tabs)contain(tab.rect,width,height,'Input child tab');
      contain(shape.dialog,width,height,'Settings sheet');
      assert(shape.scrollWidth<=width+1,'Page horizontally overflows.');
      if(rom)assert.equal(await evaluate('window.dkcDebug.status().running'),false,'Opening input settings did not pause gameplay.');
      report.layouts.push({width,height,theme,name,...shape});
      if(name==='controllers'){await delay(180);await screenshot('input-tabs-'+width+'x'+height+'-'+theme+'.png');}
      await closeSettings();
    }
    await command('config','video');await poll(()=>visible('[data-settings-pane="video"]'),'Video page');
    assert.equal(await visible('.input-tabs'),false,'Input child tabs leak onto unrelated settings pages.');
    await closeSettings();
  }
  report.checks.push('Separate Input/Devices/Options menu commands select three horizontal tabs in one Input page; desktop, compact, short landscape, and 320px layouts fit.');

  await viewport(1440,900);await client.send('Page.bringToFront');await command('config','devices');
  await inPage(()=>document.querySelector('#settings-tab-devices').focus());await key('ArrowRight');
  await poll(()=>visible('[data-settings-pane="options"]'),'local ArrowRight to Options');
  await key('Home');await poll(()=>visible('[data-settings-pane="controllers"]'),'child Home to Input');
  await key('End');await poll(()=>visible('[data-settings-pane="options"]'),'child End to Options');
  await key('ArrowRight');await poll(()=>visible('[data-settings-pane="controllers"]'),'child ArrowRight wraps within input tabs');
  await inPage(()=>document.querySelector('#settings-page-input').focus());await key('End');
  await poll(()=>visible('[data-settings-pane="speed"]'),'sidebar End to Speed');
  await key('Home');await poll(()=>visible('#input-settings-page'),'sidebar Home to Input page');
  await click('[data-settings-tab="sound"]');await inPage(()=>document.querySelector('#settings-tab-sound').focus());await key('ArrowDown');
  await poll(()=>visible('[data-settings-pane="paths"]'),'sidebar ArrowDown reaches Paths');
  await key('ArrowDown');
  await poll(()=>visible('[data-settings-pane="saves"]'),'sidebar ArrowDown reaches Saves');
  assert.equal(await inPage(()=>document.activeElement.closest('[role="tablist"]').classList.contains('settings-navigation')),true,'Sidebar navigation escaped its tablist.');
  report.checks.push('Keyboard arrows and Home/End remain in the active tablist, including Paths and Saves.');

  await settingsTab('controllers');await click('#controller-new');
  await inPage(()=>{const input=document.querySelector('#controller-name');input.value='Input tabs unsaved regression';input.dispatchEvent(new Event('input',{bubbles:true}));});
  assert.equal(await evaluate('window.dkcDebug.controllers().dirty'),true);
  await click('#settings-tab-devices');assert(await visible('[data-settings-pane="controllers"]'),'Child tab switch discarded a draft.');
  await click('[data-settings-tab="video"]');assert(await visible('[data-settings-pane="controllers"]'),'Leaving Input discarded a draft.');
  await key('Escape');assert(await evaluate('document.querySelector("#app-settings").open'),'Escape discarded a draft.');
  await click('#settings-done');assert(await evaluate('document.querySelector("#app-settings").open'),'Done discarded a draft.');
  await inPage(()=>document.querySelector('#settings-tab-controllers').focus());await key('ArrowRight');
  assert(await visible('[data-settings-pane="controllers"]'),'Keyboard tab switch discarded a draft.');
  await click('#controller-discard');assert.equal(await evaluate('window.dkcDebug.controllers().dirty'),false);
  await settingsTab('devices');await settingsTab('options');await closeSettings();
  report.checks.push('Unsaved controller profiles guard child tab changes, leaving Input, Escape, Done, and keyboard navigation; discard permits navigation.');
}

async function dkmMenuChecks(){
  await assertMenuOnly();
  assert.equal(await evaluate(`document.querySelectorAll('#app-settings .sheet-eyebrow, #app-settings #settings-tab-keyboard').length`),0,'Removed Config elements remain in the DOM.');
  const expected=['Load ROM','—','Start Game','Reload Game','—','Load Save','Export Save'];
  for(const [width,height,menu] of [[1440,900,'file'],[390,844,'mobile']]){
    await viewport(width,height);await client.send('Page.bringToFront');await openMenu(menu);
    const shape=await inPage(id=>{
      const entries=[];
      for(const element of document.getElementById(id).children){
        if(element.classList.contains('menu-section-label')){if(element.textContent.trim()==='Config')break;continue;}
        if(element.matches('hr'))entries.push('—');
        else if(element.matches('[data-command]'))entries.push([...element.childNodes].find(node=>node.nodeType===Node.TEXT_NODE)?.textContent.trim().replace(/…$/,'')||'');
      }
      while(entries.at(-1)==='—')entries.pop();
      return {entries,startDisabled:document.querySelector('#'+id+' [data-command="start-game"]').disabled};
    },menu==='mobile'?'menu-more':'menu-dkm');
    assert.deepEqual(shape.entries,expected,'DKM order, labels, or separators differ from the requested layout.');
    assert.equal(shape.startDisabled,true,'Start Game must be unavailable before loading a ROM.');
    await screenshot(`dkm-unloaded-${width}x${height}.png`);await key('Escape');
  }
  report.checks.push('Wide and compact DKM menus have the requested labels, order, and separators; Start Game is disabled without a ROM. Config eyebrow and Help tab are removed.');
  if(rom){
    const {root:document}=await client.send('DOM.getDocument');
    const {nodeId}=await client.send('DOM.querySelector',{nodeId:document.nodeId,selector:'#rom-file'});
    await client.send('DOM.setFileInputFiles',{nodeId,files:[rom]});
    await poll(()=>evaluate('window.dkcDebug.status().loaded&&!window.dkcDebug.status().loading'),'DKM fixture ROM',120000);
  }
  for(const [width,height,menu] of [[1440,900,'file'],[390,844,'mobile']]){
    await viewport(width,height);await client.send('Page.bringToFront');
    if(rom){
      await evaluate('window.dkcDebug.pause()');await command(menu,'start-game');
      await poll(()=>evaluate('window.dkcDebug.status().running'),'Start Game starts the paused game');
      const before=await evaluate('window.dkcDebug.status().frameCount');await openMenu(menu);
      const selector=`#${menu==='mobile'?'menu-more':'menu-dkm'} [data-command="start-game"]`;
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).disabled`),false,'Pause Game should be enabled while running.');
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent.trim()`),'Pause Game');
      await click(selector);await poll(()=>evaluate('!window.dkcDebug.status().running'),'Pause Game pauses');
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent.trim()`),'Resume Game');
      await command(menu,'start-game');await poll(()=>evaluate('window.dkcDebug.status().running'),'Resume Game resumes');
      assert((await evaluate('window.dkcDebug.status().frameCount'))>=before,'Resume Game restarted the game.');
      await evaluate('window.dkcDebug.pause()');await resetAndVerify(menu);
    }
    await command('misc','keyboard');await poll(()=>evaluate(`document.querySelector('#help-dialog').open`),'standalone Misc Help');
    assert(await evaluate(`document.querySelector('#help-dialog').textContent.includes('Move')&&document.querySelector('#help-dialog').textContent.includes('Jump')`),'Help content is missing.');
    await screenshot(`misc-help-${width}x${height}.png`);await closeSettings();
    await command('config','controllers');await poll(()=>visible('.input-tabs'),'Input settings still reachable');
    assert.equal(await evaluate(`document.querySelectorAll('#app-settings .input-tabs [role="tab"]').length`),3);
    await click('#controller-new');await click('#settings-tab-devices');
    assert(await visible('[data-settings-pane="controllers"]'),'Input tab change discarded an unsaved profile.');
    await click('#controller-discard');await closeSettings();
    await command('config','devices');await poll(()=>visible('[data-settings-pane="devices"]'),'Devices menu still selects its tab');await closeSettings();
    await command('config','options');await poll(()=>visible('[data-settings-pane="options"]'),'Options menu still selects its tab');await closeSettings();
  }
  if(rom)report.checks.push('DKM changes between Start Game, Pause Game, and Resume Game without reloading; Reload Game preserves SRAM and profiles and reproduces the native reference.');
  report.checks.push('Misc Help works independently of Config; Input tabs and unsaved-profile guards remain intact.');
}

try{
  report.sources=Object.fromEntries(await Promise.all(['web/index.html','web/style.css','web/ui-shell.js','web/main.js','web/storage.js','web/worker.js','web/controller-ui.js','web/dk-coin.png'].map(async file=>[file,createHash('sha256').update(await readFile(join(root,file))).digest('hex')])));
  const origin=`http://127.0.0.1:${await unusedPort()}/`;
  server=spawn(process.env.PYTHON||'python3',[join(root,'scripts/serve.py'),'--port',new URL(origin).port],{cwd:root,stdio:['ignore','pipe','pipe']});log(server,'server.log');
  await poll(async()=>{const response=await fetch(origin);return response.ok;},'local UI server');
  chrome=spawn(process.env.CHROME_BIN||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--window-size=1440,900','about:blank'],{cwd:root,stdio:['ignore','pipe','pipe']});log(chrome,'chrome.log');
  const endpoint=await poll(async()=>{const [p,path]=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).trim().split('\n');return `ws://127.0.0.1:${p}${path}`;},'Chrome');
  client=new CDP(endpoint);await client.ready;report.browser=await client.send('Browser.getVersion',{},null);
  const target=await client.send('Target.createTarget',{url:'about:blank'},null);session=(await client.send('Target.attachToTarget',{targetId:target.targetId,flatten:true},null)).sessionId;
  client.on('Runtime.exceptionThrown',(data,id)=>{if(id===session)report.javascriptErrors.push(data.exceptionDetails);});
  client.on('Runtime.consoleAPICalled',(data,id)=>{if(id===session&&data.type==='error')report.consoleErrors.push(data.args.map(item=>item.value??item.description).join(' '));});
  await client.send('Runtime.enable');await client.send('Page.enable');
  await client.send('Page.setInterceptFileChooserDialog',{enabled:true});
  client.on('Page.fileChooserOpened',(data,id)=>{if(id===session)fileChoosers.push(data);});
  await client.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:output,eventsEnabled:true},null);
  const downloads=[];client.on('Browser.downloadWillBegin',data=>downloads.push(data));
  await client.send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__uiTest={fileInputs:[],pads:[{id:'Representative raw controller',index:0,connected:true,mapping:'',buttons:Array.from({length:12},()=>({pressed:false,value:0})),axes:[0,0,0,0,0,0,0,0,0,23/7]}]};Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>window.__uiTest.pads});const originalInputClick=HTMLInputElement.prototype.click;HTMLInputElement.prototype.click=function(...args){if(this.type==='file')window.__uiTest.fileInputs.push(this.id);return originalInputClick.apply(this,args);};if(globalThis.GPURenderPassEncoder){const original=GPURenderPassEncoder.prototype.setViewport;GPURenderPassEncoder.prototype.setViewport=function(...args){window.__lastGameViewport=args;return original.apply(this,args);};}`});
  await viewport(1440,900);
  await client.send('Page.navigate',{url:origin});
  await poll(()=>evaluate(`Boolean(window.dkcDebug&&document.querySelector('#status')?.textContent.startsWith('Ready')&&document.querySelector('#app-menubar'))`),'redesigned app and WebGPU',30000);
  if(romStorageOnly){
    await romStorageChecks();
  }else if(dkmMenuOnly){
    await dkmMenuChecks();
  }else if(inputTabsOnly){
    await inputTabsChecks();
  }else{
  await assertMenuOnly();
  await assertCoinAndMenus();
  const desktopCommands=await evaluate(`Array.from(document.querySelectorAll('.desktop-menu .app-menu [data-command]')).map(e=>e.dataset.command)`);
  for(const commandName of ['open-rom','start-game','reset-game','import-save','export-save','controllers','devices','options','video','sound','paths','saves','speed','keyboard','about'])assert(desktopCommands.includes(commandName),`Desktop menus omit ${commandName}.`);
  await screenshot('empty-desktop.png');await viewport(390,844);await screenshot('empty-compact.png');await viewport(1440,900);
  report.checks.push('Redesigned app initializes WebGPU without JavaScript exceptions.');

  await evaluate(`document.querySelector('[aria-controls="menu-dkm"]').focus()`);await key('ArrowDown');
  await poll(()=>visible('#menu-dkm'),'keyboard File menu');
  assert(await evaluate(`Boolean(document.activeElement.closest('#menu-dkm'))`),'ArrowDown did not move focus into menu.');
  await key('End');await key('Home');
  assert(await evaluate(`document.activeElement===Array.from(document.querySelectorAll('#menu-dkm [role^="menuitem"]')).find(e=>!e.disabled&&e.getAttribute('aria-disabled')!=='true')`),'Home did not focus first enabled menu item.');
  const menuOrder=await evaluate(`Array.from(document.querySelectorAll('#app-menubar .menu-trigger[aria-controls]')).filter(e=>e.getClientRects().length).map(e=>e.getAttribute('aria-controls').slice(5))`),fileIndex=menuOrder.indexOf('dkm');
  for(let step=1;step<=menuOrder.length;step++){
    const nextMenu=menuOrder[(fileIndex+step)%menuOrder.length];await key('ArrowRight');await poll(()=>visible(`#menu-${nextMenu}`),`next ${nextMenu} menu`);
    assert(await evaluate(`document.activeElement.closest('#menu-${nextMenu}')||document.activeElement.getAttribute('aria-controls')==='menu-${nextMenu}'`),'Menu focus remained in a hidden previous menu.');
  }
  await key('ArrowLeft');await poll(()=>visible(`#menu-${menuOrder[(fileIndex-1+menuOrder.length)%menuOrder.length]}`),'previous desktop menu');
  await key('ArrowRight');await poll(()=>visible('#menu-dkm'),'return to File menu');
  await screenshot('desktop-menu.png');await key('Escape');assert(!await visible('#menu-dkm'));
  assert(await evaluate(`document.activeElement===document.querySelector('[aria-controls="menu-dkm"]')`),'Menu Escape did not restore trigger focus.');
  await openMenu('view');
  await client.send('Input.dispatchMouseEvent',{type:'mousePressed',x:5,y:200,button:'left',clickCount:1});
  await client.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:5,y:200,button:'left',clickCount:1});
  await poll(async()=>!await visible('#menu-config'),'outside-click closes menu');
  await fileCommand('file','open-rom','rom-file');
  report.checks.push('Desktop menu keyboard navigation, Escape focus restoration, outside-click dismissal, and Open ROM action work.');

  const invalidRomMessage=await evaluate(`window.dkcDebug.loadRom(new ArrayBuffer(1)).then(()=>null,error=>error.message)`);
  assert.match(invalidRomMessage,/4,194,304/);
  await poll(()=>visible('#menu-dkm'),'ROM error is revealed inside desktop menu');
  assert(await evaluate(`document.querySelector('#status').classList.contains('error')`));
  await screenshot('desktop-error-menu.png');await key('Escape');
  report.checks.push('Invalid ROM reports its error in the application menu without restoring an external status region.');

  if(rom){
    const {root:document}=await client.send('DOM.getDocument');const {nodeId}=await client.send('DOM.querySelector',{nodeId:document.nodeId,selector:'#rom-file'});
    await client.send('DOM.setFileInputFiles',{nodeId,files:[rom]});
    await poll(()=>evaluate(`window.dkcDebug.status().loading||window.dkcDebug.status().loaded`),'ROM file begins loading');
    await poll(async()=>{const state=await evaluate(`({loaded:window.dkcDebug.status().loaded,loading:window.dkcDebug.status().loading,error:document.querySelector('#status').classList.contains('error'),message:document.querySelector('#status').textContent})`);if(state.error&&!state.loading){const error=new Error(state.message);error.fatal=true;throw error;}return state.loaded&&!state.loading;},'ROM and Wasm',120000);
    await evaluate('window.dkcDebug.runFrames(600,0)');report.frame=await evaluate('window.dkcDebug.frameHash()');assert.equal(report.frame.sha256,'a7366146a96b47e75d48d3814bfe0859c71f68bcc3fac3d7429befb9b50430dd');
    // Observe the worklet's rendered signal through a pass-through analyser.
    await inPage(()=>{
      const connect=AudioWorkletNode.prototype.connect;
      AudioWorkletNode.prototype.connect=function(destination,...args){
        if(destination!==this.context.destination)return connect.call(this,destination,...args);
        const analyser=this.context.createAnalyser();
        connect.call(this,analyser);
        window.__uiTest.outputAnalyser=analyser;
        return analyser.connect(destination,...args);
      };
    });
    await command('game','toggle');await poll(()=>evaluate('window.dkcDebug.status().running'),'Game menu starts game');
    const initialPeak=await poll(()=>outputPeak(180),'default sound reaches the audio output');
    await command('game','toggle');await poll(()=>evaluate('!window.dkcDebug.status().running'),'Game menu pauses game');
    await assertSound(true);
    await command('game','audio');await assertSound(false);
    await command('file','start-game');await poll(()=>evaluate('window.dkcDebug.status().running'),'DKM resumes while muted');
    await assertSound(false);
    const mutedPeak=await outputPeak(400);
    assert.equal(mutedPeak,0,'Rendered sound must be silent while muted.');
    await command('game','audio');await assertSound(true);
    await command('file','start-game');await poll(()=>evaluate('window.dkcDebug.status().running'),'DKM resumes with sound restored');
    const unmutedPeak=await poll(()=>outputPeak(180),'unmuted sound reaches the audio output');
    await command('file','start-game');await poll(()=>evaluate('!window.dkcDebug.status().running'),'DKM pauses after audio check');
    report.soundOutput={initialPeak,mutedPeak,unmutedPeak};
    await fileCommand('file','import-save','save-file');
    await resetAndVerify('file');
    report.checks.push('The 600-frame framebuffer matches native. Sound is on at first playback, the rendered signal is silent while muted, and Config → Sound restores it.');
  }

  await command('app','settings');await poll(()=>evaluate(`document.querySelector('#app-settings').open`),'Settings modal');
  await poll(()=>visible('[data-settings-pane="controllers"]'),'Controller settings');
  assert(await evaluate(`Boolean(document.querySelector('#app-settings').contains(document.activeElement))`),'Modal did not contain focus.');
  // Native dialogs may move Tab focus to browser chrome. Page controls must stay inert.
  await evaluate(`document.querySelector('#settings-done').focus();document.querySelector('#screen').focus()`);
  assert(await evaluate(`document.querySelector('#app-settings').contains(document.activeElement)`),'Background page accepted focus through Settings modal.');
  await key('Tab','Tab',null,8);
  assert(await evaluate(`document.activeElement===document.body||document.querySelector('#app-settings').contains(document.activeElement)`),'Reverse Tab reached a background page control.');
  await client.send('Page.bringToFront');
  await evaluate(`document.querySelector('#settings-done').focus()`);await key('Tab');
  assert(await evaluate(`document.querySelector('#app-settings').contains(document.activeElement)`),'Tab reached a background page control.');
  await click('#controller-new');await evaluate(`const input=document.querySelector('#controller-name');input.value='Unsaved UI regression';input.dispatchEvent(new Event('input',{bubbles:true}));`);
  assert.equal(await evaluate('window.dkcDebug.controllers().dirty'),true);
  await key('Escape');assert(await evaluate(`document.querySelector('#app-settings').open`),'Escape discarded dirty controller profile.');
  await click('#settings-done');assert(await evaluate(`document.querySelector('#app-settings').open`),'Done discarded dirty controller profile.');
  await click('[data-settings-tab="saves"]');assert(await visible('[data-settings-pane="controllers"]'),'Changing Settings section discarded dirty profile.');
  await click('#controller-discard');await settingsTab('saves');
  if(rom){assert.equal(await evaluate(`document.querySelector('#export-save').disabled`),false);await click('#export-save');await poll(()=>downloads.some(item=>item.suggestedFilename.endsWith('.srm')),'cartridge export through Settings');}
  await settingsTab('keyboard');await screenshot('desktop-settings-keyboard.png');
  await settingsTab('controllers');await screenshot('desktop-settings-controllers.png');
  await closeSettings();
  report.checks.push('Settings sections, contained focus, unsaved profile protection, discard, and Save export preserve existing behavior.');

  await client.send('Page.bringToFront');await poll(()=>evaluate('!document.hidden'),'foreground Devices inspection');
  await command('config','devices');await poll(()=>visible('[data-settings-pane="devices"]'),'Devices settings');
  await poll(async()=>{const device=await evaluate(`({text:document.querySelector('#device-list').textContent,hidden:document.hidden})`);report.devices=device;return device.text.includes('Representative raw controller')&&device.text.includes('12 buttons');},'Connected controller details in Devices');
  await screenshot('desktop-settings-devices.png');await closeSettings();
  await command('config','options');await poll(()=>visible('[data-settings-pane="options"]'),'Options settings');
  assert(await evaluate(`document.querySelector('[data-settings-pane="options"]').textContent.includes('Pause when inactive')&&document.querySelector('[data-settings-pane="options"]').textContent.includes('System')`));
  await click('[data-settings-pane="options"] [data-command="keyboard"]');await poll(()=>evaluate(`document.querySelector('#help-dialog').open`),'Options keyboard help');await closeSettings();
  report.checks.push('Static monochrome coin, requested DKM/Config/Misc ordering, disabled unavailable entries, Devices readout, and Options help are verified.');

  let lightBackground;
  for(const [width,height,dpr,theme] of [[1440,900,1,'light'],[1280,720,1,'dark'],[390,844,1,'light'],[844,390,1,'dark'],[320,568,1,'light'],[390,844,2,'dark']]){
    await viewport(width,height,dpr,theme);
    const g=await evaluate(geometry);report.layouts.push({width,height,dpr,theme,...g});
    assert(g.window.scrollWidth<=width+1,'App horizontally overflows viewport.');
    assert(g.window.scrollHeight<=height+1,'Main player requires page scrolling.');
    await assertMenuOnly();
    assert(g.navigationSeparate,'Navigation is inside player.');contain(g.screen,width,height,'Game screen');contain(g.navigation,width,height,'Navigation');
    if(g.gpuViewport){const[x,y,w,h]=g.gpuViewport;assert(Math.abs(w/h-4/3)<1e-5);assert(x>=-.01&&y>=-.01&&x+w<=g.buffer.width+.1&&y+h<=g.buffer.height+.1);}
    const compact=await visible('.compact-more > .menu-trigger');
    if(compact){
      assert(await visible('.compact-more > .menu-trigger'),'Compact More control is unavailable.');assert(await visible('#app-menubar'),'Singular navigation is unavailable on compact UI.');
      const targets=await evaluate(`['.compact-more > .menu-trigger'].map(selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {selector,width:r.width,height:r.height};})`);
      for(const target of targets)assert(target.width>=43&&target.height>=43,`Compact target is too small: ${JSON.stringify(target)}`);
      await openMenu('mobile');
      const menuRect=await evaluate(`(()=>{const r=document.querySelector('#menu-more').getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};})()`);
      contain(menuRect,width,height,'Compact menu');
      await evaluate(`document.querySelector('#menu-more [data-command="open-rom"]').focus()`);await key('End');
      const focusGeometry=await evaluate(`(()=>{const menu=document.querySelector('#menu-more'),r=document.activeElement.getBoundingClientRect();return {command:document.activeElement.dataset.command,scrollTop:menu.scrollTop,item:{x:r.x,y:r.y,right:r.right,bottom:r.bottom}};})()`);
      assert.equal(focusGeometry.command,'about');contain(focusGeometry.item,width,height,'Focused compact menu command');
      assert(focusGeometry.item.y>=menuRect.y-1&&focusGeometry.item.bottom<=menuRect.bottom+1,'Keyboard-focused item is clipped by its menu scroll area.');
      if(height<=520)assert(focusGeometry.scrollTop>0,'Long compact menu did not scroll to keyboard-focused final command.');
      await key('ArrowUp');
      const preceding=await evaluate(`(()=>{const r=document.activeElement.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};})()`);contain(preceding,width,height,'Previous compact menu command');
      await key('Escape');
    }else {assert(width>700,'Compact UI is unavailable on a narrow viewport.');assert(await visible('#app-menubar'));}
    if(width===1440)lightBackground=g.background;
    if(width===1280)assert.notEqual(g.background,lightBackground,'System light/dark appearances did not change.');
    await screenshot(`player-${width}x${height}-dpr${dpr}-${theme}.png`);
  }
  report.checks.push('Desktop, compact portrait/landscape, narrow320px, light/dark, and Retina layouts fit; removed regions are absent and main controls/text stay in singular navigation.');

  await viewport(390,844,1,'light');await command('mobile','settings');await poll(()=>evaluate(`document.querySelector('#app-settings').open`),'compact Settings sheet');
  await screenshot('compact-settings-controllers.png');
  const dialogGeometry=await evaluate(`(()=>{const r=document.querySelector('#app-settings').getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,scrollWidth:document.querySelector('#app-settings').scrollWidth,clientWidth:document.querySelector('#app-settings').clientWidth};})()`);
  contain(dialogGeometry,390,844,'Compact Settings sheet');assert(dialogGeometry.scrollWidth<=dialogGeometry.clientWidth+1,'Settings sheet horizontally overflows.');
  await settingsTab('saves');await settingsTab('keyboard');await closeSettings();
  await openMenu('mobile');
  const compactCommands=await evaluate(`Array.from(document.querySelectorAll('#menu-more [data-command]')).map(e=>e.dataset.command)`);
  for(const commandName of ['open-rom','start-game','reset-game','controllers','devices','options','video','sound','paths','saves','speed','keyboard','about','import-save','export-save'])assert(compactCommands.includes(commandName),`Compact menu omits ${commandName}.`);
  await screenshot('compact-menu.png');await key('Escape');
  if(rom){
    await fileCommand('mobile','import-save','save-file');
    await command('game','toggle');await poll(()=>evaluate('window.dkcDebug.status().running'),'compact Config Speed starts game');
    await command('game','toggle');await poll(()=>evaluate('!window.dkcDebug.status().running'),'compact Config Speed pauses game');
    await command('game','audio');await assertSound(false);
    await command('game','audio');await assertSound(true);
    await resetAndVerify('mobile');
  }
  const compactInvalidMessage=await evaluate(`window.dkcDebug.loadRom(new ArrayBuffer(1)).then(()=>null,error=>error.message)`);assert.match(compactInvalidMessage,/4,194,304/);
  await poll(()=>visible('#menu-more'),'ROM error is revealed in compact menu');
  assert(await evaluate(`document.querySelector('#menu-more [data-status-copy="status"]').classList.contains('error')`));
  await screenshot('compact-error-menu.png');await key('Escape');
  await client.send('Page.bringToFront');await command('mobile','video');await poll(()=>evaluate(`document.querySelector('#app-settings').open`),'compact Video settings');await pointerClick('[data-settings-pane="video"] [data-command="fullscreen"]');await poll(()=>evaluate(`document.fullscreenElement===document.querySelector('.screen-wrap')`),'screen-only fullscreen');
  assert.equal(await evaluate(`document.fullscreenElement.contains(document.querySelector('.app-menubar'))`),false);
  await screenshot('compact-fullscreen.png');await key('Escape');await poll(()=>evaluate('!document.fullscreenElement'),'fullscreen Escape exit');
  report.checks.push('Compact More menu, Settings sheet navigation, and screen-only fullscreen work.');
  }
  assert.equal(report.javascriptErrors.length,0,'Page raised JavaScript exceptions.');assert.equal(report.consoleErrors.length,0,'Page logged JavaScript errors.');
  report.sourcesAfter=Object.fromEntries(await Promise.all(Object.keys(report.sources).map(async file=>[file,createHash('sha256').update(await readFile(join(root,file))).digest('hex')])));
  assert.deepEqual(report.sourcesAfter,report.sources,'Application sources changed during browser verification.');report.sourceUnchanged=true;report.result='passed';
}catch(error){report.result='failed';report.error={message:error.message,stack:error.stack};process.exitCode=1;if(client&&session)try{report.failure=await evaluate(`({status:document.querySelector('#status')?.textContent,active:document.activeElement?.outerHTML,settingsOpen:document.querySelector('#app-settings')?.open,controller:window.dkcDebug?.controllers?.(),menus:Array.from(document.querySelectorAll('.app-menu')).map(e=>({name:e.id,hidden:e.hidden,rect:e.getBoundingClientRect().toJSON()}))})`);await screenshot('failure.png');}catch{}}
finally{
  if(client){try{await client.send('Browser.close',{},null,5000);}catch{}client.socket.close();}
  if(chrome?.exitCode===null){await Promise.race([new Promise(yes=>chrome.once('exit',yes)),delay(3000)]);if(chrome.exitCode===null)chrome.kill('SIGTERM');}
  if(server?.exitCode===null){server.kill('SIGINT');await Promise.race([new Promise(yes=>server.once('exit',yes)),delay(3000)]);if(server.exitCode===null)server.kill('SIGTERM');}
  await rm(profile,{recursive:true,force:true});for(const stream of streams)stream.end();report.finished=new Date().toISOString();await writeFile(join(output,'evidence.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({result:report.result,checks:report.checks,error:report.error?.message,evidence:join(output,'evidence.json')},null,2));
}
