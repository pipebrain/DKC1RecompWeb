import {ACTIONS} from './gamepad-profiles.js';
import {KEYBOARD_STORAGE_KEY,DEFAULT_KEYBOARD_BINDINGS,defaultKeyboardSettings,parseKeyboardSettings,
  validateKeyboardBindings,keyboardKeyMap,keyboardCodeLabel,keyboardEventCode,isDefaultKeyboardBindings} from './keyboard-profiles.js';

const clone=value=>JSON.parse(JSON.stringify(value));

export function initKeyboardUI({onChange=()=>{},onCapture=()=>{}}={}){
  const ids=['keyboard-panel','keyboard-bindings','keyboard-save','keyboard-discard','keyboard-defaults','keyboard-capture-cancel','keyboard-message','keyboard-draft'];
  const elements=Object.fromEntries(ids.map(id=>[id,document.getElementById(id)]));
  for(const id of ids)if(!elements[id])throw new Error(`Missing keyboard settings element: ${id}.`);
  let settings=defaultKeyboardSettings(),storageAvailable=true,initialError=null;
  try{const stored=localStorage.getItem(KEYBOARD_STORAGE_KEY);if(stored)settings=parseKeyboardSettings(stored);}
  catch(error){storageAvailable=false;initialError=`Keyboard settings could not be loaded: ${error.message}`;}
  let draft=clone(settings.bindings),map=keyboardKeyMap(settings.bindings),dirty=false,captureAction=null;

  function tell(message,error=false){elements['keyboard-message'].textContent=message;elements['keyboard-message'].classList.toggle('error',error);}
  function notify(){onChange();}
  function write(next){
    try{localStorage.setItem(KEYBOARD_STORAGE_KEY,JSON.stringify(next));storageAvailable=true;}
    catch(error){storageAvailable=false;throw new Error(`Keyboard settings could not be saved: ${error.message}`);}
  }
  function cancelCapture(){captureAction=null;elements['keyboard-capture-cancel'].hidden=true;render();}
  function updateDirty(){dirty=JSON.stringify(draft)!==JSON.stringify(settings.bindings);}
  function changeBinding(action,codes){
    const next=clone(draft);next[action]=codes;
    draft=validateKeyboardBindings(next);updateDirty();render();
  }
  function listen(action){
    captureAction=action;elements['keyboard-capture-cancel'].hidden=false;
    onCapture();render();tell(`Press a key for ${ACTIONS.find(item=>item.id===action).label}. Escape cancels.`);
  }
  function render(){
    const active=document.activeElement,focusedAction=active?.dataset.keyboardLearn||active?.dataset.keyboardClear;
    const focusedClear=Boolean(active?.dataset.keyboardClear);
    elements['keyboard-save'].disabled=!dirty&&storageAvailable;
    elements['keyboard-discard'].disabled=!dirty&&!captureAction;
    elements['keyboard-draft'].textContent=dirty?'Unsaved keyboard changes':isDefaultKeyboardBindings(settings.bindings)?'Keyboard (default)':'Custom keyboard bindings';
    const rows=[];
    for(const action of ACTIONS){
      const row=document.createElement('div');row.className='keyboard-binding-row';row.dataset.keyboardAction=action.id;
      const title=document.createElement('strong');title.textContent=action.label;
      const keys=document.createElement('div');keys.className='keyboard-bindings';
      if(!draft[action.id].length){const empty=document.createElement('span');empty.textContent='Unassigned';keys.append(empty);}
      for(const code of draft[action.id]){const key=document.createElement('kbd');key.className='keyboard-binding';key.textContent=keyboardCodeLabel(code);key.dataset.keyCode=code;keys.append(key);}
      const learn=document.createElement('button');learn.type='button';learn.dataset.keyboardLearn=action.id;learn.textContent=captureAction===action.id?'Listening…':'Set key';learn.setAttribute('aria-label',`Set key for ${action.label}`);learn.addEventListener('click',()=>listen(action.id));
      const clear=document.createElement('button');clear.type='button';clear.dataset.keyboardClear=action.id;clear.textContent='Clear';clear.disabled=!draft[action.id].length;clear.setAttribute('aria-label',`Clear key for ${action.label}`);clear.addEventListener('click',()=>{cancelCapture();changeBinding(action.id,[]);tell('Binding cleared. Save to keep the change.');});
      row.append(title,keys,learn,clear);rows.push(row);
    }
    elements['keyboard-bindings'].replaceChildren(...rows);
    if(focusedAction){
      const row=rows.find(item=>item.dataset.keyboardAction===focusedAction);
      const target=focusedClear&&draft[focusedAction].length?row?.querySelector('[data-keyboard-clear]'):row?.querySelector('[data-keyboard-learn]');
      target?.focus({preventScroll:true});
    }
  }
  function canClose(){
    if(dirty){tell('Save or discard your keyboard changes first.',true);return false;}
    if(captureAction)cancelCapture();
    return true;
  }
  function setMode(mode){
    if(!['keyboard','gamepad'].includes(mode))throw new Error('Choose Keyboard or Gamepad as the input source.');
    if(mode===settings.mode)return true;
    if(!canClose())return false;
    const next={...settings,mode};settings=next;
    try{write(next);}catch(error){tell(`${error.message} This input source still works for this session.`,true);}
    render();notify();return true;
  }
  elements['keyboard-save'].addEventListener('click',()=>{
    try{
      const next={...settings,bindings:validateKeyboardBindings(draft)};write(next);
      settings=next;draft=clone(settings.bindings);map=keyboardKeyMap(settings.bindings);dirty=false;cancelCapture();notify();tell('Keyboard bindings saved in this browser.');
    }catch(error){tell(error.message,true);}
  });
  elements['keyboard-discard'].addEventListener('click',()=>{draft=clone(settings.bindings);dirty=false;cancelCapture();tell('Unsaved keyboard changes discarded.');});
  elements['keyboard-defaults'].addEventListener('click',()=>{cancelCapture();draft=clone(DEFAULT_KEYBOARD_BINDINGS);updateDirty();render();tell(dirty?'Default keys restored. Save to keep them.':'Already using the default keyboard bindings.');});
  elements['keyboard-capture-cancel'].addEventListener('click',()=>{cancelCapture();tell('Key capture cancelled.');});
  document.addEventListener('keydown',event=>{
    if(!captureAction)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(event.code==='Escape'){cancelCapture();tell('Key capture cancelled.');return;}
    if(event.repeat)return;
    const code=keyboardEventCode(event);
    if(!code){tell('Choose a key without Control, Alt/Option, or Command/Windows. Tab and Escape are reserved.',true);return;}
    try{
      const action=captureAction;changeBinding(action,[code]);cancelCapture();
      tell(`${keyboardCodeLabel(code)} assigned. Save to keep the change.`);
    }catch(error){tell(error.message,true);}
  },true);
  render();tell(initialError||'Keyboard is the default input. Select Set key beside an action to change it.',Boolean(initialError));
  return {
    keyMap:()=>map,bitForCode:code=>typeof map[code]==='number'?map[code]:0,getMode:()=>settings.mode,setMode,
    canClose,hasUnsavedChanges:()=>dirty,isEditing:()=>dirty||Boolean(captureAction),cancelCapture,
    status:()=>({mode:settings.mode,isDefault:isDefaultKeyboardBindings(settings.bindings),dirty,
      bindings:clone(settings.bindings),draftBindings:clone(draft),captureAction,storageAvailable}),
  };
}
