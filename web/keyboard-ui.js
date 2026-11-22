import {ACTIONS} from './gamepad-profiles.js';
import {KEYBOARD_STORAGE_KEY,DEFAULT_KEYBOARD_BINDINGS,defaultKeyboardSettings,parseKeyboardSettings,validateKeyboardSettings,
  validateKeyboardBindings,keyboardKeyMap,keyboardCodeLabel,keyboardEventCode,isDefaultKeyboardBindings} from './keyboard-profiles.js';

const clone=value=>JSON.parse(JSON.stringify(value));

export function initKeyboardUI({onChange=()=>{},onCapture=()=>{}}={}){
  const ids=['keyboard-panel','keyboard-bindings','keyboard-save','keyboard-discard','keyboard-defaults','keyboard-capture-cancel','keyboard-message','keyboard-draft'];
  const elements=Object.fromEntries(ids.map(id=>[id,document.getElementById(id)]));
  for(const id of ids)if(!elements[id])throw new Error(`Missing keyboard settings element: ${id}.`);
  let settings=defaultKeyboardSettings(),storedVersion=null,storageAvailable=true,initialError=null;
  try{const stored=storedVersion=localStorage.getItem(KEYBOARD_STORAGE_KEY);if(stored)settings=parseKeyboardSettings(stored);}
  catch(error){storageAvailable=false;initialError=`Keyboard settings could not be loaded: ${error.message}`;}
  let player=0,dirty=false,captureAction=null,append=false;
  const port=(n=player)=>n===1?settings.player2:settings;
  const replacePort=(patch)=>player===1?{...settings,player2:{...settings.player2,...patch}}:{...settings,...patch};
  let draft=clone(port().bindings),maps=[];
  function rebuild(){maps=[settings,settings.player2].map(p=>keyboardKeyMap(p.bindings));}
  rebuild();

  function tell(message,error=false){elements['keyboard-message'].textContent=message;elements['keyboard-message'].classList.toggle('error',error);}
  function notify(){onChange();}
  function write(next){
    try{
      if(localStorage.getItem(KEYBOARD_STORAGE_KEY)!==storedVersion)throw new Error('Keyboard settings changed in another tab. Reload to use the newer settings.');
      const encoded=JSON.stringify(next);localStorage.setItem(KEYBOARD_STORAGE_KEY,encoded);storedVersion=encoded;storageAvailable=true;
    }
    catch(error){storageAvailable=false;throw new Error(`Keyboard settings could not be saved: ${error.message}`);}
  }
  function cancelCapture(){captureAction=null;elements['keyboard-capture-cancel'].hidden=true;render();}
  function updateDirty(){dirty=JSON.stringify(draft)!==JSON.stringify(port().bindings);}
  function changeBinding(action,codes){
    const next=clone(draft);next[action]=codes;
    draft=validateKeyboardBindings(next);updateDirty();render();
  }
  function listen(action,add=false){
    append=add;captureAction=action;elements['keyboard-capture-cancel'].hidden=false;
    onCapture();render();tell(`Press a key for ${ACTIONS.find(item=>item.id===action).label}. Escape cancels.`);
  }
  function render(){
    const active=document.activeElement,focusedAction=active?.dataset.keyboardLearn||active?.dataset.keyboardClear;
    const focusedClear=Boolean(active?.dataset.keyboardClear);
    elements['keyboard-save'].disabled=!dirty&&storageAvailable;
    elements['keyboard-discard'].disabled=!dirty&&!captureAction;
    elements['keyboard-draft'].textContent=dirty?'Unsaved keyboard changes':isDefaultKeyboardBindings(port().bindings)?'Keyboard (default)':'Custom keyboard bindings';
    const rows=[];
    for(const action of ACTIONS){
      const row=document.createElement('div');row.className='keyboard-binding-row';row.dataset.keyboardAction=action.id;
      const title=document.createElement('strong');title.textContent=action.label;
      const keys=document.createElement('div');keys.className='keyboard-bindings';
      if(!draft[action.id].length){const empty=document.createElement('span');empty.textContent='Unassigned';keys.append(empty);}
      for(const code of draft[action.id]){const key=document.createElement('kbd');key.className='keyboard-binding';key.textContent=keyboardCodeLabel(code);key.dataset.keyCode=code;keys.append(key);}
      const learn=document.createElement('button');learn.type='button';learn.dataset.keyboardLearn=action.id;learn.textContent=captureAction===action.id?'Listening…':'Set key';learn.setAttribute('aria-label',`Set key for ${action.label}`);learn.addEventListener('click',()=>listen(action.id));
      const clear=document.createElement('button');clear.type='button';clear.dataset.keyboardClear=action.id;clear.textContent='Clear';clear.disabled=!draft[action.id].length;clear.setAttribute('aria-label',`Clear key for ${action.label}`);clear.addEventListener('click',()=>{cancelCapture();changeBinding(action.id,[]);tell('Binding cleared. Save to keep the change.');});
      const add=document.createElement('button');add.type='button';add.textContent='Add key';add.disabled=draft[action.id].length>=4;
      add.setAttribute('aria-label',`Add another key for ${action.label}`);add.addEventListener('click',()=>listen(action.id,true));keys.append(add);
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
    if(!['keyboard','gamepad','both','none'].includes(mode))throw new Error('Choose an input source.');
    if(mode===port().mode)return true;
    if(!canClose())return false;
    const next=replacePort({mode});settings=next;
    try{write(next);}catch(error){tell(`${error.message} This input source still works for this session.`,true);}
    render();notify();return true;
  }
  elements['keyboard-save'].addEventListener('click',()=>{
    try{
      const next=replacePort({bindings:validateKeyboardBindings(draft)});write(next);
      settings=next;draft=clone(port().bindings);rebuild();dirty=false;cancelCapture();notify();tell('Keyboard bindings saved in this browser.');
    }catch(error){tell(error.message,true);}
  });
  elements['keyboard-discard'].addEventListener('click',()=>{draft=clone(port().bindings);dirty=false;cancelCapture();tell('Unsaved keyboard changes discarded.');});
  elements['keyboard-defaults'].addEventListener('click',()=>{cancelCapture();draft=clone(player?defaultKeyboardSettings().player2.bindings:DEFAULT_KEYBOARD_BINDINGS);updateDirty();render();tell(dirty?'Default keys restored. Save to keep them.':'Already using the default keyboard bindings.');});
  elements['keyboard-capture-cancel'].addEventListener('click',()=>{cancelCapture();tell('Key capture cancelled.');});
  document.addEventListener('keydown',event=>{
    if(!captureAction)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(event.code==='Escape'){cancelCapture();tell('Key capture cancelled.');return;}
    if(event.repeat)return;
    const code=keyboardEventCode(event);
    if(!code){tell('Choose a key without Control, Alt/Option, or Command/Windows. Tab and Escape are reserved.',true);return;}
    try{
      const action=captureAction;changeBinding(action,append?[...draft[action],code]:[code]);cancelCapture();
      tell(`${keyboardCodeLabel(code)} assigned. Save to keep the change.`);
    }catch(error){tell(error.message,true);}
  },true);
  render();tell(initialError||'Keyboard is the default input. Select Set key beside an action to change it.',Boolean(initialError));
  return {
    exportSettings:()=>clone(settings),
    applySettings(value){
      if(!canClose())throw new Error('Save or discard keyboard changes first.');
      settings=validateKeyboardSettings(value);storedVersion=localStorage.getItem(KEYBOARD_STORAGE_KEY);storageAvailable=true;draft=clone(port().bindings);dirty=false;rebuild();cancelCapture();notify();
    },
    setPlayer(n){if(!canClose())return false;player=n;draft=clone(port().bindings);cancelCapture();return true;},
    setAssistKey(action,code){
      const next=validateKeyboardSettings({...settings,assistKeys:{...settings.assistKeys,[action]:code}});
      write(next);settings=next;notify();
    },
    assistKey:action=>settings.assistKeys[action],
    keyMap:(n=0)=>maps[n],bitForCode:(code,n=0)=>Object.hasOwn(maps[n],code)?maps[n][code]:0,getMode:(n=0)=>port(n).mode,setMode,
    canClose,isCapturing:()=>Boolean(captureAction),hasUnsavedChanges:()=>dirty,isEditing:()=>dirty||Boolean(captureAction),cancelCapture,
    status:(n=0)=>({mode:port(n).mode,isDefault:isDefaultKeyboardBindings(port(n).bindings),dirty,
      bindings:clone(port(n).bindings),draftBindings:clone(draft),captureAction,storageAvailable}),
  };
}

// Assist bindings are global host shortcuts and use the currently selected pad for capture.
export function initAssistControls(keyboard,controllers,actions,formatBinding){
  const group=document.getElementById('assist-shortcut-rows'),message=document.getElementById('assist-shortcut-status');
  let listening=null;
  const labels=new Map();
  function render(){
    for(const [id,text] of labels){
      const key=keyboard.assistKey(id),pad=controllers.assistBinding(id);
      text.textContent=`${key?keyboardCodeLabel(key):'No key'} · ${pad?formatBinding(pad):'No controller binding'}`;
    }
  }
  function button(row,title,fn){
    const control=document.createElement('button');control.type='button';control.textContent=title;
    control.addEventListener('click',()=>{try{fn();render();}catch(error){message.textContent=error.message;}});
    row.append(control);
  }
  for(const [id,title] of Object.entries(actions)){
    const row=document.createElement('div');row.className='settings-row';
    const info=document.createElement('div'),heading=document.createElement('strong'),value=document.createElement('p');
    heading.textContent=title;labels.set(id,value);info.append(heading,value);row.append(info);
    const controls=document.createElement('div');controls.className='controller-actions';row.append(controls);
    button(controls,'Set key',()=>{controllers.cancelCapture();listening=id;message.textContent=`Press a key for ${title}. Escape cancels.`;});
    button(controls,'Clear key',()=>{listening=null;keyboard.setAssistKey(id,null);message.textContent='Keyboard shortcut cleared.';});
    button(controls,'Listen',()=>{listening=null;controllers.listenAssist(id,text=>{message.textContent=text;render();});message.textContent=`Press a controller button or move an axis for ${title}.`;});
    button(controls,'Clear controller',()=>{listening=null;controllers.cancelCapture();controllers.clearAssist(id);message.textContent='Controller shortcut cleared.';});
    group.append(row);
  }
  document.addEventListener('keydown',event=>{
    if(!listening)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(event.repeat)return;
    if(event.code==='Escape'){listening=null;message.textContent='Key capture cancelled.';return;}
    const code=event.code==='Tab'&&!event.ctrlKey&&!event.metaKey&&!event.altKey?'Tab':keyboardEventCode(event);
    if(!code){message.textContent='Choose a key without system modifiers.';return;}
    try{keyboard.setAssistKey(listening,code);listening=null;render();message.textContent='Keyboard shortcut saved.';}
    catch(error){message.textContent=error.message;}
  },true);
  group.closest('details').addEventListener('toggle',event=>{if(!event.target.open){listening=null;controllers.cancelCapture();}});
  render();
  return {render,cancel(){listening=null;controllers.cancelCapture();},isListening:()=>Boolean(listening)};
}
