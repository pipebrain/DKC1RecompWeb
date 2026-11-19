import assert from 'node:assert/strict';
import test from 'node:test';
import {DEFAULT_KEYBOARD_BINDINGS,KEYBOARD_SCHEMA,KEYBOARD_VERSION,MAX_KEYBOARD_BYTES,
  defaultKeyboardSettings,isBindableKeyboardCode,isDefaultKeyboardBindings,
  keyboardCodeLabel,keyboardEventCode,keyboardKeyMap,parseKeyboardSettings,
  validateKeyboardBindings,validateKeyboardSettings} from '../web/keyboard-profiles.js';

test('fresh keyboard settings are the default input and preserve every original key mask',()=>{
  const settings=defaultKeyboardSettings();
  assert.equal(settings.mode,'keyboard');
  assert(isDefaultKeyboardBindings(settings.bindings));
  assert.deepEqual(keyboardKeyMap(settings.bindings),{
    KeyZ:1,KeyX:2,ShiftLeft:4,ShiftRight:4,Enter:8,ArrowUp:16,ArrowDown:32,
    ArrowLeft:64,ArrowRight:128,KeyA:256,KeyS:512,KeyQ:1024,KeyW:2048,
  });
  assert(Object.isFrozen(DEFAULT_KEYBOARD_BINDINGS));
  assert(Object.isFrozen(DEFAULT_KEYBOARD_BINDINGS.select));
});

test('a remapped action replaces its old key, round-trips with input mode, and leaves defaults unchanged',()=>{
  const settings=defaultKeyboardSettings();settings.mode='gamepad';settings.bindings.b=['KeyC'];
  const saved=parseKeyboardSettings(JSON.stringify(settings));
  assert.equal(saved.mode,'gamepad');
  assert.equal(keyboardKeyMap(saved.bindings).KeyC,1);
  assert.equal(keyboardKeyMap(saved.bindings).KeyZ,undefined);
  assert.equal(isDefaultKeyboardBindings(saved.bindings),false);
  assert.deepEqual(DEFAULT_KEYBOARD_BINDINGS.b,['KeyZ']);
});

test('unassigned actions and same-action alternatives are allowed, but conflicting assignments are rejected',()=>{
  const settings=defaultKeyboardSettings();settings.bindings.b=[];
  settings.bindings.y=['KeyX','KeyC'];
  const map=keyboardKeyMap(settings.bindings);
  assert.equal(map.KeyZ,undefined);assert.equal(map.KeyC,2);assert.equal(map.KeyX,2);
  settings.bindings.b=['KeyC'];assert.throws(()=>validateKeyboardBindings(settings.bindings),/already assigned/);
  settings.bindings.b=[];settings.bindings.y=['KeyX','KeyX'];
  assert.throws(()=>validateKeyboardBindings(settings.bindings),/Duplicate key/);
});

test('reserved app/navigation shortcuts cannot replace game bindings while physical Shift remains bindable',()=>{
  for(const code of ['Tab','Escape','MetaLeft','MetaRight','ControlLeft','ControlRight','AltLeft','AltRight']){
    assert.equal(isBindableKeyboardCode(code),false,code);
    const settings=defaultKeyboardSettings();settings.bindings.b=[code];
    assert.throws(()=>validateKeyboardBindings(settings.bindings),/reserved/);
  }
  assert.equal(isBindableKeyboardCode('ShiftLeft'),true);
  assert.equal(isBindableKeyboardCode('ShiftRight'),true);
  assert.equal(isBindableKeyboardCode('Enter'),true);
  assert.equal(isBindableKeyboardCode('Numpad7'),true);
  assert.equal(isBindableKeyboardCode('F24'),true);
  assert.equal(isBindableKeyboardCode('F25'),false);
});

test('keyboard capture ignores command/control/alt chords and composition without suppressing Shift game combinations',()=>{
  assert.equal(keyboardEventCode({code:'KeyZ',shiftKey:true}), 'KeyZ');
  assert.equal(keyboardEventCode({code:'ShiftRight',shiftKey:true}), 'ShiftRight');
  for(const modifier of ['metaKey','ctrlKey','altKey','isComposing'])assert.equal(keyboardEventCode({code:'KeyZ',[modifier]:true}),null);
  assert.equal(keyboardEventCode({code:'Space'}),'Space');
  assert.equal(keyboardEventCode({code:'Unknown'}),null);
});

test('Space can replace a game action while default bindings remain unchanged',()=>{
  const settings=defaultKeyboardSettings();settings.bindings.b=['Space'];
  const saved=parseKeyboardSettings(JSON.stringify(settings));
  assert.equal(keyboardKeyMap(saved.bindings).Space,1);
  assert.equal(keyboardKeyMap(saved.bindings).KeyZ,undefined);
  assert.equal(keyboardCodeLabel('Space'),'Space');
  assert.equal(keyboardKeyMap(DEFAULT_KEYBOARD_BINDINGS).Space,undefined);
});

test('malformed storage is bounded, schema checked, and cannot add arbitrary action/settings properties',()=>{
  assert.throws(()=>parseKeyboardSettings('{'),/valid JSON/);
  assert.throws(()=>parseKeyboardSettings(' '.repeat(MAX_KEYBOARD_BYTES+1)),/too large/);
  assert.throws(()=>validateKeyboardSettings({...defaultKeyboardSettings(),version:KEYBOARD_VERSION+1}),/Unsupported/);
  assert.throws(()=>validateKeyboardSettings({...defaultKeyboardSettings(),schema:'another-app'}),/Unsupported/);
  assert.throws(()=>validateKeyboardSettings({...defaultKeyboardSettings(),mode:'both'}),/Keyboard or Gamepad/);
  assert.throws(()=>validateKeyboardSettings({...defaultKeyboardSettings(),extra:true}),/Unknown/);
  const settings=defaultKeyboardSettings();delete settings.bindings.r;
  assert.throws(()=>validateKeyboardSettings(settings),/zero to four/);
  const invalid=defaultKeyboardSettings();invalid.bindings.b=['KeyC','KeyD','KeyE','KeyF','KeyG'];
  assert.throws(()=>validateKeyboardSettings(invalid),/zero to four/);
  const poisoned=JSON.parse(JSON.stringify(defaultKeyboardSettings()).replace('"bindings":{','"bindings":{"__proto__":[], '));
  assert.throws(()=>validateKeyboardSettings(poisoned),/Unknown keyboard action/);
  assert.equal(KEYBOARD_SCHEMA,'dkc.keyboard-settings');
});

test('labels expose familiar key names and default comparisons accept reordered alternatives',()=>{
  assert.equal(keyboardCodeLabel('KeyZ'),'Z');assert.equal(keyboardCodeLabel('ArrowUp'),'↑');
  assert.equal(keyboardCodeLabel('ShiftLeft'),'Left Shift');assert.equal(keyboardCodeLabel('Enter'),'Return');
  const bindings=defaultKeyboardSettings().bindings;bindings.select.reverse();
  assert(isDefaultKeyboardBindings(bindings));
});
