import {createPresenter} from './graphics.js';
import {loadSave,readRememberedRom,rememberPickedRom,setRememberRom,storeSave} from './storage.js';
import {initControllerUI} from './controller-ui.js';
import {initAppShell} from './ui-shell.js';
import {initKeyboardUI} from './keyboard-ui.js';
import {loadContentPages} from './content-pages.js';
import {createStartShortcut} from './start-shortcut.js';
import {pausePresentation} from './pause-presentation.js';

const $=selector=>document.querySelector(selector);
const canvas=$('#screen'),statusElement=$('#status'),saveStatus=$('#save-status');
const worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
const ROM_SIZE=4194304,ROM_SHA='fa8cacf5bbfc39ee6bbaa557adf89133d60d42f6cf9e1db30d5a36a469f74d15';
let nextId=1,pending=new Map(),presenter=null,latestFrame=null,presentedFrame=0,loading=false,retainedRom=null,lastDevicePaint=0;
let audioContext=null,audioNode=null,audioSetup=null,sound=true;
let keyBits=0,gamepadBits=0,debugBits=0,lastInput=-1;
let state={loaded:false,running:false,hasStarted:false,playbackError:false,paused:true,frameCount:0},logs=[],audioStats={},saveChain=Promise.resolve();
let committedSave=null,pendingSave=null;
const pressedCodes=new Set();
const physicalCodes=new Set(),freshKeyEvents=new WeakSet();
const startShortcuts={keyboard:createStartShortcut(),gamepad:createStartShortcut()};
let resumeGeneration=0,resumeAttempt=null,pendingPauses=0;
let lastPausePaint=0;
let appShell,keyboardUI,contentPages,contentAvailability={about:false,help:false};
const controllerUI=initControllerUI({
  onOpen:()=>appShell.openSettings('controllers'),
  onClose:()=>appShell.closeSettings(),
});
keyboardUI=initKeyboardUI({onChange:()=>{releaseInput();updateShell();},onCapture:releaseInput});
function fullscreenAvailable(){return Boolean(document.fullscreenElement||(document.fullscreenEnabled&&typeof $('.screen-wrap').requestFullscreen==='function'));}
function hostState(){return {...state,sound,loading,fullscreenAvailable:fullscreenAvailable(),resuming:Boolean(resumeAttempt),playbackBusy:Boolean(resumeAttempt)||pendingPauses>0,inputMode:keyboardUI?.getMode()||'keyboard',keyboardCustom:keyboardUI?!keyboardUI.status().isDefault:false,spaceBound:keyboardUI?.getMode()==='keyboard'&&Boolean(keyboardUI.bitForCode('Space')),spaceIsStart:keyboardUI?.getMode()==='keyboard'&&keyboardUI.bitForCode('Space')===8,helpAvailable:contentAvailability.help,aboutAvailable:contentAvailability.about};}
function canLeaveInput(){return keyboardUI.canClose()&&controllerUI.canClose();}
async function showInputSource(){
  const mode=keyboardUI.getMode();
  $('#input-source').value=mode;$('#keyboard-panel').hidden=mode!=='keyboard';
  return mode==='gamepad'?controllerUI.open({notify:false,focus:false}):controllerUI.close({notify:false,focus:false});
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
$('#input-source').addEventListener('change',async event=>{
  const next=event.target.value;
  if(!canLeaveInput()){event.target.value=keyboardUI.getMode();return;}
  try{await pause('input-source');if(keyboardUI.setMode(next)===false){event.target.value=keyboardUI.getMode();return;}await showInputSource();updateShell();}
  catch(error){event.target.value=keyboardUI.getMode();status(error.message,true);}
});
function runCommand(command){
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
function canUseStart(mode){
  return state.loaded&&!loading&&!pendingPauses&&!state.playbackError&&!['error','gpu-error'].includes(state.pausedReason)&&keyboardUI.getMode()===mode&&
    !document.hidden&&document.hasFocus()&&document.activeElement===canvas&&!modalOpen()&&
    !appShell.isMenuOpen()&&!appShell.isSettingsBusy()&&!keyboardUI.isEditing()&&!controllerUI.isEditing();
}
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
  const value=pausePresentation(hostState(),{keyboard:keyboardUI?.status(),controller:controllerUI.status(),
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
  if(state.loaded)$('#frame-info').textContent=`256 × 224 · frame ${state.frameCount.toLocaleString()}`;
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
  if(data.type==='sram-changed'){persist(data.buffer,data.imported);return;}
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
    node.connect(context.destination);audioNode=node;
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
  sound=enabled;resetAudio();updateShell();
  if(enabled)await startAudio();
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
        persist(pendingSave.buffer,pendingSave.imported);
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
function sendInput(){const buttons=(keyBits|gamepadBits|debugBits)&4095;if(buttons!==lastInput){lastInput=buttons;worker.postMessage({type:'input',buttons});}}
function releaseInput(){pressedCodes.clear();keyBits=0;gamepadBits=0;debugBits=0;resetStartShortcuts();sendInput();}
function refreshKeyboardInput(){keyBits=0;for(const code of pressedCodes)keyBits|=keyboardUI.bitForCode(code);}
function gamepad(){
  let pads=[];
  try{pads=navigator.getGamepads?.()||[];}catch{}
  const mapped=controllerUI.poll(pads),input=controllerUI.inputState();
  const start=sampleStart('gamepad',Boolean(input.buttons&8),input.source);
  const keyboardStart=sampleStart('keyboard',keyboardStartDown(),'keyboard');
  if(keyboardStart.suppress&&keyBits&8){keyBits&=~8;}
  gamepadBits=canUseStart('gamepad')?mapped&~(start.suppress?8:0):0;sendInput();
  const deviceList=$('#device-list'),now=performance.now();
  if(deviceList&&appShell.isSettingsOpen()&&appShell.activeSettingsTab()==='devices'&&now-lastDevicePaint>100){
    lastDevicePaint=now;
    const connected=Array.from(pads).filter(pad=>pad?.connected!==false&&pad?.buttons&&pad?.axes);
    const keyboardDescription=`Keyboard — ${keyboardUI.getMode()==='keyboard'?'active input':'available'}${keyboardUI.status().isDefault?' (default bindings)':' (custom bindings)'}`;
    const controllers=connected.length?connected.map(pad=>`${pad.id}\n${pad.mapping==='standard'?'Standard layout':'Custom mapping required'} · ${pad.buttons.length} buttons · ${pad.axes.length} axes`).join('\n\n'):'No controller detected. Connect one and press a button to make it available.';
    const description=`${keyboardDescription}\n\n${controllers}`;
    if(deviceList.textContent!==description)deviceList.textContent=description;
  }
}
function animate(){
  gamepad();
  updatePauseOverlay();
  if(latestFrame&&presenter){const frame=latestFrame;latestFrame=null;try{presenter.draw(frame.buffer);presentedFrame=frame.frameCount;}catch(error){updateState({playbackError:true});status(error.message,true);pause('gpu-error').catch(console.error);}finally{recycle('recycle-frame',frame.buffer);}}
  requestAnimationFrame(animate);
}
window.addEventListener('keydown',event=>{
  if(!physicalCodes.has(event.code)&&!event.repeat)freshKeyEvents.add(event);
  physicalCodes.add(event.code);
  if(!canUseStart('keyboard'))startShortcuts.keyboard.sample(keyboardStartDown(),{source:'keyboard'});
},true);
window.addEventListener('keyup',event=>{physicalCodes.delete(event.code);sampleStart('keyboard',keyboardStartDown(),'keyboard');},true);
window.addEventListener('keydown',event=>{
  if(event.defaultPrevented||event.isComposing||event.metaKey||event.ctrlKey||event.altKey||keyboardUI.getMode()!=='keyboard'||!state.loaded||document.activeElement!==canvas)return;
  const bit=keyboardUI.bitForCode(event.code);if(!bit)return;
  if(bit&8){
    const start=sampleStart('keyboard',keyboardStartDown(),'keyboard',freshKeyEvents.has(event));
    if(start.suppress){event.preventDefault();return;}
  }
  if(!state.running||!canUseStart('keyboard'))return;
  event.preventDefault();pressedCodes.add(event.code);refreshKeyboardInput();sendInput();
});
window.addEventListener('keyup',event=>{if(pressedCodes.delete(event.code)){if(document.activeElement===canvas)event.preventDefault();refreshKeyboardInput();sendInput();}});
canvas.addEventListener('blur',()=>{cancelResume();pressedCodes.clear();keyBits=0;sendInput();});
canvas.addEventListener('pointerdown',()=>{
  if(!modalOpen()&&!appShell.isMenuOpen())canvas.focus({preventScroll:true});
});
document.addEventListener('focusin',()=>updatePauseOverlay(true));
document.addEventListener('focusout',()=>updatePauseOverlay(true));
window.addEventListener('blur',()=>{cancelResume();physicalCodes.clear();releaseInput();if(state.running)pause('blur').catch(console.error);});
window.addEventListener('gamepadconnected',resetStartShortcuts);
window.addEventListener('gamepaddisconnected',()=>{cancelResume();gamepadBits=0;sendInput();});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.loaded)pause('hidden').catch(console.error);});
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
async function exportSave(){
  const {buffer}=await request('get-sram');const url=URL.createObjectURL(new Blob([buffer],{type:'application/octet-stream'}));const link=document.createElement('a');link.href=url;link.download='Donkey Kong Country.srm';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
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
  controllers:()=>controllerUI.status(),
  keyboard:()=>keyboardUI.status(),
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
const playerReady = initializePlayer();
requestAnimationFrame(animate);
