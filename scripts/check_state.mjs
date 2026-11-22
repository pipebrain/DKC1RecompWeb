// Verify the next second of gameplay and PCM after a native-format state load.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {importsFor} from '../web/wasm-imports.js';
import {captureState,restoreState} from '../web/assist.js';

const rom=process.argv[2];
if(!rom)throw new Error('Pass the path to your verified DKC USA v1.0 ROM.');
const bytes=await readFile(rom);
const runs=(await readFile(new URL('../tests/fixtures/jungle-route.inputs',import.meta.url),'utf8'))
  .split(/\r?\n/).map(line=>line.replace(/(?:#|\/\/).*/,'').trim()).filter(Boolean)
  .flatMap(line=>{const [buttons,count]=line.split('*');return Array(Number(count||1)).fill(parseInt(buttons,16));});
for(const variant of ['dkc','dkc-dixie']){
  const module=await WebAssembly.compile(await readFile(new URL('../web/'+variant+'.wasm',import.meta.url)));
  let instance;
  instance=await WebAssembly.instantiate(module,importsFor(module,()=>instance).imports);
  const core=instance.exports;core._initialize();
  const ptr=core.dkc_alloc(bytes.length);new Uint8Array(core.memory.buffer).set(bytes,ptr);
  assert.equal(core.dkc_init(ptr,bytes.length),0);core.dkc_free(ptr);
  function fingerprints(){
    const start=core.dkc_debug_fingerprints(),raw=new Uint8Array(core.memory.buffer,start);
    return JSON.parse(new TextDecoder().decode(raw.subarray(0,raw.indexOf(0))));
  }
  function advance(from,to){
    for(let i=from;i<to;i++){
      assert.equal(core.dkc_step(runs[i]||0),0);core.dkc_debug_hash_audio();
    }
  }
  let frame=0;
  for(const at of [600,5100,7450]){
    advance(frame,at);
    const checkpoint=captureState(core,at),before=fingerprints();
    advance(at,at+60);const continuation=fingerprints();
    restoreState(core,checkpoint);assert.deepEqual(fingerprints(),before,variant+' restore at '+at);
    advance(at,at+60);assert.deepEqual(fingerprints(),continuation,variant+' continuation at '+at);
    frame=at+60;
    console.log(variant+' restored frame '+at+' and reproduced all seven fingerprints after 60 more frames.');
  }
}
