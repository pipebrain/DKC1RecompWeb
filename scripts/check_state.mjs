// Check restored console state, last displayed frame and the next second of PCM.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {captureState,restoreState} from '../web/assist.js';
import {importsFor} from '../web/wasm-imports.js';

const [romPath,flag,phase2Dir]=process.argv.slice(2);
if(!romPath || (flag!==undefined && (flag!=='--phase2-package' || !phase2Dir)))
  throw new Error('Usage: node scripts/check_state.mjs ROM [--phase2-package DIRECTORY]');
const rom=await readFile(romPath);
const runs=(await readFile(new URL('../tests/fixtures/jungle-route.inputs',import.meta.url),'utf8'))
  .split(/\r?\n/).map(line=>line.replace(/(?:#|\/\/).*/,'').trim()).filter(Boolean)
  .flatMap(line=>{
    const [buttons,count]=line.split('*');
    return Array(Number(count||1)).fill(parseInt(buttons,16));
  });

async function initialize(file,loader){
  const module=await WebAssembly.compile(await readFile(file));
  let instance;
  instance=await WebAssembly.instantiate(module,loader(module,()=>instance).imports);
  const core=instance.exports;
  core._initialize();
  const ptr=core.dkc_alloc(rom.length);
  new Uint8Array(core.memory.buffer).set(rom,ptr);
  assert.equal(core.dkc_init(ptr,rom.length),0);
  core.dkc_free(ptr);
  return core;
}

function fingerprints(core){
  const pointer=core.dkc_debug_fingerprints();
  const raw=new Uint8Array(core.memory.buffer,pointer);
  return JSON.parse(new TextDecoder().decode(raw.subarray(0,raw.indexOf(0))));
}

function advance(core,from,to){
  for(let frame=from;frame<to;frame++){
    assert.equal(core.dkc_step(runs[frame]||0),0);
    core.dkc_debug_hash_audio();
  }
}

const clean=await initialize(new URL('../web/dkc.wasm',import.meta.url),importsFor);
assert.equal(clean.dkc_width(),256);
assert.equal(clean.dkc_height(),224);
let previous;
if(phase2Dir){
  const archive=pathToFileURL(resolve(phase2Dir)+'/');
  const {importsFor:archivedLoader}=await import(new URL('wasm-imports.js',archive));
  previous=await initialize(new URL('dkc.wasm',archive),archivedLoader);
  assert.equal(typeof previous.dkc_video_config,'function','Expected a Phase 2 stock build');
}
let frame=0;
let titleSlot;
for(const checkpoint of [600,5100,7450]){
  advance(clean,frame,checkpoint);
  const slot=captureState(clean,checkpoint);
  if(checkpoint===5100)titleSlot=slot;
  const paused=fingerprints(clean);
  if(checkpoint===600){
    const wrongLength=slot.buffer.slice(0);
    new DataView(wrongLength).setUint32(8,0xffffffff,true);
    for(const buffer of [slot.buffer.slice(0,32),slot.buffer.slice(0,-1),wrongLength]){
      assert.throws(()=>restoreState(clean,{buffer}),/state is incompatible/);
      assert.deepEqual(fingerprints(clean),paused);
    }
    console.log('Malformed lengths were rejected without changing the paused game.');
  }
  advance(clean,checkpoint,checkpoint+60);
  const continued=fingerprints(clean);
  restoreState(clean,slot);
  assert.deepEqual(fingerprints(clean),paused);
  advance(clean,checkpoint,checkpoint+60);
  assert.deepEqual(fingerprints(clean),continued);
  console.log('Clean state round trip and 60-frame continuation match at frame '+checkpoint+'.');
  if(previous){
    advance(previous,frame,checkpoint);
    const oldSlot=captureState(previous,checkpoint);
    assert.deepEqual(fingerprints(previous),paused);
    restoreState(clean,oldSlot);
    assert.deepEqual(fingerprints(clean),paused);
    advance(previous,checkpoint,checkpoint+60);
    advance(clean,checkpoint,checkpoint+60);
    assert.deepEqual(fingerprints(clean),fingerprints(previous));
    assert.deepEqual(fingerprints(clean),continued);
    console.log('Phase 2 stock state restored with seven matching fingerprints at frame '+checkpoint+' and 60 frames later.');
  }
  frame=checkpoint+60;
}

// After restoring a state, the original stomp detector should report one
// pulse on an enemy rebound and stay silent on an ordinary jump.
restoreState(clean,titleSlot);
advance(clean,5100,7332);
function stompFrames(count,buttons){
  const events=[];
  for(let tick=1;tick<=count;tick++){
    assert.equal(clean.dkc_step(buttons),0);
    if(clean.dkc_stomp_event())events.push(tick);
  }
  return events;
}
assert.deepEqual(stompFrames(318,0),[]);
const grounded=captureState(clean,7650);
assert.deepEqual(stompFrames(24,1),[]);
assert.deepEqual(stompFrames(100,0),[]);
restoreState(clean,grounded);
assert.deepEqual(stompFrames(112,0x80),[]);
assert.deepEqual(stompFrames(24,0x81),[]);
assert.deepEqual(stompFrames(65,0x80),[20]);
console.log('One stomp event on Jungle frame 7806 and zero on a stationary jump.');

if(previous){
  for(const width of [308,342]){
    previous.dkc_video_config(width,0,255,0,0,0);
    advance(previous,frame,frame+1);
    frame++;
    const source=new Uint8Array(previous.memory.buffer,previous.dkc_framebuffer(),width*224*4).slice();
    const slot=captureState(previous,frame);
    restoreState(clean,slot);
    const center=new Uint8Array(clean.memory.buffer,clean.dkc_framebuffer(),256*224*4);
    const left=(width-256)/2;
    for(let y=0;y<224;y++){
      const start=(y*width+left)*4;
      assert.deepEqual(center.subarray(y*1024,(y+1)*1024),source.subarray(start,start+1024));
    }
    previous.dkc_video_config(256,0,255,0,0,0);
    advance(previous,frame,frame+60);
    advance(clean,frame,frame+60);
    assert.deepEqual(fingerprints(clean),fingerprints(previous));
    frame+=60;
    console.log('Phase 2 '+width+'-pixel stock state restored at 256 pixels and matched after 60 stock frames.');
  }
}
