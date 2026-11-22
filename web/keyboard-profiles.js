// Physical keyboard bindings and settings validation. No browser dependencies.
import {ACTIONS,ASSIST_ACTIONS} from './gamepad-profiles.js';

export const KEYBOARD_SCHEMA='dkc.keyboard-settings';
export const KEYBOARD_VERSION=2;
export const KEYBOARD_STORAGE_KEY='dkc.keyboard-settings.v2';
export const LEGACY_KEYBOARD_KEY='dkc.keyboard-settings.v1';
export const MAX_KEYBOARD_BYTES=65536;
export const DEFAULT_KEYBOARD_BINDINGS=Object.freeze({
  b:Object.freeze(['KeyZ']),y:Object.freeze(['KeyX']),
  select:Object.freeze(['ShiftLeft','ShiftRight']),start:Object.freeze(['Enter']),
  up:Object.freeze(['ArrowUp']),down:Object.freeze(['ArrowDown']),
  left:Object.freeze(['ArrowLeft']),right:Object.freeze(['ArrowRight']),
  a:Object.freeze(['KeyA']),x:Object.freeze(['KeyS']),
  l:Object.freeze(['KeyQ']),r:Object.freeze(['KeyW']),
});
const actionIds=new Set(ACTIONS.map(action=>action.id));
const reserved=new Set(['Tab','Escape','MetaLeft','MetaRight','ControlLeft','ControlRight','AltLeft','AltRight']);
const standardCodes=new Set([
  'Space','Enter','NumpadEnter','ShiftLeft','ShiftRight','Backspace','Delete','Insert',
  'Home','End','PageUp','PageDown','ArrowUp','ArrowDown','ArrowLeft','ArrowRight',
  'Backquote','Minus','Equal','BracketLeft','BracketRight','Backslash',
  'Semicolon','Quote','Comma','Period','Slash','CapsLock','NumLock','ScrollLock',
  'Pause','PrintScreen','ContextMenu','IntlBackslash','IntlRo','IntlYen',
  'Convert','NonConvert','KanaMode','NumpadAdd','NumpadSubtract','NumpadMultiply',
  'NumpadDivide','NumpadDecimal','NumpadComma','NumpadEqual','NumpadParenLeft','NumpadParenRight',
]);
const clone=value=>JSON.parse(JSON.stringify(value));
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));

export function isBindableKeyboardCode(code){
  return typeof code==='string'&&!reserved.has(code)&&(
    standardCodes.has(code)||/^Key[A-Z]$/.test(code)||/^Digit[0-9]$/.test(code)||
    /^Numpad[0-9]$/.test(code)||/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(code)||/^Lang[1-5]$/.test(code));
}

export function keyboardCodeLabel(code){
  const labels={Space:'Space',ArrowUp:'↑',ArrowDown:'↓',ArrowLeft:'←',ArrowRight:'→',Enter:'Return',
    ShiftLeft:'Left Shift',ShiftRight:'Right Shift',Backquote:'`',Minus:'−',Equal:'=',
    BracketLeft:'[',BracketRight:']',Backslash:'\\',Semicolon:';',Quote:"'",Comma:',',Period:'.',Slash:'/',
    Backspace:'Backspace',Delete:'Delete',PageUp:'Page Up',PageDown:'Page Down',CapsLock:'Caps Lock',
    NumLock:'Num Lock',ScrollLock:'Scroll Lock',PrintScreen:'Print Screen',ContextMenu:'Menu'};
  if(own(labels,code))return labels[code];
  if(/^Key[A-Z]$/.test(code))return code.slice(3);
  if(/^Digit[0-9]$/.test(code))return code.slice(5);
  if(code.startsWith('Numpad'))return `Numpad ${code.slice(6)}`;
  return code;
}

export function validateKeyboardBindings(value){
  if(!record(value))throw new Error('Keyboard bindings must be an object.');
  for(const id of Object.keys(value))if(!actionIds.has(id))throw new Error(`Unknown keyboard action: ${id}.`);
  const result={},assigned=new Map();
  for(const action of ACTIONS){
    if(!own(value,action.id)||!Array.isArray(value[action.id])||value[action.id].length>4)
      throw new Error(`${action.label} must have zero to four keyboard bindings.`);
    const codes=[];
    for(const code of value[action.id]){
      if(!isBindableKeyboardCode(code))throw new Error('Choose a keyboard key. Tab, Escape, Control, Alt/Option, and Command/Windows are reserved.');
      if(codes.includes(code))throw new Error(`Duplicate key for ${action.label}: ${keyboardCodeLabel(code)}.`);
      if(assigned.has(code))throw new Error(`${keyboardCodeLabel(code)} is already assigned to ${assigned.get(code)}. Clear that assignment first.`);
      assigned.set(code,action.label);codes.push(code);
    }
    result[action.id]=codes;
  }
  return result;
}

export function defaultKeyboardSettings(){
  return {schema:KEYBOARD_SCHEMA,version:KEYBOARD_VERSION,mode:'keyboard',bindings:clone(DEFAULT_KEYBOARD_BINDINGS),
    player2:{mode:'none',bindings:Object.fromEntries(ACTIONS.map(({id})=>[id,[]]))},
    assistKeys:{'quick-save':null,'quick-load':null}};
}

function validatePort(port){
  if(!record(port)||!['keyboard','gamepad','both','none'].includes(port.mode))throw new Error('Choose an input source for each player.');
  return {mode:port.mode,bindings:validateKeyboardBindings(port.bindings)};
}
export function validateKeyboardSettings(value){
  if(!record(value))throw new Error('Keyboard settings must be an object.');
  for(const key of Object.keys(value))if(!['schema','version','mode','bindings','player2','assistKeys'].includes(key))throw new Error(`Unknown keyboard settings field: ${key}.`);
  if(value.schema!==KEYBOARD_SCHEMA||![1,KEYBOARD_VERSION].includes(value.version))throw new Error('Unsupported keyboard settings format.');
  const defaults=defaultKeyboardSettings(),{player2=defaults.player2,assistKeys=defaults.assistKeys}=value;
  if(!record(player2)||Object.keys(player2).some(key=>!['mode','bindings'].includes(key)))throw new Error('Invalid player 2 keyboard settings.');
  const legacyActions=value.version===1?['rewind-step','fast-forward','frame-step']:[];
  if(!record(assistKeys)||Object.keys(assistKeys).some(key=>!own(ASSIST_ACTIONS,key)&&!legacyActions.includes(key)))throw new Error('Invalid keyboard shortcut settings.');
  const normalized={},seen=new Set();
  for(const id of Object.keys(ASSIST_ACTIONS)){
    const code=assistKeys[id];
    if(code!==null&&code!=='Tab'&&!isBindableKeyboardCode(code))throw new Error('Invalid save-state shortcut key.');
    if(code&&seen.has(code))throw new Error('Choose a different key for each save-state shortcut.');
    normalized[id]=code;if(code)seen.add(code);
  }
  return {schema:KEYBOARD_SCHEMA,version:KEYBOARD_VERSION,...validatePort(value),player2:validatePort(player2),assistKeys:normalized};
}

export function parseKeyboardSettings(text){
  if(typeof text!=='string'||text.length>MAX_KEYBOARD_BYTES)throw new Error('Keyboard settings are too large.');
  let value;try{value=JSON.parse(text);}catch{throw new Error('Keyboard settings are not valid JSON.');}
  return validateKeyboardSettings(value);
}

export function keyboardKeyMap(bindings){
  const valid=validateKeyboardBindings(bindings),map={};
  for(const action of ACTIONS)for(const code of valid[action.id])map[code]=action.bit;
  return Object.freeze(map);
}

export function isDefaultKeyboardBindings(bindings){
  return ACTIONS.every(action=>Array.isArray(bindings[action.id])&&
    bindings[action.id].length===DEFAULT_KEYBOARD_BINDINGS[action.id].length&&
    DEFAULT_KEYBOARD_BINDINGS[action.id].every(code=>bindings[action.id].includes(code)));
}

export function keyboardEventCode(event){
  if(!event||event.isComposing||event.metaKey||event.ctrlKey||event.altKey)return null;
  return isBindableKeyboardCode(event.code)?event.code:null;
}
