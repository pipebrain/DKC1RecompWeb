import {PLAYER_KEY,PLAYER_DEFAULTS,CONFIG_LIMIT,readPlayer,validatePlayer,makeProfileConfig,parseConfig,storeConfig,recoverConfig} from './settings.js';
import {createPresenter} from './graphics.js';
import {loadSave,readRememberedRom,readRememberPreference,rememberPickedRom,setRememberRom,storeSave,loadStateSlot,loadStateSlots,appendStateSlot,loadLatestStateSlot,deleteStateSlot} from './storage.js';
import {ASSIST_ACTIONS} from './gamepad-profiles.js';
import {initAppShell,createSettingsNavigation} from './ui-shell.js';
import {createInputRouting,defaultInputProfiles,migrateInputProfiles,readInputProfiles} from './input-profiles.js';
import {initInputProfileUI} from './input-profile-ui.js';
import {loadContentPages} from './content-pages.js';
import {createStartShortcut} from './start-shortcut.js';

const $=selector=>document.querySelector(selector);
const canvas=$('#screen');
const worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
const ROM_SIZE=4194304,ROM_SHA='fa8cacf5bbfc39ee6bbaa557adf89133d60d42f6cf9e1db30d5a36a469f74d15';
let nextId=1,pending=new Map(),presenter=null,latestFrame=null,presentedFrame=0,loading=false,retainedRom=null,fpsTime=0, fpsFrames=0, lastStatus='',lastError=false,lastSaveMessage='';
let player, initialInput, preferenceReadError;
try{await recoverConfig();}catch(error){preferenceReadError=error.message;}
try { player=readPlayer(); }
catch (error) { player={...PLAYER_DEFAULTS}; preferenceReadError=error.message; }
try { initialInput=readInputProfiles(); }
catch (error) { initialInput=defaultInputProfiles(); preferenceReadError=error.message; }
const routing=createInputRouting(initialInput);
let importingConfig=false,unsavedPreferences={};
let audioContext=null,audioNode=null,audioSetup=null,sound=player.sound;
let keyBits=0,mouseBits=0,gamepadBits=0,debugBits=0,lastInput=-1;
let state={loaded:false,running:false,hasStarted:false,playbackError:false,paused:true,frameCount:0},logs=[],audioStats={},saveChain=Promise.resolve();
let committedSave=null,pendingSave=null;
const pressedCodes=new Set(), pressedMouse=new Set();
const physicalCodes=new Set(),freshKeyEvents=new WeakSet();
const ports=[0,1];
const startShortcuts=ports.map(()=>({keyboard:createStartShortcut(),gamepad:createStartShortcut()}));
const startBit=8,portStartMask=port=>startBit<<(12*port);
let resumeGeneration=0,resumeAttempt=null,pendingPauses=0;
let appShell;
const navigateSettings=createSettingsNavigation();
const profileUI=initInputProfileUI({
  initial:initialInput,routing,
  openProfile:(name,opener)=>appShell.openSettings('profile',opener,name),
  goBack:()=>appShell.goBack(),renameTitle:name=>appShell.renameProfile(name),
  notify:(message,detail)=>appShell.notify(message,detail),
  onChange:()=>{releaseInput();updateShell();},
});
function keyboardBitsFor(code){
  return routing.key(code,0)|(routing.key(code,1)<<12);
}
function mouseBitsFor(button){
  return routing.mouse(button,0)|(routing.mouse(button,1)<<12);
}
function fullscreenAvailable(){return Boolean(document.fullscreenElement||(document.fullscreenEnabled&&typeof $('.screen-wrap').requestFullscreen==='function'));}
function hostState(){
  const space=keyboardBitsFor('Space');
  return {...state,sound,loading:loading||importingConfig,fullscreenAvailable:fullscreenAvailable(),
    resuming:Boolean(resumeAttempt),playbackBusy:Boolean(resumeAttempt)||pendingPauses>0,inputMode:routing.mode(0),
    spaceBound:Boolean(space),spaceIsStart:ports.some(port=>Boolean(space&portStartMask(port)))};
}
appShell=initAppShell({
  getState:hostState,
  getPreferences:()=>player,
  onLeavePage:page=>{if(page==='saves')clearStateCards();},
  onMenuOpen:cancelResume,
  onBeforeOpenSettings:async()=>{
    profileUI.stopCapture();
    if(!appShell.isSettingsOpen())await pause('settings');
  },
  onBeforeCloseSettings:profileUI.stopCapture,
  onCommand:runCommand,
});
const contentPages=loadContentPages({aboutElement:$('#about-content')});
contentPages.ready.catch(error=>status(error.message,true));
function runCommand(command){
  if(importingConfig)throw new Error('Settings are being loaded.');
  switch(command){
    case 'open-rom':return $('#rom-file').click();
    case 'start-game':
      if(!state.running)return resume();
      return pause().then(()=>{
        if(!modalOpen())canvas.focus({preventScroll:true});
        appShell.notify('Game paused.');
      });
    case 'reset-game':return resetGame();
    case 'fullscreen':return toggleFullscreen();
    case 'settings':return appShell.openSettings();
    case 'controllers':return appShell.openSettings('controllers');
    case 'cheats':return openPage('cheats');
    case 'save-states':return openPage('saves');
    case 'about':return openPage('about');
    case 'load-config':checkConfigReady();return $('#config-file').click();
    case 'save-config':return exportConfig();
    case 'restore-settings':{
      const dialog=$('#restore-settings-dialog');dialog.returnValue='';return dialog.showModal();
    }
    case 'quick-save':
    case 'quick-load':return runStateCommand(command);
    case 'import-save':return $('#save-file').click();
    case 'export-save':return exportSave();
  }
}
async function openPage(page){
  await pause(page);
  appShell.openPage(page);
  if(page==='saves')await refreshStateCards();
  if(page==='about'){
    const result=await contentPages.ready;
    if(result.errors.about)$('#about-content').textContent=result.errors.about;
  }
}
function modalOpen(){return Boolean(appShell?.isPageOpen()||document.querySelector('dialog[open]'));}
function resetStartShortcuts(){for(const port of startShortcuts)for(const shortcut of Object.values(port))shortcut.reset();}
function cancelResume({pausePosted=true}={}){
  const attempt=resumeAttempt;resumeGeneration++;resumeAttempt=null;attempt?.cancel();resetStartShortcuts();
  // A posted resume already belongs to the worker. Follow it with an ordered
  // pause even if its acknowledgement has not yet updated state.running.
  if(pausePosted&&attempt?.posted)pause('resume-canceled').catch(error=>status(error.message,true));
}
function canUseGameInput(){
  return state.loaded&&!loading&&!pendingPauses&&!state.playbackError&&!['error','gpu-error'].includes(state.pausedReason)&&
    !document.hidden&&document.hasFocus()&&document.activeElement===canvas&&!modalOpen()&&
    !appShell.isMenuOpen()&&!appShell.isSettingsBusy();
}
function canUseStart(port,mode){
  const inputMode=routing.mode(port);
  return (mode==='mouse'||inputMode===mode||inputMode==='both')&&canUseGameInput();
}
function keyboardStartDown(port){for(const code of physicalCodes)if(routing.key(code,port)&startBit)return true;return false;}
function sampleStart(port,mode,pressed,source,freshPress=false){
  const result=startShortcuts[port][mode].sample(pressed,{allowed:canUseStart(port,mode),paused:!state.running,source,freshPress});
  if(result.resume&&(mode==='gamepad'||freshPress))resume({shortcut:{port,mode}}).catch(error=>status(error.message,true));
  return result;
}
function updateShell(){appShell?.update();}
function status(message,error=false){
  if(error&&lastStatus!==message)appShell?.notify(message);
  lastStatus=message;lastError=error;
}
function saveMessage(message){
  lastSaveMessage=message;
  if(message&&message!=='Saving cartridge progress…')appShell?.notify(message);
}
function recycle(type,buffer){worker.postMessage({type,buffer},[buffer]);}
function request(type,fields={},transfer=[]){
  const id=nextId++;
  return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject,type,generation:resumeGeneration});worker.postMessage({type,id,...fields},transfer);});
}
function updateState(value){
  if(!value)return;state={...state,...value};
  $('#save-file').disabled=!state.loaded||loading;
  updateShell();
}
function persist(buffer,imported=false){
  const snapshot={buffer,imported};
  pendingSave=snapshot;
  saveMessage('Saving cartridge progress…');
  // A failed transaction leaves the live SRAM available for export. A later
  // write can retry from the last bytes that actually committed.
  saveChain=saveChain.catch(()=>{}).then(async()=>{
    await storeSave(buffer,imported?undefined:committedSave);
    committedSave=buffer;
    if(pendingSave===snapshot){pendingSave=null;saveMessage('Saved in this browser');}
  });
  saveChain.catch(error=>saveMessage(`Could not save in this browser. ${error.message} Use Save Game in the navigation rail before closing.`,true));
}
worker.onmessage=({data})=>{
  if(data.type==='response'){
    const entry=pending.get(data.id);if(!entry)return;pending.delete(data.id);
    if(data.error)entry.reject(new Error(data.error));else {if(data.value?.loaded!==undefined&&(entry.type!=='resume'||entry.generation===resumeGeneration))updateState(data.value);entry.resolve(data.value);}return;
  }
  if(data.type==='frame'){
    if(latestFrame)recycle('recycle-frame',latestFrame.buffer);
    latestFrame=data;return;
  }
  if(data.type==='audio'){
    if(sound&&audioNode&&state.running)audioNode.port.postMessage({type:'samples',buffer:data.buffer,rate:data.rate},[data.buffer]);
    else recycle('recycle-audio',data.buffer);return;
  }
  if(data.type==='sram-changed'){persist(data.buffer,data.imported);return;}
  if(data.type==='stomp'){if(state.running)profileUI.pulseStomp();return;}
  if(data.type==='stats'){updateState(data);return;}
  if(data.type==='imports'){state.imports=data.imports;return;}
  if(data.type==='loading'){status(data.message);return;}
  if(data.type==='log'){logs.push({level:data.level,text:data.text});if(logs.length>200)logs.shift();(data.level==='stderr'?console.warn:console.log)(data.text);return;}
  if(data.type==='error'){cancelResume({pausePosted:false});releaseInput();updateState({running:false,paused:true,playbackError:true,pausedReason:'error'});resetAudio();status(data.error,true);console.error(data.error,data.stack||'');}
};
worker.onerror=event=>{cancelResume({pausePosted:false});releaseInput();const error=new Error(event.message||'Game worker failed.');status(error.message,true);for(const value of pending.values())value.reject(error);pending.clear();updateState({running:false,paused:true,playbackError:true,pausedReason:'error'});};

function resetAudio(){audioNode?.port.postMessage({type:'reset'});}
async function connectAudio(context){
  try{
    await context.audioWorklet.addModule(new URL('./audio-worklet.js',import.meta.url));
    const node=new AudioWorkletNode(context,'dkc-audio',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2]});
    node.port.onmessage=({data})=>{if(data.type==='recycle-audio')recycle('recycle-audio',data.buffer);else if(data.type==='audio-stats')audioStats=data;};
    node.connect(context.destination);audioNode=node;configureAudio();
  }catch(error){
    await context.close().catch(()=>{});
    audioContext=null;audioSetup=null;
    throw error;
  }
}
async function unlockAudio(context){
  const hint=`Click or tap DKM → ${state.hasStarted?'Resume Game':'Start Game'} to start audio.`;
  let timer;
  try{
    await Promise.race([context.resume(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(hint)),1500);})]);
    if(context.state!=='running')throw new Error(hint);
  }catch(error){
    if(error.name==='NotAllowedError')throw new Error(hint);
    throw error;
  }finally{
    clearTimeout(timer);
  }
}
async function startAudio(){
  const context=audioContext??=new AudioContext({latencyHint:'interactive'});
  // Request playback during the Start gesture, before waiting for the worklet download.
  const unlocked=unlockAudio(context);
  audioSetup??=connectAudio(context);
  await Promise.all([unlocked,audioSetup]);
}
async function enableSound(enabled){
  changePreference('sound',enabled);
  if(enabled&&state.running)await startAudio();
  return sound;
}
async function pause(reason='paused'){
  cancelResume({pausePosted:false});releaseInput();pendingPauses++;updateShell();
  try{
    const value=await request('pause',{reason});resetAudio();updateState(value);
    if(state.loaded)status(reason==='hidden'?'Paused while this tab is hidden.':'Paused.');return value;
  }finally{pendingPauses--;updateShell();}
}
async function resume({shortcut=null}={}){
  if(resumeAttempt)return resumeAttempt.promise;
  if(modalOpen())throw new Error('Close the dialog before starting the game.');
  if(document.hidden)throw new Error('Bring this tab to the foreground before resuming.');
  if(state.playbackError)throw new Error('Reload the game before resuming.');
  if(loading||pendingPauses)return state;
  if(!state.hasStarted&&player.fullscreenOnStart&&!document.fullscreenElement&&fullscreenAvailable()&&navigator.userActivation?.isActive)
    $('.screen-wrap').requestFullscreen().catch(error=>status(error.message,true));
  const wasStarted=state.hasStarted;
  const generation=resumeGeneration,attempt={cancel:null,promise:null,posted:false};
  const canceled=new Promise(resolve=>{attempt.cancel=()=>resolve(false);});
  const valid=()=>generation===resumeGeneration&&!loading&&!pendingPauses&&!modalOpen()&&!document.hidden&&(!shortcut||canUseStart(shortcut.port,shortcut.mode));
  attempt.promise=(async()=>{
    if(sound){
      const ready=await Promise.race([startAudio().then(()=>true),canceled]);
      if(!ready||!valid())return state;
    }
    if(!valid())return state;
    resetAudio();attempt.posted=true;const value=await request('resume');
    if(!valid())return state;
    updateState(value);canvas.focus({preventScroll:true});appShell.notify(wasStarted?'Game resumed.':'Game started.');
    return value;
  })();
  resumeAttempt=attempt;updateShell();
  try{return await attempt.promise;}finally{if(resumeAttempt===attempt)resumeAttempt=null;updateShell();}
}
async function loadRom(buffer,{preserveSave=false,rememberSelection=false}={}){
  if(loading)throw new Error('A ROM is already loading.');
  if(!presenter)throw new Error('WebGPU is not ready.');
  loading=true;updateState(state);
  try{
    status('Verifying ROM…');
    if(!(buffer instanceof ArrayBuffer)||buffer.byteLength!==ROM_SIZE)throw new Error('Expected a headerless 4,194,304-byte DKC USA v1.0 ROM.');
    const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(n=>n.toString(16).padStart(2,'0')).join('');
    if(digest!==ROM_SHA)throw new Error('ROM SHA-256 does not match unmodified DKC USA v1.0.');
    const nextRom=buffer.slice(0);
    await pause('loading');
    if(pendingSave){
      // The pause acknowledgement follows all preceding SRAM messages. Finish
      // that write before rereading the cartridge slot or replacing the core.
      try{await saveChain;}
      catch{
        const failed=pendingSave;
        persist(failed.buffer,failed.imported);
        try{await saveChain;}catch{/* The live snapshot and its export warning stay available. */}
      }
    }
    let save=null,readError=null;
    const useLiveSave=state.loaded&&(preserveSave||Boolean(pendingSave));
    if(useLiveSave)save=(await request('get-sram')).buffer;
    else{
      try{save=await loadSave();}
      catch(error){readError=error;if(state.loaded)save=(await request('get-sram')).buffer;}
    }
    const value=await request('load',{buffer,save},[buffer]);
    updateState({...value,playbackError:false});
    if(!useLiveSave&&!readError)committedSave=save;
    retainedRom=nextRom;
    if(latestFrame){recycle('recycle-frame',latestFrame.buffer);latestFrame=null;}
    presentedFrame=0;appShell.setFps(0);presenter.clear();
    if(readError)saveMessage(`Could not read saved progress. ${readError.message} Use Save Game in the navigation rail to keep a local copy.`,true);
    else if(!pendingSave)saveMessage(committedSave?'Loaded cartridge save':'');
    lastInput=-1;sendInput();
    if(rememberSelection)await rememberSelectionLocally(retainedRom);
    status('ROM verified. Choose Start Game to play.');return state;
  }catch(error){try{updateState(await request('get-state'));}catch{}status(error.message,true);throw error;}
  finally{loading=false;updateState(state);}
}
async function resetGame(){
  if(!state.loaded||!retainedRom)throw new Error('Load a ROM before reloading the game.');
  const value=await loadRom(retainedRom.slice(0),{preserveSave:true});
  status('Game reloaded.');appShell.notify('Game reloaded.','Choose Start Game to play.');
  return value;
}
function sendInput(){const buttons=(keyBits|mouseBits|gamepadBits|debugBits)&0xffffff;if(buttons!==lastInput){lastInput=buttons;worker.postMessage({type:'input',buttons});}}
function releaseInput(){pressedCodes.clear();pressedMouse.clear();keyBits=0;mouseBits=0;gamepadBits=0;debugBits=0;resetStartShortcuts();sendInput();}
function refreshKeyboardInput(){keyBits=0;for(const code of pressedCodes)keyBits|=keyboardBitsFor(code);}
const keyboardAssist=new Set();
let priorAssist=new Set();
function updateAssist(){
  const active=new Set([...keyboardAssist,...routing.heldAssist()]);
  if(canUseGameInput()){
    for(const action of active){
      if(!priorAssist.has(action))runStateCommand(action).catch(error=>status(error.message,true));
    }
  }
  priorAssist=active;
}
window.addEventListener('keydown',event=>{
  if(event.isComposing||event.metaKey||event.ctrlKey||event.altKey||event.shiftKey&&event.code==='Tab'||!canUseGameInput())return;
  if(!ports.some(port=>['keyboard','both'].includes(routing.mode(port))))return;
  const id=Object.keys(ASSIST_ACTIONS).find(action=>profileUI.assistKey(action)===event.code);
  if(id){event.preventDefault();event.stopImmediatePropagation();if(!event.repeat){keyboardAssist.add(id);updateAssist();}}
},true);
window.addEventListener('keyup',event=>{
  const id=Object.keys(ASSIST_ACTIONS).find(action=>profileUI.assistKey(action)===event.code);
  if(id&&keyboardAssist.delete(id)){event.preventDefault();updateAssist();}
},true);
canvas.addEventListener('blur',()=>{keyboardAssist.clear();updateAssist();});
function gamepad(){
  let pads=[];
  try{pads=navigator.getGamepads?.()||[];}catch{}
  routing.poll(pads);
  profileUI.pollCapture();
  const portInput=ports.map(routing.gamepadInput);
  navigateSettings(pads,Boolean(document.querySelector('dialog[open]')),
    appShell.isSettingsOpen()?portInput.reduce((bits,input)=>bits|input.buttons,0):0,
    ()=>{if(canUseGameInput())runCommand('controllers');},
    ()=>requestAnimationFrame(()=>{if(!modalOpen())canvas.focus({preventScroll:true});}));
  updateAssist();
  gamepadBits=0;
  const playingInput=canUseGameInput();
  for(const port of ports){
    const input=portInput[port];
    const start=sampleStart(port,'gamepad',Boolean(input.buttons&startBit),input.source);
    const keyboardStart=sampleStart(port,'keyboard',keyboardStartDown(port),'keyboard');
    if(keyboardStart.suppress)keyBits&=~portStartMask(port);
    if(playingInput)gamepadBits|=(input.buttons&~(start.suppress?startBit:0))<<(port*12);
  }
  sendInput();
}
function animate(now){
  gamepad();
  if(latestFrame&&presenter){const frame=latestFrame;latestFrame=null;try{presenter.draw(frame.buffer);presentedFrame=frame.frameCount;fpsFrames++;}catch(error){updateState({playbackError:true});status(error.message,true);pause('gpu-error').catch(console.error);}finally{recycle('recycle-frame',frame.buffer);}}
  if(!state.running){fpsTime=now;fpsFrames=0;}
  else if(now-fpsTime>=1000){
    if(player.showFps)appShell.setFps(Math.round(fpsFrames*1000/(now-fpsTime)));
    fpsTime=now;fpsFrames=0;
  }
  requestAnimationFrame(animate);
}
window.addEventListener('keydown',event=>{
  if(!physicalCodes.has(event.code)&&!event.repeat)freshKeyEvents.add(event);
  physicalCodes.add(event.code);
  for(const port of ports)if(!canUseStart(port,'keyboard'))startShortcuts[port].keyboard.sample(keyboardStartDown(port),{source:'keyboard'});
},true);
window.addEventListener('keyup',event=>{
  physicalCodes.delete(event.code);
  for(const port of ports)sampleStart(port,'keyboard',keyboardStartDown(port),'keyboard');
},true);
window.addEventListener('keydown',event=>{
  if(event.defaultPrevented||event.isComposing||event.metaKey||event.ctrlKey||event.altKey||!state.loaded||document.activeElement!==canvas)return;
  const bit=keyboardBitsFor(event.code);if(!bit)return;
  let consumed=false;
  for(const port of ports)if(bit&portStartMask(port)){
    const start=sampleStart(port,'keyboard',keyboardStartDown(port),'keyboard',freshKeyEvents.has(event));
    if(start.suppress)consumed=true;
  }
  if(consumed){event.preventDefault();return;}
  if(!state.running||!canUseGameInput())return;
  event.preventDefault();pressedCodes.add(event.code);refreshKeyboardInput();sendInput();
});
window.addEventListener('keyup',event=>{if(pressedCodes.delete(event.code)){if(document.activeElement===canvas)event.preventDefault();refreshKeyboardInput();sendInput();}});
canvas.addEventListener('blur',()=>{cancelResume();pressedCodes.clear();pressedMouse.clear();keyBits=0;mouseBits=0;sendInput();});
canvas.addEventListener('pointerdown',()=>{
  if(!modalOpen()&&!appShell.isMenuOpen())canvas.focus({preventScroll:true});
});
function refreshMouseInput(){
  mouseBits=0;
  for(const button of pressedMouse)mouseBits|=mouseBitsFor(button);
  sendInput();
}
$('.screen-wrap').addEventListener('pointerdown',event=>{
  if(event.pointerType!=='mouse'||!state.loaded||modalOpen())return;
  const bits=mouseBitsFor(event.button);
  if(!bits)return;
  // The primary click on the paused overlay activates its existing button.
  if(!state.running&&event.button===0&&event.target.closest('#game-overlay'))return;
  canvas.focus({preventScroll:true});
  if(!canUseGameInput())return;
  event.preventDefault();
  if(!state.running){
    const port=ports.find(port=>bits&portStartMask(port));
    if(port!==undefined)resume({shortcut:{port,mode:'mouse'}}).catch(error=>status(error.message,true));
    return;
  }
  pressedMouse.add(event.button);refreshMouseInput();
});
window.addEventListener('pointerup',event=>{if(pressedMouse.delete(event.button))refreshMouseInput();});
window.addEventListener('pointercancel',()=>{if(pressedMouse.size){pressedMouse.clear();refreshMouseInput();}});
$('.screen-wrap').addEventListener('contextmenu',event=>{if(state.loaded&&!modalOpen()&&mouseBitsFor(2))event.preventDefault();});
window.addEventListener('blur',()=>{cancelResume();physicalCodes.clear();releaseInput();if(state.running&&player.pauseWhenInactive)pause('blur').catch(console.error);});
window.addEventListener('gamepadconnected',resetStartShortcuts);
window.addEventListener('gamepaddisconnected',()=>{cancelResume();gamepadBits=0;sendInput();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelResume();releaseInput();if(state.loaded&&player.pauseWhenInactive)pause('hidden').catch(console.error);}});
const rememberBox = $('#remember-rom');
const romNotice = $('#rom-storage-status');
let rememberEnabled = true;
let rememberFailure = '';

function showRomPreference(enabled, message) {
  rememberEnabled = enabled;
  rememberBox.checked = enabled;
  romNotice.textContent = message;
}

async function rememberSelectionLocally(image) {
  rememberFailure = '';
  rememberBox.disabled = true;
  try {
    const enabled = await rememberPickedRom(image);
    showRomPreference(enabled, enabled ? 'Your ROM is saved in this browser.' : 'Choose a ROM each time you open the player.');
  } catch (error) {
    rememberFailure = `The ROM is playable for this session. Local storage failed: ${error.message}`;
    showRomPreference(rememberEnabled, rememberFailure);
  } finally {
    rememberBox.disabled = false;
  }
}

rememberBox.addEventListener('change', async () => {
  const enabled = rememberBox.checked;
  rememberBox.disabled = true;
  try {
    await setRememberRom(enabled, retainedRom);
    appShell.notify('Setting saved.',enabled?'Remember ROM on':'Remember ROM off');
    const message = retainedRom ? 'Your ROM is saved in this browser.' : 'The next verified ROM you choose will be saved here.';
    showRomPreference(enabled, enabled ? message : 'Local ROM removed. Choose a ROM on your next visit.');
  } catch (error) {
    showRomPreference(rememberEnabled, `Could not change ROM storage: ${error.message}`);
    status(error.message,true);
  } finally {
    rememberBox.disabled = false;
  }
});

$('#rom-file').addEventListener('change', async event => {
  const input = event.target;
  const file = input.files[0];
  if (!file) return;
  try {
    await playerReady;
    if (file.size !== ROM_SIZE) throw new Error('Expected a headerless 4,194,304-byte DKC USA v1.0 ROM.');
    await loadRom(await file.arrayBuffer(), {rememberSelection: true});
    if(!modalOpen())canvas.focus({preventScroll:true});
    appShell.notify('ROM loaded.',file.name);
    if (rememberFailure) status(rememberFailure, true);
  } catch (error) {
    status(error.message, true);
  } finally {
    input.value = '';
  }
});
async function toggleFullscreen(){
  if(document.fullscreenElement)await document.exitFullscreen();
  else{
    if(!fullscreenAvailable())throw new Error('Full screen is not available in this browser.');
    await $('.screen-wrap').requestFullscreen();
  }
  canvas.focus({preventScroll:true});
}
document.addEventListener('fullscreenchange',()=>{
  if(state.loaded)canvas.focus({preventScroll:true});
});
const appearanceQuery=matchMedia('(prefers-color-scheme: dark)');
function applyAppearance(){
  const scheme=player.appearance==='system'?(appearanceQuery.matches?'dark':'light'):player.appearance;
  document.documentElement.dataset.appearance=scheme;
  document.querySelector('[name="theme-color"]').content=scheme==='light'?'#f2f3f5':scheme==='black'?'#000000':'#151923';
}
appearanceQuery.addEventListener('change',applyAppearance);
function configureAudio(volume=player.volume){
  audioNode?.port.postMessage({type:'settings',volume:volume/100,driftCorrection:player.audioDriftCorrection,preroll:player.audioPreroll});
}
const main=$('main'), settings=$('#app-settings');
const settingControls=[...settings.querySelectorAll('[data-pref]')];
function paintDisplayPreferences(){
  const scale=player.displayScale==='custom'?player.customScale:Number(player.displayScale);
  if(scale)main.style.setProperty('--frame-width',`${256*scale}px`);
  else main.style.removeProperty('--frame-width');
  main.style.setProperty('--frame-aspect',scale?'256 / 224':'4 / 3');
  if(presenter)presenter.setScale(scale||null);
  $('#scale-resolution').textContent=`${256*(scale||1)} × ${224*(scale||1)}`;
  $('#custom-scale-row').hidden=player.displayScale!=='custom';
}
function previewPreference(key,value){
  if(key==='volume')configureAudio(value);
  if(key==='fpsOpacity')main.style.setProperty('--fps-opacity',value/100);
  if(key==='uiBackgroundOpacity')main.style.setProperty('--ui-background-opacity',`${value}%`);
}
function paintPreferences(){
  for(const control of settingControls){
    const value=player[control.dataset.pref];
    if(control.hasAttribute('data-notification-option'))control.disabled=!player.notificationsEnabled;
    if(control.type==='checkbox')control.checked=value;
    else control.value=String(value);
  }
  for(const key of ['volume','fpsOpacity','uiBackgroundOpacity'])previewPreference(key,player[key]);
  paintDisplayPreferences();
}
function applyPreferences(){
  if(sound!==player.sound){sound=player.sound;resetAudio();}
  paintPreferences();applyAppearance();appShell.trimNotices();
  updateShell();
}
function changePreference(key,value){
  if(importingConfig)throw new Error('Wait for Settings to finish loading.');
  let base=player;
  try{base={...readPlayer(),...unsavedPreferences};}catch{/* Private-session edits can still apply. */}
  const change={[key]:value};
  const next=validatePlayer({...base,...change});
  let saved=false;
  try{localStorage.setItem(PLAYER_KEY,JSON.stringify(next));unsavedPreferences={};saved=true;}
  catch(error){Object.assign(unsavedPreferences,change);status('This setting applies for this session. Could not save preferences: '+error.message,true);}
  player=next;applyPreferences();
  return saved;
}
settings.addEventListener('input',event=>{
  const control=event.target,key=control.dataset.pref;
  if(!key||!control.closest('.range-setting')||!control.value||!control.validity.valid)return;
  for(const peer of settingControls.filter(peer=>peer!==control&&peer.dataset.pref===key))peer.value=control.value;
  previewPreference(key,Number(control.value));
});
settings.addEventListener('change',event=>{
  const control=event.target,key=control.dataset.pref;
  if(!key||control.disabled)return;
  const label=control.closest('label')?.firstChild?.textContent?.trim()||control.closest('.settings-row')?.querySelector('label')?.textContent;
  const value=control.type==='checkbox'?control.checked:typeof PLAYER_DEFAULTS[key]==='number'?Number(control.value):control.value;
  try{
    if(!control.validity.valid||control.type==='number'&&!control.value)throw new Error('Enter a value in the displayed range.');
    const changed=player[key]!==value;
    if(changePreference(key,value)&&changed){
      const description=control.type==='checkbox'?(value?'On':'Off'):control.selectedOptions?.[0]?.textContent||control.value;
      appShell.notify('Setting saved.',label?`${label} · ${description}`:description);
    }
  }catch(error){paintPreferences();status(error.message,true);}
});
function checkConfigReady(){
  if(loading||importingConfig||rememberBox.disabled)throw new Error('Wait for the current operation to finish.');
}
function download(blob,name){
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');link.href=url;link.download=name;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function exportConfig(){
  await playerReady;checkConfigReady();
  const rememberRom=await readRememberPreference();
  const config=makeProfileConfig(player,profileUI.exportSettings(),rememberRom);
  download(new Blob([JSON.stringify(config,null,2)+'\n'],{type:'application/json'}),'DKC1R-Web.settings.json');
  appShell.notify('Settings exported.');
}
$('#config-file').addEventListener('change',async event=>{
  const input=event.target,file=input.files[0];
  input.value='';
  if(!file)return;
  try{
    await playerReady;checkConfigReady();
    if(file.size>CONFIG_LIMIT)throw new Error('Configuration file is too large.');
    const config=parseConfig(await file.text());checkConfigReady();
    await applyConfig(config);
    appShell.notify('Settings loaded.');
  }catch(error){status(error.message,true);}
});
async function applyConfig(config){
  importingConfig=true;settings.inert=true;$('#settings-done').disabled=true;updateShell();
  try{
    const input=config.inputProfiles??migrateInputProfiles(config.keyboard,config.controllers);
    const current=makeProfileConfig(config.player,input,config.rememberRom);
    await storeConfig(current,config.rememberRom?retainedRom:null);
    player=config.player;unsavedPreferences={};
    profileUI.applySettings(current.inputProfiles);
    showRomPreference(config.rememberRom,config.rememberRom?'Remember ROM is enabled.':'Choose a ROM on your next visit.');
    releaseInput();applyPreferences();
  }finally{importingConfig=false;settings.inert=false;$('#settings-done').disabled=false;updateShell();}
}
$('#restore-settings-dialog').addEventListener('close',async event=>{
  if(event.target.returnValue!=='restore')return;
  try{
    await playerReady;checkConfigReady();
    await applyConfig(makeProfileConfig(PLAYER_DEFAULTS,defaultInputProfiles(),true));
    appShell.notify('Default settings restored.');
  }catch(error){status(error.message,true);}
});
const cardGrid=$('#save-cards'),addCard=$('#add-save'),deleteDialog=$('#delete-state-dialog');
let stateCommandBusy=false, cardGeneration=0, deleteSlot=null;
const thumbnailUrls=new Set();
function showStateError(error){appShell.notify(error.message||String(error));}
function clearStateCards(){
  cardGeneration++;
  for(const url of thumbnailUrls)URL.revokeObjectURL(url);
  thumbnailUrls.clear();
  for(const card of cardGrid.querySelectorAll('.save-card'))card.remove();
}
async function refreshStateCards(){
  clearStateCards();
  addCard.disabled=true;
  if(!state.loaded){addCard.textContent='Load a ROM to save a state';return;}
  const generation=cardGeneration;
  const slots=await loadStateSlots();
  if(generation!==cardGeneration||$('#saves').hidden)return;
  for(const [index,saved] of slots.entries()){
    if(!saved)continue;
    const slot=index+1,card=$('#save-card-template').content.cloneNode(true);
    const load=card.querySelector('.load-card'),remove=card.querySelector('.delete-card');
    card.querySelector('strong').textContent=`Slot ${slot}`;
    const date=card.querySelector('time');
    if(saved.savedAt){
      const savedAt=new Date(saved.savedAt);
      date.dateTime=savedAt.toISOString();
      date.textContent=savedAt.toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
    }else date.textContent=`Frame ${saved.frameCount}`;
    if(saved.thumbnail instanceof Blob){
      const image=card.querySelector('img');
      image.src=URL.createObjectURL(saved.thumbnail);
      thumbnailUrls.add(image.src);
      image.hidden=false;
    }
    load.setAttribute('aria-label',`Load slot ${slot}`);
    load.addEventListener('click',()=>runStateCommand('quick-load',slot).catch(showStateError));
    remove.setAttribute('aria-label',`Delete slot ${slot}`);
    remove.addEventListener('click',()=>{
      if(stateCommandBusy)return;
      deleteSlot=slot;deleteDialog.returnValue='';deleteDialog.showModal();
    });
    cardGrid.insertBefore(card,addCard);
  }
  const empty=slots.indexOf(undefined);
  addCard.disabled=empty===-1;
  addCard.replaceChildren();
  if(empty===-1){addCard.textContent='All slots are in use';return;}
  addCard.append($('#add-save-icon').content.cloneNode(true),'Add save state');
}
async function createThumbnail(preview){
  if(!preview)return null;
  const image=document.createElement('canvas');
  image.width=preview.width;image.height=preview.height;
  const context=image.getContext('2d');
  if(!context)return null;
  context.putImageData(new ImageData(preview.rgba,preview.width,preview.height),0,0);
  return new Promise(resolve=>image.toBlob(resolve,'image/png'));
}
async function runStateCommand(command,slot=null){
  if(!state.loaded||loading)throw new Error('Load a game first.');
  if(stateCommandBusy)return;
  stateCommandBusy=true;
  const rom=retainedRom;
  try{
    if(command==='quick-save'){
      const {preview,...snapshot}=await request('snapshot');
      const thumbnail=await createThumbnail(preview).catch(()=>null);
      if(loading||retainedRom!==rom)throw new Error('The loaded game changed.');
      const savedSlot=await appendStateSlot({...snapshot,thumbnail});
      if(savedSlot===null)throw new Error('All save-state slots are in use. Delete a save state to make room.');
      saveMessage('Saved state to slot '+savedSlot+'.');
      if(!$('#saves').hidden){
        await refreshStateCards();
        cardGrid.querySelector(`[aria-label="Load slot ${savedSlot}"]`)?.focus();
      }
    }else if(command==='quick-load'){
      const saved=slot===null?await loadLatestStateSlot():{slot,snapshot:await loadStateSlot(slot)};
      if(!saved?.snapshot)throw new Error(slot===null?'No save states yet.':'State slot '+slot+' is empty.');
      await pause('state');
      if(loading||retainedRom!==rom)throw new Error('The loaded game changed.');
      const {variant,frameCount,buffer,sha256}=saved.snapshot;
      await request('restore-state',{variant,frameCount,buffer,sha256},[buffer]);
      if(!$('#saves').hidden)appShell.openPage(null);
      saveMessage('Loaded state from slot '+saved.slot+'.');
    }
    updateShell();
  }finally{stateCommandBusy=false;}
}
addCard.addEventListener('click',()=>runStateCommand('quick-save').catch(showStateError));
deleteDialog.addEventListener('close',async()=>{
  const slot=deleteSlot;
  deleteSlot=null;
  if(deleteDialog.returnValue!=='delete'||slot===null||stateCommandBusy)return;
  stateCommandBusy=true;
  try{
    await deleteStateSlot(slot);
    await refreshStateCards();
    addCard.focus();
    appShell.notify('Save state deleted.',`Slot ${slot}`);
  }catch(error){showStateError(error);}
  finally{stateCommandBusy=false;}
});
async function exportSave(){
  if(!state.loaded||loading)throw new Error('Load a game first.');
  const {buffer}=await request('get-sram');
  download(new Blob([buffer],{type:'application/octet-stream'}),'Donkey Kong Country.srm');
  appShell.notify('Game save exported.');
}
$('#save-file').addEventListener('change',async event=>{
  const file=event.target.files[0];if(!file)return;
  try{
    const buffer=await file.arrayBuffer();if(buffer.byteLength!==2048)throw new Error('Save must be exactly 2,048 bytes.');
    await pause('import');await request('set-sram',{buffer},[buffer]);
    appShell.notify('Game save loaded.','Choose Reload Game to load its game files.');
    // persist() reports transaction failures with the export recovery command.
    await saveChain.then(()=>saveMessage('Imported cartridge save'),()=>{});
  }catch(error){saveMessage(error.message,true);}finally{event.target.value='';}
});

window.dkcDebug={
  status:()=>({...hostState(),message:lastStatus,error:lastError,saveMessage:lastSaveMessage,inputBits:lastInput,presentedFrame,sound,audioContextState:audioContext?.state||'not-created',audioStats:{...audioStats},logs:[...logs],loading}),
  pause,resume,loadRom,
  controllers:(n=0)=>routing.controllerStatus(n),
  keyboard:(n=0)=>routing.keyboardStatus(n),
  content:()=>contentPages.state(),
  async step(buttons=0){await pause('debug-step');const result=await request('step',{buttons});updateState(result);return result;},
  async runFrames(count,buttons=0){await pause('debug-run');const result=await request('run-frames',{count,buttons});updateState(result);return result;},
  async replayFingerprints(runs){
    await pause('debug-run');
    const result=await request('replay-fingerprints',{runs});
    updateState(await request('get-state'));
    return result;
  },
  setInput(buttons){debugBits=buttons;sendInput();},
  refresh:()=>request('get-state'),
  frameHash:()=>request('frame-hash'),
  async saveBytes(){const {buffer}=await request('get-sram');return [...new Uint8Array(buffer)];},
  async importSave(bytes){const buffer=Uint8Array.from(bytes).buffer;return request('set-sram',{buffer},[buffer]);},
  flushSaves:()=>saveChain,
  enableSound,
};
async function initializePlayer() {
  let remembered;
  let storageError;
  try {
    remembered = await readRememberedRom();
    const {enabled, image} = remembered;
    let message = 'Choose a ROM each time you open the player.';
    if (enabled) message = image ? 'Your ROM is saved in this browser.' : 'The next verified ROM you choose will be saved here.';
    showRomPreference(enabled, message);
  } catch (error) {
    storageError = `Local ROM storage is unavailable. ${error.message} Use Load ROM to select your file.`;
    romNotice.textContent = storageError;
  }
  try {
    if (!window.isSecureContext) throw new Error('Use localhost or HTTPS for WebGPU and local ROM verification.');
    if (!navigator.gpu) throw new Error('WebGPU is unavailable. Use a WebGPU-enabled browser over HTTPS or localhost.');
    presenter = await createPresenter(canvas);
    paintDisplayPreferences();
    if (storageError) {
      status(storageError, true);
    } else if (remembered.enabled && remembered.image !== undefined) {
      try {
        await loadRom(remembered.image);
        status('Ready · remembered ROM loaded. Choose Start Game to play.');
        if(document.activeElement===document.body&&!modalOpen())canvas.focus({preventScroll:true});
      } catch (error) {
        const message = `Could not open the remembered ROM. ${error.message} Choose Load ROM to try again.`;
        romNotice.textContent = message;
        status(message, true);
      }
    } else {
      status('Ready · choose your DKC USA v1.0 ROM.');
    }
  } catch (error) {
    status(error.message, true);
  } finally {
    rememberBox.disabled = false;
  }
}
applyPreferences();
const playerReady = initializePlayer();
if(preferenceReadError)playerReady.then(()=>status('Could not read player preferences. '+preferenceReadError,true));
requestAnimationFrame(animate);
