import test from 'node:test';
import assert from 'node:assert/strict';
import {pausePresentation} from '../web/pause-presentation.js';
import {DEFAULT_PROFILE} from '../web/gamepad-profiles.js';

const ready={loaded:true,running:false,hasStarted:false,inputMode:'keyboard'};
const keyboard={bindings:{start:['Enter']}};
const controller={device:{mapping:'standard',buttons:17,axes:4},profile:DEFAULT_PROFILE};

test('overlay is absent for unloaded, loading and running games',()=>{
  for(const state of [{loaded:false},{...ready,loading:true},{...ready,running:true}])assert.deepEqual(pausePresentation(state),{visible:false});
});
test('started state distinguishes fresh boot and pause even at frame zero',()=>{
  assert.equal(pausePresentation({...ready,frameCount:0},{keyboard}).title,'Ready to Start');
  const value=pausePresentation({...ready,hasStarted:true,frameCount:0},{keyboard});
  assert.equal(value.title,'Paused');assert.match(value.input,/Keyboard.*Return/);assert.match(value.hint,/Return to resume/);
});
test('keyboard hints use saved alternatives or the valid Space fallback',()=>{
  const custom=pausePresentation(ready,{keyboard:{bindings:{start:['KeyP','Space']}}});
  assert.match(custom.input,/P or Space/);assert.match(custom.hint,/P or Space to start/);
  assert.match(pausePresentation(ready,{keyboard:{bindings:{start:[]}}}).hint,/Space to start/);
});
test('controller hints show the current logical Start binding',()=>{
  const state={...ready,inputMode:'gamepad',hasStarted:true};
  assert.match(pausePresentation(state,{controller}).hint,/Start \(B9\) to resume/);
  const raw={...controller,device:{mapping:'',buttons:12,axes:6},profile:{id:'custom',name:'SN30 Pro+',bindings:{start:[{type:'button',index:11}]}}};
  const value=pausePresentation(state,{controller:raw});assert.match(value.input,/SN30 Pro\+/);assert.match(value.hint,/B11/);
});
test('disconnected, incompatible and out-of-range mappings offer a working fallback',()=>{
  const state={...ready,inputMode:'gamepad'};
  assert.match(pausePresentation(state).input,/Disconnected/);assert.match(pausePresentation(state).hint,/Space to start/);
  const raw={...controller,device:{mapping:'',buttons:17,axes:4}};
  assert.doesNotMatch(pausePresentation(state,{controller:raw}).hint,/B9/);
  const missing={...controller,device:{mapping:'standard',buttons:9,axes:4}};
  assert.match(pausePresentation(state,{controller:missing}).hint,/No usable Start binding/);
  assert.match(pausePresentation(state,{controller:raw,fullscreen:true}).hint,/Escape to configure Input/);
});
test('hints describe focus, menu and dialog prerequisites',()=>{
  const value=pausePresentation(ready,{keyboard,foreground:false,focused:false,menuOpen:true});
  assert.match(value.hint,/Return to this page.*close the menu.*focus the game screen.*Return to start/);
  assert.match(pausePresentation(ready,{keyboard,dialogOpen:true}).hint,/Close the dialog/);
});
test('pending audio and fatal errors do not falsely promise immediate resume',()=>{
  assert.equal(pausePresentation({...ready,resuming:true},{keyboard}).title,'Starting…');
  assert.equal(pausePresentation({...ready,hasStarted:true,resuming:true},{keyboard}).title,'Resuming…');
  const value=pausePresentation({...ready,playbackError:true,pausedReason:'settings'},{keyboard,fullscreen:true});
  assert.equal(value.title,'Game stopped');assert.match(value.hint,/Escape.*reload this browser page/);
});
