import {
  ACTIONS, ASSIST_ACTIONS, DEFAULT_PROFILE, bindingPressed, acceptsSource,
  validateBinding, validateControllerSettings, defaultControllerSettings,
  CONTROLLER_STORAGE_KEY, LEGACY_CONTROLLER_KEY,
} from './gamepad-profiles.js';
import {
  DEFAULT_KEYBOARD_BINDINGS, isBindableKeyboardCode, validateKeyboardSettings, defaultKeyboardSettings,
  KEYBOARD_STORAGE_KEY, LEGACY_KEYBOARD_KEY,
} from './keyboard-profiles.js';

export const INPUT_PROFILES_KEY='dkc.input-profiles.v1';
const bits=new Map(ACTIONS.map(action=>[action.id,action.bit]));
const shortcutIds=Object.keys(ASSIST_ACTIONS);
const isRecord=value=>value&&typeof value==='object'&&!Array.isArray(value);
const motorDefaults=[140,80,100];

function keyboardBindings(controls) {
  return Object.entries(controls).flatMap(([action,codes])=>codes.map(code=>({action,kind:'keyboard',code})));
}

export function newProfile(id,name,bindings=[],rumbleEnabled=false,rumble=motorDefaults) {
  return {id,name,bindings,rumbleEnabled,rumble:[...rumble]};
}

export function defaultInputProfiles() {
  const controls={...DEFAULT_KEYBOARD_BINDINGS,select:['ShiftLeft']};
  return {
    profiles:[newProfile('keyboard','Keyboard',keyboardBindings(controls))], players:['keyboard',null],
    shortcuts:{keyboard:{'quick-save':null,'quick-load':null},gamepad:{'quick-save':null,'quick-load':null}},
  };
}

function validText(value,limit) {
  return typeof value==='string'&&value.length>0&&value.length<=limit;
}
function inRange(value,min,max) {return Number.isInteger(value)&&value>=min&&value<=max;}
function validateProfileBinding(entry) {
  if(!isRecord(entry)||!bits.has(entry.action))throw new Error('Invalid profile action.');
  const {action,kind}=entry;
  if(kind==='keyboard'&&isBindableKeyboardCode(entry.code))return {action,kind,code:entry.code};
  if(kind==='mouse'&&inRange(entry.button,0,31))return {action,kind,button:entry.button};
  if(kind==='gamepad'&&(entry.device===null||validText(entry.device,2047))&&validText(entry.label,2047)){
    const result={action,kind,device:entry.device,label:entry.label,input:validateBinding(entry.input)};
    if(entry.standardOnly===true)result.standardOnly=true;
    return result;
  }
  throw new Error('Invalid profile binding.');
}
export function validateInputProfiles(value) {
  if(!isRecord(value)||!Array.isArray(value.profiles)||value.profiles.length>128||
    !Array.isArray(value.players)||value.players.length!==2||!isRecord(value.shortcuts))throw new Error('Invalid input profiles.');
  const ids=new Set(),names=new Set(['disabled']);
  const profiles=value.profiles.map(profile=>{
    if(!isRecord(profile)||!validText(profile.id,100)||ids.has(profile.id)||!validText(profile.name,80)||
      profile.name.trim()!==profile.name||names.has(profile.name.toLowerCase())||!Array.isArray(profile.bindings)||
      profile.bindings.length>1024||typeof profile.rumbleEnabled!=='boolean'||!Array.isArray(profile.rumble)||
      profile.rumble.length!==3||!inRange(profile.rumble[0],1,5000)||
      !inRange(profile.rumble[1],0,100)||!inRange(profile.rumble[2],0,100))throw new Error('Invalid input profile.');
    ids.add(profile.id);names.add(profile.name.toLowerCase());
    return newProfile(profile.id,profile.name,profile.bindings.map(validateProfileBinding),profile.rumbleEnabled,profile.rumble);
  });
  const players=value.players.map(id=>{
    if(id!==null&&!ids.has(id))throw new Error('Unknown player profile assignment.');
    return id;
  });
  const {keyboard,gamepad}=value.shortcuts;
  if(!isRecord(keyboard)||!isRecord(gamepad))throw new Error('Invalid input shortcuts.');
  const shortcuts={keyboard:{},gamepad:{}};
  for(const id of shortcutIds){
    const code=keyboard[id],binding=gamepad[id];
    if(code!==null&&code!=='Tab'&&!isBindableKeyboardCode(code))throw new Error('Invalid shortcut key.');
    shortcuts.keyboard[id]=code;
    shortcuts.gamepad[id]=binding===null?null:validateBinding(binding);
  }
  return {profiles,players,shortcuts};
}

function padBindings(profile,device=null,deadzone=profile.deadzone) {
  return Object.entries(profile.bindings).flatMap(([action,controls])=>controls.map(input=>{
    const kind='gamepad';
    const label=device?`Gamepad · ${device.split('\u001f')[0]}`:'Gamepad';
    const axis=input.type==='axis'&&input.threshold===undefined;
    // A zero dead zone previously used a strict greater-than test.
    const binding={action,kind,device,label,input:axis?{...input,threshold:Math.max(.01,deadzone)}:input};
    if(profile.id===DEFAULT_PROFILE.id)binding.standardOnly=true;
    return binding;
  }));
}

export function migrateInputProfiles(keyboard,controllers) {
  const profiles=[],players=[null,null];
  const usedNames=new Set(['disabled']);
  const effect=controllers.stompEffect;
  const rumble=effect?[effect.duration,effect.low,effect.high]:
    controllers.stompStrength==='light'?[55,16,31]:motorDefaults;
  function append(id,base,bindings){
    let name=base.slice(0,70),index=2;
    while(usedNames.has(name.toLowerCase()))name=`${base.slice(0,70)} (${index++})`;
    usedNames.add(name.toLowerCase());
    profiles.push(newProfile(id,name,bindings,controllers.rumble,rumble));
  }
  function findProfile(id){return controllers.profiles.find(item=>item.id===id)??DEFAULT_PROFILE;}
  for(const [port,keys,routing] of [[0,keyboard,controllers],[1,keyboard.player2,controllers.player2]]){
    const keyControls=keyboardBindings(keys.bindings);
    const controls=acceptsSource(keys.mode,'keyboard')?keyControls.slice():[];
    const gamepad=acceptsSource(keys.mode,'gamepad');
    if(gamepad){
      const choice=routing.lastDevice, routes=choice
        ? [[choice,routing.assignments[choice]??routing.lastProfile]]
        : Object.entries(routing.assignments);
      if(!routes.length)routes.push([null,routing.lastProfile]);
      for(const [device,id] of routes){
        const profile=findProfile(id);
        controls.push(...padBindings(profile,device,routing.deadzone===null?profile.deadzone:routing.deadzone/100));
      }
    }
    if(keys.mode!=='none'){
      const id=`player-${port+1}`;
      const name=keys.mode==='both'?'Keyboard + Gamepad':gamepad?'Gamepad':'Keyboard';
      append(id,name,controls);players[port]=id;
    }
    if(!acceptsSource(keys.mode,'keyboard')&&keyControls.length)append(`keyboard-${port+1}`,port?'Player 2 Keyboard':'Keyboard',keyControls);
  }
  for(const [index,profile] of controllers.profiles.entries()){
    const device=profile.device?[profile.device.id,profile.device.mapping,profile.device.buttons+':'+profile.device.axes].join('\u001f'):null;
    append(`controller-${index+1}`,profile.name,padBindings(profile,device));
  }
  return validateInputProfiles({profiles,players,shortcuts:{keyboard:keyboard.assistKeys,gamepad:controllers.assistBindings}});
}

export function readInputProfiles() {
  const text=localStorage.getItem(INPUT_PROFILES_KEY);
  if(text!==null)return validateInputProfiles(JSON.parse(text));
  const keys=localStorage.getItem(KEYBOARD_STORAGE_KEY)??localStorage.getItem(LEGACY_KEYBOARD_KEY);
  const pads=localStorage.getItem(CONTROLLER_STORAGE_KEY)??localStorage.getItem(LEGACY_CONTROLLER_KEY);
  if(keys===null&&pads===null)return defaultInputProfiles();
  return migrateInputProfiles(
    keys===null?defaultKeyboardSettings():validateKeyboardSettings(JSON.parse(keys)),
    pads===null?defaultControllerSettings():validateControllerSettings(JSON.parse(pads)),
  );
}

function indexBindings(profile) {
  const keyboard=new Map(),mouse=new Map(),gamepad=[];
  for(const binding of profile?.bindings??[]){
    const {action,kind}=binding, bit=bits.get(action);
    if(kind==='gamepad'){gamepad.push({binding,bit});continue;}
    const lookup=kind==='keyboard'?keyboard:mouse, key=kind==='keyboard'?binding.code:binding.button;
    lookup.set(key,(lookup.get(key)??0)|bit);
  }
  return {profile,keyboard,mouse,gamepad};
}

// Device keys distinguish identical pads connected together, while keeping the
// same mapping when a pad is reconnected on its own.
export function createInputRouting(initial) {
  const slots=new Map();
  let input,ports,pads=[],firstPad=[null,null],routed=[[],[]];
  function apply(value) {
    input=value;
    ports=input.players.map(id=>indexBindings(input.profiles.find(item=>item.id===id)));
    route();
  }
  function route(){
    const used=new Set();
    routed=ports.map(({gamepad})=>pads.filter(({key,pad})=>
      gamepad.some(({binding})=>binding.device===key&&(!binding.standardOnly||pad.mapping==='standard'))));
    firstPad=ports.map(({gamepad},index)=>{
      const generic=gamepad.filter(({binding})=>binding.device===null);
      if(!generic.length)return null;
      const matches=item=>item.pad.mapping==='standard'||generic.some(({binding})=>!binding.standardOnly);
      const device=pads.find(item=>matches(item)&&!used.has(item.key)&&
        !routed.some(group=>group.includes(item)))??routed[index].find(matches);
      if(device)used.add(device.key);
      return device??null;
    });
  }
  function poll(values){
    const connected=Array.from(values).filter(pad=>pad&&pad.connected!==false&&pad.buttons&&pad.axes);
    const seen=new Set(connected.map(pad=>pad.index));
    let changed=connected.length!==pads.length;
    for(const index of slots.keys())if(!seen.has(index)){slots.delete(index);changed=true;}
    const next=connected.map((pad,index)=>{
      const base=[pad.id,pad.mapping||'',pad.buttons.length+':'+pad.axes.length].join('\u001f');
      let entry=slots.get(pad.index);
      if(entry?.base!==base){
        const taken=new Set(Array.from(slots.values(),item=>item.key));
        let key=base,ordinal=1;
        while(taken.has(key))key=base+'\u001f'+(++ordinal);
        entry={base,key};slots.set(pad.index,entry);changed=true;
      }
      const previous=pads[index];
      if(previous?.key===entry.key){previous.pad=pad;return previous;}
      changed=true;return {key:entry.key,pad};
    });
    pads=next;
    if(changed)route();
  }
  const sameInput=(a,b)=>a.index===b.index&&a.type===b.type&&a.direction===b.direction&&a.value===b.value;
  function gamepadInput(port){
    const {gamepad}=ports[port];
    let buttons=0;
    for(const {binding,bit} of gamepad){
      const device=binding.device===null?firstPad[port]:routed[port].find(item=>item.key===binding.device);
      if(device&&(!binding.standardOnly||device.pad.mapping==='standard')&&bindingPressed(binding.input,device.pad,.35)&&
        !Object.values(input.shortcuts.gamepad).some(used=>used&&sameInput(used,binding.input)&&bindingPressed(used,device.pad,.3)))buttons|=bit;
    }
    return {buttons,source:[...routed[port],firstPad[port]].filter(Boolean).map(({pad,key})=>key+':'+pad.index).join('|')||null};
  }
  const activePads=port=>[...new Set([...routed[port],firstPad[port]].filter(Boolean))];
  function mode(port){
    const {keyboard,mouse,gamepad}=ports[port];
    return keyboard.size?(gamepad.length?'both':'keyboard'):gamepad.length?'gamepad':mouse.size?'mouse':'none';
  }
  function keyboardStatus(port) {
    const bindings=Object.fromEntries(ACTIONS.map(({id})=>[id,[]]));
    for(const binding of ports[port].profile?.bindings??[])if(binding.kind==='keyboard')bindings[binding.action].push(binding.code);
    return {mode:mode(port),bindings};
  }
  function controllerStatus(port) {
    const devices=activePads(port),pad=devices[0]?.pad,profile=ports[port].profile;
    const bindings={start:ports[port].gamepad.filter(({binding,bit})=>bit===8&&
      (binding.device===null?firstPad[port]:routed[port].find(item=>item.key===binding.device))).map(({binding})=>binding.input)};
    return {device:pad?{id:pad.id,mapping:pad.mapping,index:pad.index,buttons:pad.buttons.length,axes:pad.axes.length}:null,
      profile:profile&&{id:profile.id,name:profile.name,bindings}};
  }
  function heldAssist(){
    const active=new Set();
    const devices=new Set([...activePads(0),...activePads(1)]);
    for(const [id,binding] of Object.entries(input.shortcuts.gamepad)){
      if(binding&&[...devices].some(({pad})=>bindingPressed(binding,pad,.3)))active.add(id);
    }
    return active;
  }
  function padsForProfile(profile){
    const assigned=input.players.flatMap((id,index)=>id===profile.id?activePads(index):[]);
    if(assigned.length)return [...new Set(assigned)].map(({pad})=>pad);
    const controls=profile.bindings.filter(binding=>binding.kind==='gamepad');
    return pads.filter(({key,pad})=>controls.some(binding=>(binding.device===key||binding.device===null)&&(!binding.standardOnly||pad.mapping==='standard'))).map(({pad})=>pad);
  }
  apply(initial);
  return {apply,poll,devices:()=>pads,mode,activePads,padsForProfile,
    key:(code,port)=>ports[port].keyboard.get(code)??0,
    mouse:(button,port)=>ports[port].mouse.get(button)??0,
    gamepadInput,keyboardStatus,controllerStatus,heldAssist,
  };
}
