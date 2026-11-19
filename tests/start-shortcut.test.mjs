import test from 'node:test';
import assert from 'node:assert/strict';
import {createStartShortcut} from '../web/start-shortcut.js';

const ready={allowed:true,paused:true,source:'pad-1'};
const idle={resume:false,suppress:false},consumed={resume:false,suppress:true};

test('controller Start resumes once and stays consumed until logical Start is released',()=>{
  const shortcut=createStartShortcut();
  assert.deepEqual(shortcut.sample(false,ready),idle);
  assert.deepEqual(shortcut.sample(true,ready),{resume:true,suppress:true});
  for(let n=0;n<10;n++)assert.deepEqual(shortcut.sample(true,{...ready,paused:false}),consumed);
  assert.deepEqual(shortcut.sample(false,{...ready,paused:false}),idle);
  assert.deepEqual(shortcut.sample(true,{...ready,paused:false}),idle);
});

test('a new keyboard keydown works immediately, while repeats cannot bypass neutral',()=>{
  const shortcut=createStartShortcut();
  assert.deepEqual(shortcut.sample(true,{...ready,source:'keyboard',freshPress:true}),{resume:true,suppress:true});
  assert.deepEqual(shortcut.sample(true,{...ready,source:'keyboard'}),consumed);
  shortcut.reset();
  assert.deepEqual(shortcut.sample(true,{...ready,source:'keyboard'}),consumed);
});

test('held Start cannot activate after menus, editors, loading or focus block the shortcut',()=>{
  const shortcut=createStartShortcut();shortcut.sample(false,ready);
  assert.deepEqual(shortcut.sample(true,{...ready,allowed:false}),consumed);
  assert.deepEqual(shortcut.sample(true,ready),consumed);
  assert.deepEqual(shortcut.sample(true,{...ready,freshPress:true}),consumed);
  shortcut.sample(false,ready);
  assert.deepEqual(shortcut.sample(true,ready),{resume:true,suppress:true});
});

test('controller connection and identity changes require a neutral sample',()=>{
  const shortcut=createStartShortcut();
  assert.deepEqual(shortcut.sample(true,ready),consumed);
  shortcut.sample(false,ready);
  assert.deepEqual(shortcut.sample(true,{...ready,source:'pad-2'}),consumed);
  shortcut.sample(false,{...ready,source:'pad-2'});
  assert.deepEqual(shortcut.sample(true,{...ready,source:'pad-2'}),{resume:true,suppress:true});
});

test('a held running Start does not resume after a pause/reset transition',()=>{
  const shortcut=createStartShortcut();shortcut.sample(false,{...ready,paused:false});
  assert.deepEqual(shortcut.sample(true,{...ready,paused:false}),idle);
  shortcut.reset();
  assert.deepEqual(shortcut.sample(true,ready),consumed);
  shortcut.sample(false,ready);
  assert.deepEqual(shortcut.sample(true,ready),{resume:true,suppress:true});
});
