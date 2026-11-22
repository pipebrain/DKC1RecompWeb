// Config files carry preferences. The ROM, SRAM and save states live separately.
import {readConfigJournal,writeConfigJournal,setRememberRom} from './storage.js';
import {validateKeyboardSettings,KEYBOARD_STORAGE_KEY,LEGACY_KEYBOARD_KEY} from './keyboard-profiles.js';
import {validateControllerSettings,CONTROLLER_STORAGE_KEY,LEGACY_CONTROLLER_KEY} from './gamepad-profiles.js';

export const PLAYER_KEY = 'dkc.player-settings.v2';
const LEGACY_PLAYER_KEY = 'dkc.player-settings.v1';
export const CONFIG_LIMIT = 16 * 1024 * 1024;
const OPTIONS = {
  sound: [true,false], volume: {default:100,min:0,max:100,step:1},
  audioDriftCorrection: [true,false], audioPreroll:[2,1,3,4],
  pauseWhenInactive: [true,false], appearance: ['system','light','dark'],
  fullscreenOnStart: [false,true], stateSlot: [1,2,3,4,5],
};

// Phase 2 exports and older browser records can contain these retired settings.
const retired=new Set([
  'diagnostics','speed','assist','variant','music','musicGain','hdTextures','hdPolish','hdFinish',
  'aspect','pixelAspect','windowScale','edge','aquaticFixes','frameGeneration','layer','provenance',
  'screenColor','display','upscaler','reconstruction','strength','softness','shading','crtPreset',
  'scanlines','sharpness','mask','maskStrength','glow','halation','curvature',
]);

export const PLAYER_DEFAULTS = Object.freeze(Object.fromEntries(
  Object.entries(OPTIONS).map(([key,rule])=>[key,Array.isArray(rule)?rule[0]:rule.default])
));

function checkObject(value, keys, name, ignored) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid '+name+'.');
  for (const key of Object.keys(value)) {
    if (!Object.hasOwn(keys,key) && !ignored?.has(key)) throw new Error('Unknown '+name+' field: '+key);
  }
}

export function validatePlayer(value, {legacy=false,fillDefaults=false}={}) {
  checkObject(value,OPTIONS,'player settings',legacy?retired:undefined);
  const result={};
  for (const [key,rule] of Object.entries(OPTIONS)) {
    const setting = fillDefaults && !Object.hasOwn(value,key) ? PLAYER_DEFAULTS[key] : value[key];
    const valid = Array.isArray(rule) ? rule.includes(setting) :
      Number.isFinite(setting) && setting>=rule.min && setting<=rule.max &&
      (!rule.step || Math.abs((setting-rule.min)/rule.step-Math.round((setting-rule.min)/rule.step))<1e-6);
    if (!valid) throw new Error('Invalid player setting: '+key);
    result[key]=setting;
  }
  return result;
}

export function readPlayer() {
  const raw=localStorage.getItem(PLAYER_KEY);
  if(raw!==null)return validatePlayer(JSON.parse(raw),{fillDefaults:true});
  const previous=localStorage.getItem(LEGACY_PLAYER_KEY);
  return previous===null ? {...PLAYER_DEFAULTS} : validatePlayer(JSON.parse(previous),{legacy:true,fillDefaults:true});
}

export function makeConfig(player, keyboard, controllers, rememberRom) {
  if (typeof rememberRom!=='boolean') throw new Error('Invalid remembered-ROM preference.');
  return {schema:'dkc.player-config',version:2,player:validatePlayer(player),
    keyboard:validateKeyboardSettings(keyboard),controllers:validateControllerSettings(controllers),rememberRom};
}

export function parseConfig(text) {
  if (text.length>CONFIG_LIMIT) throw new Error('Configuration file is too large.');
  let value;
  try {value=JSON.parse(text);} catch {throw new Error('Choose a valid JSON configuration file.');}
  checkObject(value,{schema:1,version:1,player:1,keyboard:1,controllers:1,rememberRom:1},'configuration');
  if (value.schema!=='dkc.player-config' || ![1,2].includes(value.version)) throw new Error('Unsupported player configuration format.');
  const player=validatePlayer(value.player,{legacy:value.version===1});
  return makeConfig(player,value.keyboard,value.controllers,value.rememberRom);
}

// Existing editors keep their own preference keys. Journal the previous values
// in the ROM database before updating them, so closing the tab midway through
// Load Config can be recovered when the app next opens.
async function rollbackImport(){
  const entries=await readConfigJournal();
  if(!entries)return;
  for(const {key,before,after} of entries){
    if(![PLAYER_KEY,KEYBOARD_STORAGE_KEY,CONTROLLER_STORAGE_KEY,LEGACY_PLAYER_KEY,LEGACY_KEYBOARD_KEY,LEGACY_CONTROLLER_KEY].includes(key))throw new Error('Invalid configuration journal.');
    if(localStorage.getItem(key)!==after)continue;
    if(before===null)localStorage.removeItem(key);else localStorage.setItem(key,before);
  }
  await writeConfigJournal(null);
}
const exclusive=action=>navigator.locks.request('dkc-config-import',action);
export function recoverConfig(){return exclusive(rollbackImport);}
export function storeConfig(config,image){
  return exclusive(async()=>{
    await rollbackImport();
    const entries=[[PLAYER_KEY,config.player],[KEYBOARD_STORAGE_KEY,config.keyboard],[CONTROLLER_STORAGE_KEY,config.controllers]]
      .map(([key,value])=>({key,before:localStorage.getItem(key),after:JSON.stringify(value)}))
      .filter(entry=>entry.before!==entry.after);
    await writeConfigJournal(entries);
    try{
      for(const {key,after} of entries)localStorage.setItem(key,after);
      await setRememberRom(config.rememberRom,image,true);
    }catch(error){
      await rollbackImport();
      throw error;
    }
  });
}
