import {importsFor} from './wasm-imports.js';

const ROM_SIZE=4194304, ROM_SHA='fa8cacf5bbfc39ee6bbaa557adf89133d60d42f6cf9e1db30d5a36a469f74d15';
const FPS=60.098811862, INTERVAL=1000/FPS;
let wasm=null,loaded=false,running=false,hasStarted=false,input=0,frameCount=0,timer=0,deadline=0;
let previousSram=null,framePool=[],audioPool=[],framesOutstanding=0,audioOutstanding=0,inventory=[];
let droppedPresentations=0,lateTicks=0,pausedReason='not-loaded';
const text=new TextDecoder();
const send=(message,transfer=[])=>self.postMessage(message,transfer);
const heap=(instance=wasm)=>new Uint8Array(instance.exports.memory.buffer);
function cString(pointer,instance=wasm){const bytes=heap(instance);let end=pointer;while(end<bytes.length&&bytes[end])end++;return text.decode(bytes.subarray(pointer,end));}
function coreError(operation,instance=wasm){const pointer=instance.exports.dkc_last_error?.();throw new Error(`${operation}: ${pointer?cString(pointer,instance):'core returned an error'}`);}
function state(){return {loaded,running,hasStarted,paused:!running,pausedReason,frameCount,fps:FPS,width:loaded?wasm.exports.dkc_width():256,height:loaded?wasm.exports.dkc_height():224,rate:loaded?wasm.exports.dkc_audio_rate():32040,droppedPresentations,lateTicks,imports:inventory};}
function stop(reason='paused'){running=false;pausedReason=reason;clearTimeout(timer);timer=0;input=0;}
function checkSave(force=false){
  if(!loaded)return;
  const size=wasm.exports.dkc_sram_size(),current=heap().subarray(wasm.exports.dkc_sram(),wasm.exports.dkc_sram()+size);
  let changed=force||!previousSram;
  if(!changed)for(let i=0;i<size;i++)if(current[i]!==previousSram[i]){changed=true;break;}
  if(changed){previousSram=current.slice();const buffer=previousSram.slice().buffer;send({type:'sram-changed',buffer,imported:force},[buffer]);}
}
function present(){
  if(framesOutstanding>=3){droppedPresentations++;return;}
  const width=wasm.exports.dkc_width(),height=wasm.exports.dkc_height(),size=width*height*4;
  let buffer=framePool.pop();if(!buffer||buffer.byteLength!==size)buffer=new ArrayBuffer(size);
  const output=new Uint8Array(buffer),source=heap(),pointer=wasm.exports.dkc_framebuffer(),pitch=wasm.exports.dkc_pitch();
  for(let y=0;y<height;y++)output.set(source.subarray(pointer+y*pitch,pointer+y*pitch+width*4),y*width*4);
  framesOutstanding++;send({type:'frame',buffer,width,height,frameCount},[buffer]);
}
function audio(){
  const frames=wasm.exports.dkc_audio_frames();if(!frames)return;
  if(audioOutstanding>=8)return;
  const length=frames*4;
  let buffer=audioPool.find(x=>x.byteLength===length);
  if(buffer)audioPool.splice(audioPool.indexOf(buffer),1);else buffer=new ArrayBuffer(length);
  new Uint8Array(buffer).set(heap().subarray(wasm.exports.dkc_audio_buffer(),wasm.exports.dkc_audio_buffer()+length));
  audioOutstanding++;send({type:'audio',buffer,rate:wasm.exports.dkc_audio_rate(),frames},[buffer]);
}
function advance(buttons,display=true,playAudio=true){
  if(wasm.exports.dkc_step(buttons)!==0)coreError('Game step failed');
  hasStarted=true;frameCount++;checkSave();if(display)present();if(playAudio)audio();
}
function tick(){
  if(!running)return;
  try{
    const now=performance.now();
    if(now<deadline-.5){timer=setTimeout(tick,Math.max(0,deadline-now));return;}
    advance(input);
    deadline+=INTERVAL;
    if(performance.now()-deadline>INTERVAL*3){lateTicks++;deadline=performance.now()+INTERVAL;}
    timer=setTimeout(tick,Math.max(0,deadline-performance.now()));
    if(frameCount%60===0)send({type:'stats',...state()});
  }catch(error){stop('error');send({type:'error',error:error.message,stack:error.stack});}
}
async function hash(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');}
async function initialize(buffer,save){
  if(buffer.byteLength!==ROM_SIZE)throw new Error('Unsupported ROM size. Expected a headerless 4,194,304-byte DKC USA v1.0 ROM.');
  if(await hash(buffer)!==ROM_SHA)throw new Error('Unsupported ROM SHA-256. Expected unmodified DKC USA v1.0.');
  send({type:'loading',message:'Compiling WebAssembly…'});
  const response=await fetch(new URL('./dkc.wasm',import.meta.url));
  if(!response.ok)throw new Error(`Wasm build not found (${response.status}). Build web/dkc.wasm first.`);
  const module=await WebAssembly.compile(await response.arrayBuffer());
  let instance=null;
  const prepared=importsFor(module,()=>instance,message=>send(message));
  instance=await WebAssembly.instantiate(module,prepared.imports);
  const core=instance.exports;
  const required=['memory','dkc_init','dkc_alloc','dkc_free','dkc_step','dkc_framebuffer','dkc_width','dkc_height','dkc_pitch','dkc_audio_buffer','dkc_audio_frames','dkc_audio_rate','dkc_sram','dkc_sram_size','dkc_last_error'];
  const missing=required.filter(name=>!core[name]);if(missing.length)throw new Error(`Missing Wasm exports: ${missing.join(', ')}`);
  core._initialize?.();
  const pointer=core.dkc_alloc(buffer.byteLength);if(!pointer)throw new Error('Cannot allocate ROM memory.');
  try{heap(instance).set(new Uint8Array(buffer),pointer);if(core.dkc_init(pointer,buffer.byteLength)!==0)coreError('Game initialization failed',instance);}
  finally{core.dkc_free(pointer);}
  const sram=new Uint8Array(core.memory.buffer,core.dkc_sram(),core.dkc_sram_size());
  if(save){
    if(!(save instanceof ArrayBuffer)||save.byteLength!==sram.length)throw new Error('Invalid cartridge save size.');
    sram.set(new Uint8Array(save));
  }
  // The initial memory (including restored data) is clean. Only a later game
  // write or an explicit file import should replace the browser's save.
  const initialSram=sram.slice();
  stop('loading');
  previousSram=initialSram;
  wasm=instance;inventory=prepared.inventory;
  loaded=true;hasStarted=false;frameCount=0;input=0;pausedReason='ready';droppedPresentations=0;lateTicks=0;
  present();return state();
}
async function runDiagnosticFrames(count,buttons,collectAudioHash=false){
  for(let i=0;i<count;i++){
    advance(buttons,false,false);
    if(collectAudioHash)wasm.exports.dkc_debug_hash_audio();
    if(frameCount%120===0)await new Promise(resolve=>setTimeout(resolve,0));
  }
}
async function command(data){
  switch(data.type){
    case 'load':return initialize(data.buffer,data.save);
    case 'pause':stop(data.reason||'paused');send({type:'stats',...state()});return state();
    case 'resume':if(!loaded)throw new Error('Load a ROM first.');hasStarted=true;if(!running){running=true;pausedReason=null;deadline=performance.now()+INTERVAL;timer=setTimeout(tick,INTERVAL);}return state();
    case 'input':input=data.buttons&4095;return;
    case 'step':if(!loaded)throw new Error('Load a ROM first.');stop('debug-step');advance(data.buttons&4095,true,false);return state();
    case 'run-frames':{
      if(!loaded)throw new Error('Load a ROM first.');
      const count=Number(data.count);if(!Number.isInteger(count)||count<0||count>100000)throw new Error('Frame count must be an integer from 0 to 100,000.');
      stop('debug-run');await runDiagnosticFrames(count,data.buttons&4095);
      present();return state();
    }
    case 'replay-fingerprints':{
      if(!loaded||running||frameCount!==0)throw new Error('Fingerprint replay requires a freshly loaded, paused game.');
      if(!Array.isArray(data.runs)||!data.runs.length)throw new Error('A fingerprint replay requires input runs.');
      let total=0;
      for(const {count,buttons} of data.runs){
        if(!Number.isSafeInteger(count)||count<1||!Number.isInteger(buttons)||buttons<0||buttons>4095)
          throw new Error('Invalid input run.');
        total+=count;
        if(total>100000)throw new Error('Fingerprint replay exceeds 100,000 frames.');
      }
      stop('debug-run');
      for(const {count,buttons} of data.runs)await runDiagnosticFrames(count,buttons,true);
      present();
      return {frameCount,fingerprints:JSON.parse(cString(wasm.exports.dkc_debug_fingerprints()))};
    }
    case 'get-state':return state();
    case 'get-sram':if(!loaded)throw new Error('Load a ROM first.');return {buffer:heap().slice(wasm.exports.dkc_sram(),wasm.exports.dkc_sram()+wasm.exports.dkc_sram_size()).buffer};
    case 'set-sram':{
      if(!loaded)throw new Error('Load a ROM first.');
      if(data.buffer.byteLength!==wasm.exports.dkc_sram_size())throw new Error('Save must contain exactly 2,048 bytes of cartridge SRAM.');
      heap().set(new Uint8Array(data.buffer),wasm.exports.dkc_sram());checkSave(true);return state();
    }
    case 'frame-hash':{
      if(!loaded)throw new Error('Load a ROM first.');
      const width=wasm.exports.dkc_width(),height=wasm.exports.dkc_height(),pitch=wasm.exports.dkc_pitch(),pointer=wasm.exports.dkc_framebuffer();
      const frame=new Uint8Array(width*height*4);for(let y=0;y<height;y++)frame.set(heap().subarray(pointer+y*pitch,pointer+y*pitch+width*4),y*width*4);
      return {frameCount,sha256:await hash(frame)};
    }
    default:throw new Error(`Unknown worker command: ${data.type}`);
  }
}
let queue=Promise.resolve();
self.onmessage=({data})=>{
  if(data.type==='recycle-frame'){framesOutstanding=Math.max(0,framesOutstanding-1);if(framePool.length<3)framePool.push(data.buffer);return;}
  if(data.type==='recycle-audio'){audioOutstanding=Math.max(0,audioOutstanding-1);if(audioPool.length<12)audioPool.push(data.buffer);return;}
  // Input remains responsive while an explicit diagnostic run yields.
  if(data.type==='input'){input=data.buttons&4095;return;}
  queue=queue.then(async()=>{
    try{const result=await command(data);if(data.id){const transfer=result?.buffer?[result.buffer]:[];send({type:'response',id:data.id,value:result},transfer);}}
    catch(error){send({type:data.id?'response':'error',id:data.id,error:error.message,stack:error.stack});}
  });
};
send({type:'worker-ready'});
