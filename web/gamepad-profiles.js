// Pure controller mapping and profile serialization; no DOM or storage access.
export const PROFILE_SCHEMA = 'dkc.controller-profile';
export const PROFILE_VERSION = 1;
export const MAX_PROFILE_BYTES = 65536;
export const ACTIONS = Object.freeze([
  ['b','B / Jump',1], ['y','Y / Run, roll',2], ['select','Select',4],
  ['start','Start',8], ['up','Up',16], ['down','Down',32],
  ['left','Left',64], ['right','Right',128], ['a','A',256],
  ['x','X',512], ['l','L',1024], ['r','R',2048],
].map(([id,label,bit]) => Object.freeze({id,label,bit})));
const actionIds = new Set(ACTIONS.map(action => action.id));
const directions = ['up','right','down','left'];
const own = (object,key) => Object.prototype.hasOwnProperty.call(object,key);
const record = value => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && [Object.prototype,null].includes(Object.getPrototypeOf(value));

function keys(object, allowed, label) {
  if (!record(object)) throw new Error(`${label} must be an object.`);
  for (const key of Object.keys(object))
    if (!allowed.includes(key)) throw new Error(`Unknown ${label} field: ${key}.`);
}
function finite(value, min, max, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw new Error(`${label} must be a finite number from ${min} to ${max}.`);
  return value;
}
function integer(value, min, max, label) {
  finite(value,min,max,label);
  if (!Number.isInteger(value)) throw new Error(`${label} must be an integer.`);
  return value;
}
function text(value, max, label, empty=false) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()))
    throw new Error(`${label} must be ${empty?'at most':'1 to'} ${max} characters.`);
  return empty ? value : value.trim();
}
function deviceDescriptor(value) {
  if (value === null || value === undefined) return null;
  keys(value,['id','mapping','buttons','axes'],'device');
  return {id:text(value.id,512,'Device ID',true),
    mapping:text(value.mapping,80,'Device mapping',true),
    buttons:integer(value.buttons,0,256,'Device button count'),
    axes:integer(value.axes,0,64,'Device axis count')};
}
export function validateBinding(value) {
  if (!record(value)) throw new Error('A binding must be an object.');
  let result;
  switch (value.type) {
    case 'button':
      keys(value,['type','index','threshold'],'button binding');
      result={type:'button',index:integer(value.index,0,255,'Button index')};
      if (own(value,'threshold')) result.threshold=finite(value.threshold,0.01,1,'Button threshold');
      return result;
    case 'axis':
      keys(value,['type','index','direction','rest','threshold'],'axis binding');
      result={type:'axis',index:integer(value.index,0,63,'Axis index'),
        direction:integer(value.direction,-1,1,'Axis direction')};
      if (result.direction===0) throw new Error('Axis direction must be -1 or 1.');
      if (own(value,'rest')) result.rest=finite(value.rest,-1,1,'Axis rest');
      if (own(value,'threshold')) result.threshold=finite(value.threshold,0.01,2,'Axis threshold');
      return result;
    case 'axis-value':
      keys(value,['type','index','value','tolerance'],'axis-value binding');
      result={type:'axis-value',index:integer(value.index,0,63,'Axis index'),
        value:finite(value.value,-4,4,'Axis value')};
      if (own(value,'tolerance')) result.tolerance=finite(value.tolerance,0.001,0.5,'Axis tolerance');
      return result;
    case 'hat':
      keys(value,['type','index','direction'],'hat binding');
      if (!directions.includes(value.direction)) throw new Error('Hat direction must be up, right, down, or left.');
      return {type:'hat',index:integer(value.index,0,63,'Hat axis index'),direction:value.direction};
    default: throw new Error('Unknown controller binding type.');
  }
}

export function validateProfile(value) {
  keys(value,['schema','version','id','name','device','deadzone','bindings'],'profile');
  if (value.schema !== PROFILE_SCHEMA || value.version !== PROFILE_VERSION)
    throw new Error('Unsupported controller profile format or version.');
  const id=text(value.id,100,'Profile ID');
  if (id==='standard') throw new Error('The built-in Standard profile cannot be overwritten or imported.');
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Profile ID contains unsupported characters.');
  const name=text(value.name,80,'Profile name');
  const deadzone=finite(value.deadzone,0.01,0.95,'Deadzone');
  keys(value.bindings,[...actionIds],'bindings');
  const bindings={};
  for (const action of ACTIONS) {
    const list=own(value.bindings,action.id)?value.bindings[action.id]:[];
    if (!Array.isArray(list) || list.length>16) throw new Error(`Use at most 16 bindings for ${action.label}.`);
    bindings[action.id]=list.map(validateBinding);
  }
  return {schema:PROFILE_SCHEMA,version:PROFILE_VERSION,id,name,
    device:deviceDescriptor(value.device),deadzone,bindings};
}

function deepFreeze(value) {
  for (const child of Object.values(value)) if (child && typeof child==='object') deepFreeze(child);
  return Object.freeze(value);
}
const button = index => ({type:'button',index});
const axis = (index,direction) => ({type:'axis',index,direction});
export const DEFAULT_PROFILE = deepFreeze({
  schema:PROFILE_SCHEMA,version:PROFILE_VERSION,id:'standard',name:'Standard controller (default)',
  device:null,deadzone:0.35,
  bindings:{b:[button(0)],y:[button(2)],select:[button(8)],start:[button(9)],
    up:[button(12),axis(1,-1)],down:[button(13),axis(1,1)],
    left:[button(14),axis(0,-1)],right:[button(15),axis(0,1)],
    a:[button(1)],x:[button(3)],l:[button(4)],r:[button(5)]},
});

export function createProfile(name,device=null,base=null) {
  const descriptor=device ? {id:device.id??'',mapping:device.mapping??'',
    buttons:typeof device.buttons==='number'?device.buttons:(device.buttons?.length??0),
    axes:typeof device.axes==='number'?device.axes:(device.axes?.length??0)} : null;
  return validateProfile({schema:PROFILE_SCHEMA,version:PROFILE_VERSION,
    id:globalThis.crypto.randomUUID(),name,device:descriptor,
    deadzone:base?.deadzone??0.35,
    bindings:base?.bindings??Object.fromEntries(ACTIONS.map(action=>[action.id,[]]))});
}
export function parseProfile(json) {
  if (typeof json!=='string' || new TextEncoder().encode(json).byteLength>MAX_PROFILE_BYTES)
    throw new Error('Controller profile must be a JSON file no larger than 64 KiB.');
  let value;
  try { value=JSON.parse(json); } catch { throw new Error('Controller profile is not valid JSON.'); }
  return validateProfile(value);
}
export function serializeProfile(profile) {
  const output=profile===DEFAULT_PROFILE?createProfile(profile.name,null,profile):validateProfile(profile);
  return JSON.stringify(output,null,2)+'\n';
}

function buttonValue(value) {
  if (typeof value==='number') return Number.isFinite(value)?Math.max(0,Math.min(1,value)):0;
  return value && Number.isFinite(value.value)?Math.max(0,Math.min(1,value.value)):(value?.pressed?1:0);
}
export function bindingPressed(binding,pad,deadzone) {
  if (binding.type==='button') {
    const input=pad.buttons?.[binding.index];
    return (binding.threshold===undefined && input?.pressed===true) ||
      buttonValue(input)>=(binding.threshold??0.5);
  }
  const value=pad.axes?.[binding.index];
  if (!Number.isFinite(value)) return false;
  if (binding.type==='axis') {
    if (value < -1 || value > 1) return false;
    return (value-(binding.rest??0))*binding.direction>(binding.threshold??deadzone);
  }
  if (binding.type==='axis-value') return Math.abs(value-binding.value)<=(binding.tolerance??0.08);
  if (binding.type==='hat') {
    if (value < -1 || value > 1) return false;
    const sector=Math.round((value+1)*3.5);
    if (Math.abs(value-(-1+sector*2/7))>0.08) return false;
    const center=directions.indexOf(binding.direction)*2;
    return [center,(center+1)%8,(center+7)%8].includes(sector);
  }
  return false;
}
export function evaluateProfile(profile,pad,deadzone=profile?.deadzone,consumed=[]) {
  if (!pad || pad.connected===false || !profile) return 0;
  if (profile.id==='standard' && pad.mapping!=='standard') return 0;
  let mask=0;
  for (const {id,bit} of ACTIONS)
    if (profile.bindings[id]?.some(binding=>!consumed.some(used=>used.type===binding.type&&used.index===binding.index&&used.direction===binding.direction&&used.value===binding.value)&&bindingPressed(binding,pad,deadzone))) mask|=bit;
  return mask;
}
export function bindingLabel(binding) {
  if (binding.type==='button') return `B${binding.index}`;
  if (binding.type==='axis') return `Axis ${binding.index} ${binding.direction<0?'−':'+'}${binding.rest?` (rest ${binding.rest.toFixed(2)})`:''}`;
  if (binding.type==='axis-value') return `Axis ${binding.index} ≈ ${binding.value.toFixed(3)}`;
  if (binding.type==='hat') return `Hat axis ${binding.index} ${binding.direction}`;
  return 'Unmapped';
}

// Capture only changes from a neutral snapshot. A held trigger/hat at rest
// must not win capture merely because its absolute value is nonzero.
export function detectBinding(previous,current,{deadzone=0.35,mode='auto',hatDirection='up'}={}) {
  if (!previous || !current || current.connected===false) return null;
  if (mode==='auto' || mode==='button') {
    for (let index=0;index<(current.buttons?.length??0);index++)
      if (buttonValue(current.buttons[index])>=0.5 && buttonValue(previous.buttons?.[index])<0.5)
        return {type:'button',index};
    if (mode==='button') return null;
  }
  let changed=null;
  for (let index=0;index<(current.axes?.length??0);index++) {
    const value=current.axes[index], rest=previous.axes?.[index];
    if (!Number.isFinite(value) || !Number.isFinite(rest) || Math.abs(value-rest)<Math.max(deadzone,0.2)) continue;
    if (!changed || Math.abs(value-rest)>changed.delta) changed={index,value,rest,delta:Math.abs(value-rest)};
  }
  if (!changed) return null;
  const {index,value,rest}=changed;
  if (mode==='hat') return directions.includes(hatDirection)?{type:'hat',index,direction:hatDirection}:null;
  if (mode==='axis-value' || value < -1 || value > 1 || rest < -1 || rest > 1)
    return value>=-4&&value<=4?{type:'axis-value',index,value,tolerance:0.08}:null;
  return {type:'axis',index,direction:value>rest?1:-1,rest,
    threshold:Math.min(deadzone,Math.abs(value-rest)*0.6)};
}

export const CONTROLLER_STORAGE_KEY='dkc.controller-settings.v2';
export const LEGACY_CONTROLLER_KEY='dkc.controller-settings.v1';
export const ASSIST_ACTIONS=Object.freeze({
  'quick-save':'Quick Save', 'quick-load':'Quick Load',
});
export const CAPTURE_MODES=['auto','button','axis','axis-value','hat'];
export const acceptsSource=(mode,source)=>mode===source||mode==='both';

function defaultRoute(){
  return {assignments:{},lastDevice:null,lastProfile:DEFAULT_PROFILE.id,deadzone:null};
}
export function defaultControllerSettings(){
  return {...defaultRoute(),profiles:[],player2:defaultRoute(),captureMode:'auto',rumble:true,stompStrength:'standard',stompEffect:null,
    assistBindings:{'quick-save':null,'quick-load':null}};
}
function validateRoute(route,available){
  const {assignments,lastDevice,lastProfile='standard',deadzone=null}=route;
  if(!record(assignments)||Object.keys(assignments).length>1024)throw new Error('Invalid controller assignments.');
  const valid=Object.entries(assignments).map(([device,id])=>{
    if(!device.length||device.length>2047||!available.has(id))throw new Error('Unknown controller or profile assignment.');
    return [device,id];
  });
  if(lastDevice!==null&&(typeof lastDevice!=='string'||!lastDevice.length||lastDevice.length>2047))throw new Error('Invalid selected controller.');
  if(!available.has(lastProfile))throw new Error('Unknown selected controller profile.');
  return {assignments:Object.fromEntries(valid),lastDevice,lastProfile,deadzone:deadzone===null?null:integer(deadzone,0,100,'Player stick dead zone')};
}
export function validateControllerSettings(value){
  const routeKeys=['assignments','lastDevice','lastProfile','deadzone'];
  keys(value,[...routeKeys,'profiles','player2','captureMode','rumble','stompStrength','stompEffect','assistBindings'],'controller settings');
  if(!Array.isArray(value.profiles)||value.profiles.length>64)throw new Error('Use up to 64 custom controller profiles.');
  const profiles=value.profiles.map(validateProfile),available=new Set(['standard',...profiles.map(p=>p.id)]);
  if(available.size!==profiles.length+1)throw new Error('Duplicate controller profile ID.');
  const defaults=defaultControllerSettings();
  const {player2=defaults.player2,captureMode=defaults.captureMode,rumble=defaults.rumble,
    stompStrength=defaults.stompStrength,stompEffect=null,assistBindings=defaults.assistBindings}=value;
  keys(player2,routeKeys,'player 2 controller');
  if(!CAPTURE_MODES.includes(captureMode)||typeof rumble!=='boolean')throw new Error('Invalid capture mode or rumble setting.');
  if(!['standard','light'].includes(stompStrength))throw new Error('Invalid stomp strength.');
  keys(assistBindings,[...Object.keys(ASSIST_ACTIONS),'rewind-step','fast-forward','frame-step'],'controller shortcuts');
  const validated=Object.fromEntries(Object.keys(ASSIST_ACTIONS).map(id=>[id,assistBindings[id]===null?null:validateBinding(assistBindings[id])]));
  let effect=null;
  if(stompEffect!==null){
    keys(stompEffect,['duration','low','high'],'stomp effect');
    effect={
      duration:integer(stompEffect.duration,1,1000,'Rumble duration'),
      low:integer(stompEffect.low,0,100,'Low motor'),
      high:integer(stompEffect.high,0,100,'High motor'),
    };
  }
  const result={...validateRoute(value,available),profiles,player2:validateRoute(player2,available),captureMode,rumble,stompStrength,stompEffect:effect,assistBindings:validated};
  if(JSON.stringify(result).length>1048576)throw new Error('Controller settings exceed the 1 MiB storage limit.');
  return result;
}
