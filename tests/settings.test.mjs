import assert from 'node:assert/strict';
import test from 'node:test';
import {defaultKeyboardSettings} from '../web/keyboard-profiles.js';
import {defaultControllerSettings} from '../web/gamepad-profiles.js';
import {defaultInputProfiles} from '../web/input-profiles.js';
import {makeConfig, makeProfileConfig, parseConfig, PLAYER_DEFAULTS, PLAYER_KEY, readPlayer} from '../web/settings.js';

function phase2Config() {
  const keyboard = defaultKeyboardSettings();
  keyboard.version = 1;
  keyboard.mode = 'both';
  keyboard.player2.mode = 'keyboard';
  keyboard.player2.bindings.start = ['NumpadEnter'];
  keyboard.assistKeys = {
    'quick-save': 'Tab', 'quick-load': 'F7', 'frame-step': null,
    'rewind-step': 'Backspace', 'fast-forward': 'F8',
  };
  const controllers = defaultControllerSettings();
  delete controllers.stompStrength;
  controllers.player2.lastDevice = 'test-pad-2';
  controllers.rumble = false;
  controllers.assistBindings['quick-save'] = {type:'button',index:6,threshold:0.5};
  controllers.assistBindings['rewind-step'] = {type:'button',index:7,threshold:0.5};
  const retained=['sound','volume','audioDriftCorrection','audioPreroll','pauseWhenInactive','appearance','fullscreenOnStart','stateSlot'];
  const player=Object.fromEntries(retained.map(key=>[key,PLAYER_DEFAULTS[key]]));
  player.appearance='system';
  return {
    schema: 'dkc.player-config', version: 1, rememberRom: false, controllers, keyboard,
    player: {
      ...player, stateSlot: 5, volume: 61, sound: false, audioPreroll: 3,
      variant: 'dixie', speed: 3, assist: true, music: 'msu1', aspect: '16:9',
      hdTextures: true, display: 'crt', frameGeneration: 'poses',
    },
  };
}

test('Phase 2 portable preferences retain both players, state shortcuts and stock settings', () => {
  const legacy = phase2Config();
  const clean = parseConfig(JSON.stringify(legacy));
  assert.equal(clean.version, 3);
  assert.deepEqual(clean.player, {...PLAYER_DEFAULTS, appearance:'system', stateSlot:5, volume:61, sound:false, audioPreroll:3});
  assert.equal(clean.rememberRom, false);
  assert.equal(clean.keyboard.mode, 'both');
  assert.deepEqual(clean.keyboard.player2, legacy.keyboard.player2);
  assert.deepEqual(clean.keyboard.assistKeys, {'quick-save':'Tab', 'quick-load':'F7'});
  assert.equal(clean.controllers.rumble, false);
  assert.equal(clean.controllers.stompStrength, 'standard');
  assert.equal(clean.controllers.player2.lastDevice, 'test-pad-2');
  assert.deepEqual(clean.controllers.assistBindings, {
    'quick-save':legacy.controllers.assistBindings['quick-save'], 'quick-load':null,
  });
  const exported = makeConfig(clean.player, clean.keyboard, clean.controllers, clean.rememberRom);
  assert.deepEqual(parseConfig(JSON.stringify(exported)), clean);
});

test('malformed files cannot silently discard a retained preference', () => {
  const legacy = phase2Config();
  delete legacy.player.stateSlot;
  assert.throws(() => parseConfig(JSON.stringify(legacy)), /stateSlot/);
  const clean = parseConfig(JSON.stringify(phase2Config()));
  clean.player.speed = 2;
  assert.throws(() => parseConfig(JSON.stringify(clean)), /Unknown player settings field/);
  const withTypo = phase2Config();
  withTypo.player.volum = 100;
  assert.throws(() => parseConfig(JSON.stringify(withTypo)), /Unknown player settings field/);
  const badStrength = phase2Config();
  badStrength.controllers.stompStrength = 'invalid';
  assert.throws(() => parseConfig(JSON.stringify(badStrength)));
});

test('existing browser preferences carry forward until the first clean edit', t => {
  const records = new Map();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable:true, get:() => ({getItem:key => records.get(key) ?? null}),
  });
  assert.deepEqual(readPlayer(), PLAYER_DEFAULTS);
  const oldKey = 'dkc.player-settings.v1';
  const original = JSON.stringify({speed:2, sound:false, stateSlot:4});
  records.set(oldKey, original);
  assert.deepEqual(readPlayer(), {...PLAYER_DEFAULTS, sound:false, stateSlot:4});
  records.set(PLAYER_KEY, JSON.stringify({...PLAYER_DEFAULTS, stateSlot:2}));
  assert.deepEqual(readPlayer(), {...PLAYER_DEFAULTS, stateSlot:2});
  assert.equal(records.get(oldKey), original);
});

test('notifications default on in older exports and preserve an explicit off setting', () => {
  const config=makeProfileConfig(PLAYER_DEFAULTS,defaultInputProfiles(),true);
  delete config.player.notificationsEnabled;
  assert.equal(parseConfig(JSON.stringify(config)).player.notificationsEnabled,true);
  config.player.notificationsEnabled=false;
  assert.equal(parseConfig(JSON.stringify(config)).player.notificationsEnabled,false);
});
