import {setupHdPaths} from './hd-pack.js';
import {readMusicPack,setupMusicPaths} from './music-pack.js';
import {PLAYER_KEY,PLAYER_DEFAULTS,CONFIG_LIMIT,readPlayer,validatePlayer,makeConfig,parseConfig,storeConfig,recoverConfig} from './settings.js';
import {videoChange} from './video-settings.js';
import {createPresenter} from './graphics.js';
import {loadSave,readRememberedRom,readRememberPreference,rememberPickedRom,setRememberRom,storeSave,loadStateSlot,storeStateSlot} from './storage.js';
import {ASSIST_ACTIONS,acceptsSource,bindingLabel} from './gamepad-profiles.js';
import {initControllerUI,createSettingsNavigation} from './controller-ui.js';
import {initAppShell} from './ui-shell.js';
import {initKeyboardUI,initAssistControls} from './keyboard-ui.js';
import {loadContentPages} from './content-pages.js';
import {createStartShortcut} from './start-shortcut.js';
import {pausePresentation} from './pause-presentation.js';

const $=selector=>document.querySelector(selector);
const canvas=$('#screen'),statusElement=$('#status'),saveStatus=$('#save-status');
const worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
const ROM_SIZE=4194304,ROM_SHA='fa8cacf5bbfc39ee6bbaa557adf89133d60d42f6cf9e1db30d5a36a469f74d15';
let nextId=1,pending=new Map(),presenter=null,latestFrame=null,presentedFrame=0,loading=false,retainedRom=null,lastDevicePaint=0;
let player, preferenceReadError;
try{await recoverConfig();}catch(error){preferenceReadError=error.message;}
try { player=readPlayer(); }
catch (error) { player={...PLAYER_DEFAULTS}; preferenceReadError=error.message; }
let importingConfig=false,unsavedPreferences={};
let audioContext=null,audioNode=null,audioSetup=null,sound=player.sound;
let keyBits=0,gamepadBits=0,debugBits=0,lastInput=-1;
let state={loaded:false,running:false,hasStarted:false,playbackError:false,paused:true,frameCount:0},logs=[],audioStats={},saveChain=Promise.resolve();
let committedSave=null,pendingSave=null;
const pressedCodes=new Set();
const physicalCodes=new Set(),freshKeyEvents=new WeakSet();
const startShortcuts={keyboard:createStartShortcut(),gamepad:createStartShortcut()};
let resumeGeneration=0,resumeAttempt=null,pendingPauses=0;
let lastPausePaint=0;
let appShell,keyboardUI,contentPages,contentAvailability={about:false,help:false};
let inputPlayer=0;
const navigateSettings=createSettingsNavigation();
const controllerUI=initControllerUI({
  getMode:n=>keyboardUI?.getMode(n)||'none',assistEnabled:()=>player.assist,
  onOpen:()=>appShell.openSettings('controllers'),
  onClose:()=>appShell.closeSettings(),
});
keyboardUI=initKeyboardUI({onChange:()=>{releaseInput();updateShell();},onCapture:releaseInput});
const assistUI=initAssistControls(keyboardUI,controllerUI,ASSIST_ACTIONS,bindingLabel);
function keyboardBitsFor(code){
  return [0,1].reduce((mask,n)=>mask|(acceptsSource(keyboardUI.getMode(n),'keyboard')?keyboardUI.bitForCode(code,n)<<(n*12):0),0);
}
function fullscreenAvailable(){return Boolean(document.fullscreenElement||(document.fullscreenEnabled&&typeof $('.screen-wrap').requestFullscreen==='function'));}
function hostState(){return {...state,sound,assist:player.assist,diagnostics:player.diagnostics,loading:loading||importingConfig,fullscreenAvailable:fullscreenAvailable(),resuming:Boolean(resumeAttempt),playbackBusy:Boolean(resumeAttempt)||pendingPauses>0,inputMode:keyboardUI?.getMode()||'keyboard',keyboardCustom:keyboardUI?!keyboardUI.status().isDefault:false,spaceBound:Boolean(keyboardUI&&keyboardBitsFor('Space')),spaceIsStart:Boolean(keyboardUI&&keyboardBitsFor('Space')&8),helpAvailable:contentAvailability.help,aboutAvailable:contentAvailability.about};}
function canLeaveInput(){if(!keyboardUI.canClose()||!controllerUI.canClose())return false;assistUI.cancel();return true;}
async function showInputSource(){
  const mode=keyboardUI.getMode(inputPlayer);assistUI.render();
  $('#input-source option[value=keyboard]').textContent=inputPlayer?'Keyboard':keyboardUI.status().isDefault?'Keyboard (default)':'Keyboard (custom)';
  $('#input-source').value=mode;$('#keyboard-panel').hidden=!acceptsSource(mode,'keyboard');
  return acceptsSource(mode,'gamepad')?controllerUI.open({notify:false,focus:false}):controllerUI.close({notify:false,focus:false});
}
appShell=initAppShell({
  getState:hostState,
  onMenuOpen:cancelResume,
  onBeforeOpenSettings:async tab=>{
    if(!canLeaveInput())return false;
    await pause('settings');
    return tab==='controllers'
      ?showInputSource()
      :controllerUI.close({notify:false,focus:false});
  },
  onBeforeCloseSettings:()=>canLeaveInput()&&controllerUI.close({notify:false,focus:false}),
  onCommand:runCommand,
});
contentPages=loadContentPages({aboutElement:$('#about-content'),helpElement:$('#help-content'),onAvailability:value=>{contentAvailability=value;updateShell();}});
contentPages.ready.catch(error=>status(error.message,true));
$('#input-source').value=keyboardUI.getMode();
$('#input-player').addEventListener('change',async event=>{
  if(!canLeaveInput()){event.target.value=String(inputPlayer);return;}
  inputPlayer=Number(event.target.value);keyboardUI.setPlayer(inputPlayer);controllerUI.setPlayer(inputPlayer);
  await showInputSource();updateShell();
});
$('#input-source').addEventListener('change',async event=>{
  const next=event.target.value;
  if(!canLeaveInput()){event.target.value=keyboardUI.getMode(inputPlayer);return;}
  try{await pause('input-source');if(keyboardUI.setMode(next)===false){event.target.value=keyboardUI.getMode(inputPlayer);return;}await showInputSource();updateShell();}
  catch(error){event.target.value=keyboardUI.getMode(inputPlayer);status(error.message,true);}
});
function runCommand(command){
  if(importingConfig)throw new Error('A configuration is being loaded.');
  if(command==='load-config'||command==='save-config'){
    checkConfigReady();
    if(command==='load-config')return $('#config-file').click();
    return exportConfig();
  }
  if(['quick-save','quick-load','frame-step','rewind-step','rewind-on','rewind-off','fast-forward-on','fast-forward-off'].includes(command))return runAssist(command);
  if(command==='export-repro')return exportRepro();
  if(command==='open-rom')return $('#rom-file').click();
  if(command==='start-game')return afterSettingsClosed(()=>state.running?pause():resume());
  if(command==='reset-game')return resetGame();
  if(command==='toggle')return afterSettingsClosed(()=>state.running?pause():resume());
  if(command==='audio')return enableSound(!sound);
  if(command==='fullscreen')return afterSettingsClosed(toggleFullscreen);
  if(['settings','controllers','settings/controllers'].includes(command))return appShell.openSettings('controllers');
  const section=command.replace(/^config-/, '');
  if(section==='input')return appShell.openSettings('controllers');
  if(['devices','options','video','sound','paths','saves','speed'].includes(section))return appShell.openSettings(section);
  if(command==='keyboard'){if(!contentAvailability.help)return;return afterSettingsClosed(()=>pause('help').then(()=>appShell.openHelp()));}
  if(command==='import-save')return $('#save-file').click();
  if(command==='export-save')return exportSave();
  if(command==='about'){if(!contentAvailability.about)return;return afterSettingsClosed(()=>pause('about').then(()=>{if(!$('#about-dialog').open)$('#about-dialog').showModal();}));}
}
function afterSettingsClosed(action){
  if(!appShell.isSettingsOpen())return action();
  return appShell.closeSettings().then(closed=>closed?action():undefined);
}
function modalOpen(){return Boolean(document.querySelector('dialog[open]'));}
function resetStartShortcuts(){for(const shortcut of Object.values(startShortcuts))shortcut.reset();}
function cancelResume({pausePosted=true}={}){
  const attempt=resumeAttempt;resumeGeneration++;resumeAttempt=null;attempt?.cancel();resetStartShortcuts();
  // A posted resume already belongs to the worker. Follow it with an ordered
  // pause even if its acknowledgement has not yet updated state.running.
  if(pausePosted&&attempt?.posted)pause('resume-canceled').catch(error=>status(error.message,true));
}
function canUseGameInput(){
  return state.loaded&&!loading&&!pendingPauses&&!state.playbackError&&!['error','gpu-error'].includes(state.pausedReason)&&
    !document.hidden&&document.hasFocus()&&document.activeElement===canvas&&!modalOpen()&&
    !appShell.isMenuOpen()&&!appShell.isSettingsBusy()&&!keyboardUI.isEditing()&&!controllerUI.isEditing();
}
function canUseStart(mode){return acceptsSource(keyboardUI.getMode(),mode)&&canUseGameInput();}
function keyboardStartDown(){for(const code of physicalCodes)if(keyboardUI.bitForCode(code)&8)return true;return false;}
function sampleStart(mode,pressed,source,freshPress=false){
  const result=startShortcuts[mode].sample(pressed,{allowed:canUseStart(mode),paused:!state.running,source,freshPress});
  if(result.resume&&(mode==='gamepad'||freshPress))resume({shortcut:mode}).catch(error=>status(error.message,true));
  return result;
}
function updatePauseOverlay(force=false){
  const overlay=$('#pause-overlay');if(!overlay)return;
  if(!state.loaded||state.running||loading){overlay.hidden=true;return;}
  const now=performance.now();if(!force&&now-lastPausePaint<100)return;lastPausePaint=now;
  const value=pausePresentation(hostState(),{keyboard:keyboardUI?.status(),controller:controllerUI.status(0),
    foreground:!document.hidden&&document.hasFocus(),focused:document.activeElement===canvas,
    menuOpen:appShell?.isMenuOpen(),dialogOpen:modalOpen(),fullscreen:Boolean(document.fullscreenElement)});
  for(const [id,text] of [['pause-title',value.title],['pause-input',value.input],['pause-hint',value.hint]]){
    const element=$(`#${id}`);if(element.textContent!==text)element.textContent=text;
  }
  overlay.hidden=!value.visible;
}
function updateShell(){appShell?.update(hostState());updatePauseOverlay(true);}
function status(message,error=false){statusElement.textContent=message;statusElement.classList.toggle('error',error);if(error)appShell?.showStatus();}
function saveMessage(message,error=false){saveStatus.textContent=message;saveStatus.classList.toggle('error',error);if(error)appShell?.showStatus();}
function recycle(type,buffer){worker.postMessage({type,buffer},[buffer]);}
function request(type,fields={},transfer=[]){
  const id=nextId++;
  return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject,type,generation:resumeGeneration});worker.postMessage({type,id,...fields},transfer);});
}
function updateState(value){
  if(!value)return;state={...state,...value};
  $('#export-save').disabled=!state.loaded||loading;
  $('#save-file').disabled=!state.loaded||loading;$('#import-label').setAttribute('aria-disabled',String(!state.loaded||loading));
  if(state.loaded)$('#frame-info').textContent=`${state.width ?? 256} × ${state.height ?? 224} · frame ${state.frameCount.toLocaleString()}`;
  updateShell();
}
function persist(buffer,imported=false,variant=state.variant||'stock'){
  const snapshot={buffer,imported,variant};
  pendingSave=snapshot;
  saveMessage('Saving cartridge progress…');
  // A failed transaction leaves the live SRAM available for export. A later
  // write can retry from the last bytes that actually committed.
  saveChain=saveChain.catch(()=>{}).then(async()=>{
    await storeSave(buffer,imported?undefined:committedSave,variant);
    committedSave=buffer;
    if(pendingSave===snapshot){pendingSave=null;saveMessage('Saved in this browser');}
  });
  saveChain.catch(error=>saveMessage(`Could not save in this browser. ${error.message} Use DKM → Export Save before closing.`,true));
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
  if(data.type==='sram-changed'){persist(data.buffer,data.imported,data.variant);return;}
  if(data.type==='stomp'){if(state.running)controllerUI.pulseStomp();return;}
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
  const generation=resumeGeneration,attempt={cancel:null,promise:null,posted:false};
  const canceled=new Promise(resolve=>{attempt.cancel=()=>resolve(false);});
  const valid=()=>generation===resumeGeneration&&!loading&&!pendingPauses&&!modalOpen()&&!document.hidden&&(!shortcut||canUseStart(shortcut));
  attempt.promise=(async()=>{
    if(sound){
      const ready=await Promise.race([startAudio().then(()=>true),canceled]);
      if(!ready||!valid())return state;
    }
    if(!valid())return state;
    resetAudio();attempt.posted=true;const value=await request('resume');
    if(!valid())return state;
    updateState(value);canvas.focus();status('Playing · save at Candy’s to keep game progress.');
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
        persist(failed.buffer,failed.imported,failed.variant);
        pendingSave.exported=failed.exported;
        try{await saveChain;}catch{/* The live snapshot and its export warning stay available. */}
      }
    }
    const variant=player.variant;
    let pack=null,musicNotice='';
    if(player.music==='msu1'){
      try{pack=await readMusicPack();}
      catch(error){musicNotice='Music storage could not be read. '+error.message;}
      if(!pack)musicNotice=(musicNotice||'This browser has no music pack.')+' Using the original soundtrack. Choose a pack under Config → Paths, then reload.';
    }
    const sameVariant=state.variant===variant;
    if(pendingSave && !pendingSave.exported && !sameVariant)throw new Error('The current cartridge save could not be stored. Use DKM → Export Save before changing variants.');
    let save=null,readError=null;
    const useLiveSave=sameVariant&&state.loaded&&(preserveSave||Boolean(pendingSave));
    if(useLiveSave)save=(await request('get-sram')).buffer;
    else{
      try{save=await loadSave(variant);}
      catch(error){readError=error;if(state.loaded&&sameVariant)save=(await request('get-sram')).buffer;}
    }
    const value=await request('load',{buffer,save,variant,pack,musicGain:player.musicGain},[buffer]);
    updateState({...value,playbackError:false});
    const musicStatus=$('#soundtrack-status');
    musicStatus.textContent=musicNotice;musicStatus.hidden=!musicNotice;
    if(!sameVariant)pendingSave=null;
    if(!useLiveSave&&(!readError||!sameVariant))committedSave=save;
    retainedRom=nextRom;
    if(latestFrame){recycle('recycle-frame',latestFrame.buffer);latestFrame=null;}
    presentedFrame=0;presenter.clear();
    if(readError)saveMessage(`Could not read saved progress. ${readError.message} Use DKM → Export Save to keep a local copy.`,true);
    else if(!pendingSave)saveMessage(committedSave?'Loaded cartridge save':'');
    lastInput=-1;sendInput();
    if(rememberSelection)await rememberSelectionLocally(retainedRom);
    status('ROM verified. Choose DKM → Start Game to play.');return state;
  }catch(error){try{updateState(await request('get-state'));}catch{}status(error.message,true);throw error;}
  finally{loading=false;updateState(state);}
}
async function resetGame(){
  if(!state.loaded||!retainedRom)throw new Error('Load a ROM before reloading the game.');
  const value=await loadRom(retainedRom.slice(0),{preserveSave:true});
  status('Game reloaded. Choose DKM → Start Game to play.');
  return value;
}
function sendInput(){const buttons=(keyBits|gamepadBits|debugBits)&0xffffff;if(buttons!==lastInput){lastInput=buttons;worker.postMessage({type:'input',buttons});}}
function releaseInput(){pressedCodes.clear();keyBits=0;gamepadBits=0;debugBits=0;resetStartShortcuts();sendInput();}
function refreshKeyboardInput(){keyBits=0;for(const code of pressedCodes)keyBits|=keyboardBitsFor(code);}
const keyboardAssist=new Set();
let priorAssist=new Set(),rewindHeld=false,fastHeld=false,rewindPending=false,nextRewind=0;
function assistCommand(command){
  return Promise.resolve().then(()=>runCommand(command)).catch(error=>status(error.message,true));
}
function updateAssist(){
  const active=new Set([...keyboardAssist,...controllerUI.heldAssist()]);
  const allowed=player.assist&&canUseGameInput();
  if(rewindHeld&&(!allowed||!active.has('rewind-step'))){
    rewindHeld=false;assistCommand('rewind-off');
  }
  if(fastHeld&&(!allowed||!active.has('fast-forward'))){
    fastHeld=false;assistCommand('fast-forward-off');
  }
  if(allowed)for(const action of active){
    if(priorAssist.has(action))continue;
    if(action==='rewind-step'){rewindHeld=true;nextRewind=0;if(state.running)assistCommand('rewind-on');}
    else if(action==='fast-forward'){fastHeld=true;assistCommand('fast-forward-on');}
    else assistCommand(action);
  }
  if(rewindHeld&&!state.running&&!rewindPending&&performance.now()>=nextRewind){
    nextRewind=performance.now()+110;rewindPending=true;assistCommand('rewind-step').finally(()=>{rewindPending=false;});
  }
  priorAssist=active;
}
window.addEventListener('keydown',event=>{
  if(!player.assist||event.isComposing||event.metaKey||event.ctrlKey||event.altKey||event.shiftKey&&event.code==='Tab'||!canUseGameInput())return;
  const id=Object.keys(ASSIST_ACTIONS).find(action=>keyboardUI.assistKey(action)===event.code);
  if(id){event.preventDefault();event.stopImmediatePropagation();keyboardAssist.add(id);updateAssist();}
},true);
window.addEventListener('keyup',event=>{
  const id=Object.keys(ASSIST_ACTIONS).find(action=>keyboardUI.assistKey(action)===event.code);
  if(id&&keyboardAssist.delete(id)){event.preventDefault();updateAssist();}
},true);
canvas.addEventListener('blur',()=>{keyboardAssist.clear();updateAssist();});
function gamepad(){
  let pads=[];
  try{pads=navigator.getGamepads?.()||[];}catch{}
  const captureBlocked=controllerUI.isCapturing()||keyboardUI.isCapturing()||assistUI.isListening();
  controllerUI.poll(pads);const input=controllerUI.inputState(),input2=controllerUI.inputState(1);
  const dialog=$('#app-settings');
  navigateSettings(pads,captureBlocked||dialog?.contains(document.activeElement)&&document.activeElement.matches('input[type=text]'),
    appShell.isSettingsOpen()&&Array.from(pads).some(p=>p&&p.mapping!=='standard')?controllerUI.status().mappedBits:0,
    ()=>{if(canUseGameInput())runCommand('controllers');},
    ()=>requestAnimationFrame(()=>{if(!modalOpen())canvas.focus({preventScroll:true});}));
  updateAssist();
  const start=sampleStart('gamepad',Boolean(input.buttons&8),input.source);
  const keyboardStart=sampleStart('keyboard',keyboardStartDown(),'keyboard');
  if(keyboardStart.suppress&&keyBits&8){keyBits&=~8;}
  gamepadBits=canUseGameInput()?(input.buttons&~(start.suppress?8:0))|(input2.buttons<<12):0;sendInput();
  const deviceList=$('#device-list'),now=performance.now();
  if(deviceList&&appShell.isSettingsOpen()&&appShell.activeSettingsTab()==='devices'&&now-lastDevicePaint>100){
    lastDevicePaint=now;
    const connected=Array.from(pads).filter(pad=>pad?.connected!==false&&pad?.buttons&&pad?.axes);
    const keyboardDescription=`Keyboard — ${[0,1].some(n=>acceptsSource(keyboardUI.getMode(n),'keyboard'))?'active input':'available'}${keyboardUI.status().isDefault?' (default bindings)':' (custom bindings)'}`;
    const controllers=connected.length?connected.map(pad=>`${pad.id}\n${pad.mapping==='standard'?'Standard layout':'Custom mapping required'} · ${pad.buttons.length} buttons · ${pad.axes.length} axes`).join('\n\n'):'No controller detected. Connect one and press a button to make it available.';
    const description=`${keyboardDescription}\n\n${controllers}`;
    if(deviceList.textContent!==description)deviceList.textContent=description;
  }
}
function animate(){
  gamepad();
  updatePauseOverlay();
  if(latestFrame&&presenter){const frame=latestFrame;latestFrame=null;try{presenter.draw(frame.buffer,frame.width,frame.height);presentedFrame=frame.frameCount;}catch(error){updateState({playbackError:true});status(error.message,true);pause('gpu-error').catch(console.error);}finally{recycle('recycle-frame',frame.buffer);}}
  requestAnimationFrame(animate);
}
window.addEventListener('keydown',event=>{
  if(!physicalCodes.has(event.code)&&!event.repeat)freshKeyEvents.add(event);
  physicalCodes.add(event.code);
  if(!canUseStart('keyboard'))startShortcuts.keyboard.sample(keyboardStartDown(),{source:'keyboard'});
},true);
window.addEventListener('keyup',event=>{physicalCodes.delete(event.code);sampleStart('keyboard',keyboardStartDown(),'keyboard');},true);
window.addEventListener('keydown',event=>{
  if(event.defaultPrevented||event.isComposing||event.metaKey||event.ctrlKey||event.altKey||!state.loaded||document.activeElement!==canvas)return;
  const bit=keyboardBitsFor(event.code);if(!bit)return;
  if(bit&8){
    const start=sampleStart('keyboard',keyboardStartDown(),'keyboard',freshKeyEvents.has(event));
    if(start.suppress){event.preventDefault();return;}
  }
  if(!state.running||!canUseGameInput())return;
  event.preventDefault();pressedCodes.add(event.code);refreshKeyboardInput();sendInput();
});
window.addEventListener('keyup',event=>{if(pressedCodes.delete(event.code)){if(document.activeElement===canvas)event.preventDefault();refreshKeyboardInput();sendInput();}});
canvas.addEventListener('blur',()=>{cancelResume();pressedCodes.clear();keyBits=0;sendInput();});
canvas.addEventListener('pointerdown',()=>{
  if(!modalOpen()&&!appShell.isMenuOpen())canvas.focus({preventScroll:true});
});
document.addEventListener('focusin',()=>updatePauseOverlay(true));
document.addEventListener('focusout',()=>updatePauseOverlay(true));
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
    const message = retainedRom ? 'Your ROM is saved in this browser.' : 'The next verified ROM you choose will be saved here.';
    showRomPreference(enabled, enabled ? message : 'Local ROM removed. Choose a ROM on your next visit.');
  } catch (error) {
    showRomPreference(rememberEnabled, `Could not change ROM storage: ${error.message}`);
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
  document.documentElement.style.colorScheme=scheme;
}
appearanceQuery.addEventListener('change',applyAppearance);
function configureAudio(){
  audioNode?.port.postMessage({type:'settings',volume:player.volume/100,driftCorrection:player.audioDriftCorrection,preroll:player.audioPreroll});
}
function paintPreferences(){
  for(const control of document.querySelectorAll('[data-pref]')){
    const value=player[control.dataset.pref];
    if(control.type==='checkbox')control.checked=value;
    else control.value=String(value);
  }
  for(const output of document.querySelectorAll('[data-value-for]'))output.textContent=String(player[output.dataset.valueFor]);
}
function applyPreferences(){
  if(sound!==player.sound){sound=player.sound;resetAudio();}
  paintPreferences();applyAppearance();configureAudio();
  presenter?.configure(player);
  worker.postMessage({type:'preferences',player});
  worker.postMessage({type:'music-gain',gain:player.musicGain});
  updateShell();
}
function changePreference(key,value){
  if(importingConfig)throw new Error('Wait for the configuration to finish loading.');
  let base=player;
  try{base={...readPlayer(),...unsavedPreferences};}catch{/* Private-session edits can still apply. */}
  const change=videoChange(key,value);
  const next=validatePlayer({...base,...change});
  try{localStorage.setItem(PLAYER_KEY,JSON.stringify(next));unsavedPreferences={};}
  catch(error){Object.assign(unsavedPreferences,change);status('This setting applies for this session. Could not save preferences: '+error.message,true);}
  player=next;applyPreferences();
}
$('#app-settings').addEventListener('change',event=>{
  const control=event.target;
  if(!control.matches('[data-pref]'))return;
  const key=control.dataset.pref;
  const value=control.type==='checkbox'?control.checked:typeof PLAYER_DEFAULTS[key]==='number'?Number(control.value):control.value;
  try{changePreference(key,value);}
  catch(error){paintPreferences();status(error.message,true);}
});
function checkConfigReady(){
  if(loading||importingConfig||rememberBox.disabled)throw new Error('Wait for the current operation to finish.');
  if(keyboardUI.isEditing()||controllerUI.isEditing()||assistUI.isListening())throw new Error('Save or discard your input edits before changing configuration.');
}
function download(blob,name){
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');link.href=url;link.download=name;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function exportRepro(){
  const trace=await request('repro');
  const bytes=new Uint8Array(trace.buffer);
  const parts=[];
  for(let i=0;i<bytes.length;i+=16384)parts.push(String.fromCharCode(...bytes.subarray(i,i+16384)));
  delete trace.buffer;
  const data={schema:'dkc.web-repro',version:1,core:'v0.0.17',romSha256:ROM_SHA,...trace,
    checkpointBase64:btoa(parts.join('')),player,host:{presentedFrame,audio:audioStats}};
  download(new Blob([JSON.stringify(data)],{type:'application/json'}),'DKC-repro-frame-'+trace.endFrame+'.json');
}
async function exportConfig(){
  await playerReady;checkConfigReady();
  const rememberRom=await readRememberPreference();
  const config=makeConfig(player,keyboardUI.exportSettings(),controllerUI.exportSettings(),rememberRom);
  download(new Blob([JSON.stringify(config,null,2)+'\n'],{type:'application/json'}),'DKC1RecompWeb.config.json');
}
$('#config-file').addEventListener('change',async event=>{
  const input=event.target,file=input.files[0];
  input.value='';
  if(!file)return;
  let locked=false;
  try{
    await playerReady;checkConfigReady();
    if(file.size>CONFIG_LIMIT)throw new Error('Configuration file is too large.');
    const config=parseConfig(await file.text());checkConfigReady();
    importingConfig=true;locked=true;$('#app-menubar').inert=true;$('#app-settings').inert=true;
    await storeConfig(config,config.rememberRom?retainedRom:null);
    player=config.player;unsavedPreferences={};
    keyboardUI.applySettings(config.keyboard);controllerUI.applySettings(config.controllers);
    await showInputSource();
    showRomPreference(config.rememberRom,config.rememberRom?'Remember ROM is enabled.':'Choose a ROM on your next visit.');
    releaseInput();applyPreferences();status('Configuration loaded.');
  }catch(error){status(error.message,true);}
  finally{if(locked){importingConfig=false;$('#app-settings').inert=false;$('#app-menubar').inert=false;updateShell();}}
});
let assistBusy=false;
async function runAssist(command){
  if(command==='fast-forward-off'||command==='rewind-off'){
    resetAudio();worker.postMessage({type:command==='rewind-off'?'rewind-held':'fast-forward',held:false});return;
  }
  if(!state.loaded||loading)throw new Error('Load a game first.');
  if(['fast-forward-on','rewind-step','rewind-on'].includes(command)&&!player.assist)throw new Error('Turn on Assist in Config → Speed.');
  if(command==='fast-forward-on'||command==='rewind-on'){
    resetAudio();worker.postMessage({type:command==='rewind-on'?'rewind-held':'fast-forward',held:true});return;
  }
  if(assistBusy)return;
  assistBusy=true;
  const slot=player.stateSlot,variant=state.variant;
  try{
    if(command==='quick-save'){
      const snapshot=await request('snapshot');
      await storeStateSlot(snapshot.variant,slot,snapshot);
      saveMessage('Saved state to slot '+slot+'.');
    }else if(command==='quick-load'){
      const snapshot=await loadStateSlot(variant,slot);
      if(!snapshot)throw new Error('State slot '+slot+' is empty.');
      if(loading||state.variant!==variant)throw new Error('The loaded game changed.');
      await pause('state');await request('restore-state',snapshot,[snapshot.buffer]);
      saveMessage('Loaded state from slot '+slot+'.');
    }else{
      await pause(command);
      await request(command==='frame-step'?'step':'rewind-step',{buttons:0});
    }
    resetAudio();updateShell();
  }finally{assistBusy=false;}
}
async function exportSave(){
  const variant=state.variant, {buffer}=await request('get-sram');
  download(new Blob([buffer],{type:'application/octet-stream'}),variant==='dixie'?'Dixie Kong Country.srm':'Donkey Kong Country.srm');
  if(pendingSave?.variant===variant){
    const live=new Uint8Array(buffer);
    pendingSave.exported=new Uint8Array(pendingSave.buffer).every((byte,index)=>byte===live[index]);
  }
}
$('#export-save').addEventListener('click',()=>exportSave().catch(error=>saveMessage(error.message,true)));
$('#save-file').addEventListener('change',async event=>{
  const file=event.target.files[0];if(!file)return;
  try{
    const buffer=await file.arrayBuffer();if(buffer.byteLength!==2048)throw new Error('Save must be exactly 2,048 bytes.');
    await pause('import');await request('set-sram',{buffer},[buffer]);
    status('Save imported. Choose DKM → Reload Game to load its game files.');
    // persist() reports transaction failures with the export recovery command.
    await saveChain.then(()=>saveMessage('Imported cartridge save'),()=>{});
  }catch(error){saveMessage(error.message,true);}finally{event.target.value='';}
});

window.dkcDebug={
  status:()=>({...hostState(),presentedFrame,sound,audioContextState:audioContext?.state||'not-created',audioStats:{...audioStats},logs:[...logs],loading}),
  pause,resume,loadRom,
  controllers:n=>controllerUI.status(n),
  keyboard:n=>keyboardUI.status(n),
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
    storageError = `Local ROM storage is unavailable. ${error.message} Use DKM → Load ROM to select your file.`;
    romNotice.textContent = storageError;
  }
  try {
    if (!window.isSecureContext) throw new Error('Use localhost or HTTPS for WebGPU and local ROM verification.');
    if (!navigator.gpu) throw new Error('WebGPU is unavailable. Use a WebGPU-enabled browser over HTTPS or localhost.');
    presenter = await createPresenter(canvas);
    presenter.configure(player);
    if (storageError) {
      status(storageError, true);
    } else if (remembered.enabled && remembered.image !== undefined) {
      try {
        await loadRom(remembered.image);
        status('Ready · remembered ROM loaded. Choose DKM → Start Game to play.');
      } catch (error) {
        const message = `Could not open the remembered ROM. ${error.message} Choose DKM → Load ROM to try again.`;
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

setupMusicPaths();setupHdPaths();
