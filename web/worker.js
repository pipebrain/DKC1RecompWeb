import {captureState,restoreState,RewindHistory} from './assist.js';
import {readHdPack,hdReader} from './hd-pack.js';
import {MusicPlayer} from './msu-player.js';
import {importsFor} from './wasm-imports.js';
import {VIDEO_DEFAULTS,coreVideoArgs} from './video-settings.js';

const ROM_SIZE=4194304, ROM_SHA='fa8cacf5bbfc39ee6bbaa557adf89133d60d42f6cf9e1db30d5a36a469f74d15';
const FPS=60.098811862, INTERVAL=1000/FPS;
let wasm=null,loaded=false,running=false,hasStarted=false,input=0,frameCount=0,timer=0,deadline=0;
let previousSram=null,framePool=[],audioPool=[],framesOutstanding=0,audioOutstanding=0,inventory=[];
let variant='stock', musicPlayer=null;
const rewind=new RewindHistory();
let fastForward=false,rewinding=false,trace=null;
function startTrace(){
  trace=loaded&&video.diagnostics?{anchor:captureState(wasm.exports,frameCount),inputs:[],timings:[]}:null;
}
function recordInput(buttons){
  if(!trace)return;
  if(frameCount-trace.anchor.frameCount>=1800)startTrace();
  const last=trace.inputs.at(-1);
  if(last && last.buttons===buttons)last.count++;
  else trace.inputs.push({buttons,count:1});
}
let lastStatsTime=0,droppedPresentations=0,lateTicks=0,pausedReason='not-loaded';
const text=new TextDecoder();
const send=(message,transfer=[])=>self.postMessage(message,transfer);
const heap=(instance=wasm)=>new Uint8Array(instance.exports.memory.buffer);
function cString(pointer,instance=wasm){const bytes=heap(instance);let end=pointer;while(end<bytes.length&&bytes[end])end++;return text.decode(bytes.subarray(pointer,end));}
function coreError(operation,instance=wasm){const pointer=instance.exports.dkc_last_error?.();throw new Error(`${operation}: ${pointer?cString(pointer,instance):'core returned an error'}`);}
function state(){return {loaded,variant,hdMaterials:mountedHd?.rasters||0,music:musicPlayer?'msu1':'original',musicTrack:musicPlayer?.track?.number||0,running,hasStarted,paused:!running,pausedReason,frameCount,fps:FPS,width:loaded?wasm.exports.dkc_width():256,height:loaded?wasm.exports.dkc_height():224,rate:loaded?wasm.exports.dkc_audio_rate():32040,droppedPresentations,lateTicks,imports:inventory};}
function stop(reason='paused'){fastForward=false;rewinding=false;resetVideoHistory();running=false;pausedReason=reason;clearTimeout(timer);timer=0;input=0;}
function checkSave(force=false){
  if(!loaded)return;
  const size=wasm.exports.dkc_sram_size(),current=heap().subarray(wasm.exports.dkc_sram(),wasm.exports.dkc_sram()+size);
  let changed=force||!previousSram;
  if(!changed)for(let i=0;i<size;i++)if(current[i]!==previousSram[i]){changed=true;break;}
  if(changed){previousSram=current.slice();const buffer=previousSram.slice().buffer;send({type:'sram-changed',variant,buffer,imported:force},[buffer]);}
}
let video = {...VIDEO_DEFAULTS}, midpointTimer = 0;
function resetVideoHistory(){
  clearTimeout(midpointTimer);
  midpointTimer=0;
  wasm?.exports.dkc_video_invalidate();
}
let mountedHd=null,hdPreloaded=false;
function applyCoreVideo(core){
  core.dkc_video_config(...coreVideoArgs(video));
  const kind=['raw','crt','composite','trinitron'].indexOf(video.screenColor);
  if(core.dkc_video_color(kind)<0)throw new Error('Could not initialize the selected phosphor colors.');
}
function applyHd(core,pack){
  core.dkc_hd_indexed(+(pack?.count>0));
  core.dkc_hd_enable(+(video.hdTextures&&Boolean(pack)));
  if(video.hdTextures&&pack?.count&&!hdPreloaded){
    if(core.dkc_hd_preload()!==pack.count)throw new Error('The HD material pack could not be loaded into available game memory.');
    hdPreloaded=true;
  }
}
function configureVideo(player){
  const prior=video;
  video={...VIDEO_DEFAULTS,...player};
  const current=coreVideoArgs(video);
  const same=coreVideoArgs(prior).every((value,i)=>value===current[i])
      && prior.screenColor===video.screenColor && prior.frameGeneration===video.frameGeneration;
  if(wasm && prior.hdTextures!==video.hdTextures)applyHd(wasm.exports,mountedHd);
  if(!wasm || same && prior.hdTextures===video.hdTextures && prior.hdPolish===video.hdPolish)return;
  resetVideoHistory();
  applyCoreVideo(wasm.exports);
  if(loaded){present();send({type:'stats',...state()});}
}
function sendFrame(pointer,scale=1){
  if(framesOutstanding>=3){droppedPresentations++;return;}
  const core=wasm.exports,width=core.dkc_width()*scale,height=core.dkc_height()*scale,size=width*height*4;
  const graded=core.dkc_video_grade(pointer,width,height);
  let buffer=framePool.pop();
  if(!buffer||buffer.byteLength!==size)buffer=new ArrayBuffer(size);
  new Uint8Array(buffer).set(heap().subarray(graded,graded+size));
  framesOutstanding++;send({type:'frame',buffer,width,height,frameCount},[buffer]);
}
function present(smooth=false){
  clearTimeout(midpointTimer);
  const core=wasm.exports;
  if(video.hdTextures&&mountedHd&&video.layer==='all'&&!video.provenance){
    const hd=core.dkc_hd_frame(core.dkc_framebuffer(),core.dkc_width(),core.dkc_height(),video.hdPolish);
    if(hd){sendFrame(hd,4);return;}
  }
  if(!smooth || video.frameGeneration==='off' || video.layer!=='all' || video.provenance){
    sendFrame(core.dkc_framebuffer());
    return;
  }
  const midpoint=video.frameGeneration==='midpoints';
  sendFrame(core.dkc_video_smooth(+midpoint));
  if(midpoint){
    const sequence=frameCount;
    midpointTimer=setTimeout(()=>{
      if(running && sequence===frameCount)sendFrame(core.dkc_video_midpoint());
    },Math.max(0,deadline + INTERVAL/2 - performance.now()));
  }
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
  if(video.assist)rewind.capture(wasm.exports,frameCount);
  recordInput(buttons);
  if(wasm.exports.dkc_step(buttons)!==0)coreError('Game step failed');
  if(musicPlayer){
    const core=wasm.exports;
    musicPlayer.observe(core.dkc_msu_state());
    musicPlayer.mix(new Int16Array(core.memory.buffer,core.dkc_audio_buffer(),2*core.dkc_audio_frames()),core.dkc_audio_rate());
  }
  if(trace)wasm.exports.dkc_debug_hash_audio();
  hasStarted=true;frameCount++;checkSave();
  if(display)present(running && !fastForward && (video.speed??1)===1);
  if(playAudio)audio();
}
function tick(){
  if(!running)return;
  try{
    const now=performance.now();
    if(now<deadline-.5){timer=setTimeout(tick,Math.max(0,deadline-now));return;}
    const steps=fastForward?3:(video.speed??1);
    if(rewinding){
      if(rewind.frames.length)applySnapshot(rewind.previous(frameCount));
    }else{
      let stomp=false;
      for(let n=1;n<=steps;n++){
        advance(input,n===steps,steps===1);
        stomp ||= Boolean(wasm.exports.dkc_stomp_event?.());
      }
      if(stomp)send({type:'stomp'});
    }
    if(trace){
      trace.timings.push({frame:frameCount,lateMs:Math.max(0,now-deadline),workMs:performance.now()-now});
      if(trace.timings.length>600)trace.timings.shift();
    }
    deadline+=INTERVAL;
    if(performance.now()-deadline>INTERVAL*3){lateTicks++;deadline=performance.now()+INTERVAL;}
    timer=setTimeout(tick,Math.max(0,deadline-performance.now()));
    if(now-lastStatsTime>=500){lastStatsTime=now;send({type:'stats',...state()});}
  }catch(error){stop('error');send({type:'error',error:error.message,stack:error.stack});}
}
async function hash(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');}
async function initialize(buffer,save,choice='stock',pack=null,gain=1){
  if(!['stock','dixie'].includes(choice))throw new Error('Unknown game variant.');
  const nextMusic=pack ? new MusicPlayer(pack,gain) : null;
  if(buffer.byteLength!==ROM_SIZE)throw new Error('Unsupported ROM size. Expected a headerless 4,194,304-byte DKC USA v1.0 ROM.');
  if(await hash(buffer)!==ROM_SHA)throw new Error('Unsupported ROM SHA-256. Expected unmodified DKC USA v1.0.');
  send({type:'loading',message:'Compiling WebAssembly…'});
  const url=choice==='dixie'?new URL('./dkc-dixie.wasm',import.meta.url):new URL('./dkc.wasm',import.meta.url);
  const response=await fetch(url);
  if(!response.ok)throw new Error(`${choice} Wasm build not found (${response.status}). Build the browser cores first.`);
  const module=await WebAssembly.compile(await response.arrayBuffer());
  let instance=null;
  let nextHd;
  try{nextHd=await readHdPack();}catch(error){if(video.hdTextures)throw error;}
  const materials=hdReader(nextHd,(count,total)=>send({type:'loading',message:`Loading HD materials… ${count.toLocaleString()} of ${total.toLocaleString()}`}));
  const prepared=importsFor(module,()=>instance,message=>send(message),materials);
  instance=await WebAssembly.instantiate(module,prepared.imports);
  const core=instance.exports;
  const required=['dkc_state_read','dkc_state_write','dkc_stomp_event','dkc_hd_frame','dkc_hd_indexed','dkc_hd_enable','dkc_hd_preload','dkc_msu_enable','dkc_msu_state','dkc_debug_fingerprints','dkc_debug_hash_audio','dkc_video_config','dkc_video_color','dkc_video_grade','dkc_video_midpoint','dkc_video_smooth','dkc_video_invalidate','memory','dkc_init','dkc_alloc','dkc_free','dkc_step','dkc_framebuffer','dkc_width','dkc_height','dkc_pitch','dkc_audio_buffer','dkc_audio_frames','dkc_audio_rate','dkc_sram','dkc_sram_size','dkc_last_error'];
  const missing=required.filter(name=>!core[name]);if(missing.length)throw new Error(`Missing Wasm exports: ${missing.join(', ')}`);
  core._initialize?.();
  applyCoreVideo(core);
  if(nextMusic)core.dkc_msu_enable(1);
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
  const previousPreload=hdPreloaded;
  hdPreloaded=false;
  try{applyHd(core,nextHd);}catch(error){hdPreloaded=previousPreload;throw error;}
  mountedHd=nextHd;
  stop('loading');rewind.clear();
  previousSram=initialSram;
  wasm=instance;inventory=prepared.inventory;variant=choice;musicPlayer=nextMusic;
  loaded=true;hasStarted=false;frameCount=0;input=0;pausedReason='ready';droppedPresentations=0;lateTicks=0;
  startTrace();present();return state();
}
async function runDiagnosticFrames(count,buttons,collectAudioHash=false){
  for(let i=0;i<count;i++){
    advance(buttons,false,false);
    if(collectAudioHash&&!trace)wasm.exports.dkc_debug_hash_audio();
    if(frameCount%120===0)await new Promise(resolve=>setTimeout(resolve,0));
  }
}
function applySnapshot(entry){
  restoreState(wasm.exports,entry);
  frameCount=entry.frameCount;hasStarted=running||frameCount>0;
  musicPlayer?.reset();resetVideoHistory();checkSave();present();
}
async function command(data){
  switch(data.type){
    case 'repro':{
      if(!trace)throw new Error('Turn on Record diagnostics and load a game first.');
      return {variant,music:musicPlayer?'msu1':'original',buffer:trace.anchor.buffer.slice(0),startFrame:trace.anchor.frameCount,endFrame:frameCount,
        inputs:trace.inputs,timings:trace.timings,fingerprints:JSON.parse(cString(wasm.exports.dkc_debug_fingerprints()))};
    }
    case 'preferences':
      if(video.assist && !data.player.assist)rewind.clear();
      if(!data.player.assist){rewinding=false;fastForward=false;}
      configureVideo(data.player);
      // Re-anchor on a graphics, timing or other preferences change.
      startTrace();return;
    case 'rewind-held':
      if(rewinding&&!data.held)startTrace();
      rewinding=Boolean(data.held&&video.assist&&running);
      return;
    case 'fast-forward':fastForward=Boolean(data.held&&video.assist&&running);return;
    case 'snapshot':{
      if(!loaded)throw new Error('Load a game first.');
      const entry=captureState(wasm.exports,frameCount);
      return {...entry,variant,sha256:await hash(entry.buffer)};
    }
    case 'restore-state':
    case 'rewind-step':{
      if(!loaded || (data.type==='rewind-step'&&!video.assist))throw new Error('Rewind is unavailable.');
      stop('state');
      const isSlot=data.type==='restore-state';
      const entry=isSlot?data:rewind.previous(frameCount);
      if(isSlot && (data.variant!==variant || !Number.isSafeInteger(data.frameCount) || data.frameCount<0 ||
         !(data.buffer instanceof ArrayBuffer) || await hash(data.buffer)!==data.sha256))
        throw new Error('Saved state failed validation.');
      const backup=isSlot?captureState(wasm.exports,frameCount):null;
      try{applySnapshot(entry);}catch(error){if(backup)restoreState(wasm.exports,backup);throw error;}
      if(isSlot)rewind.clear();
      startTrace();return state();
    }
    case 'load':return initialize(data.buffer,data.save,data.variant,data.pack,data.musicGain);
    case 'music-gain':if(musicPlayer&&Number.isFinite(data.gain)&&data.gain>=0&&data.gain<=4)musicPlayer.gain=data.gain;return;
    case 'pause':stop(data.reason||'paused');send({type:'stats',...state()});return state();
    case 'resume':if(!loaded)throw new Error('Load a ROM first.');hasStarted=true;if(!running){running=true;pausedReason=null;deadline=performance.now()+INTERVAL;timer=setTimeout(tick,INTERVAL);}return state();
    case 'input':input=data.buttons&0xffffff;return;
    case 'step':if(!loaded)throw new Error('Load a ROM first.');stop('debug-step');advance(data.buttons&0xffffff,true,false);return state();
    case 'run-frames':{
      if(!loaded)throw new Error('Load a ROM first.');
      const count=Number(data.count);if(!Number.isInteger(count)||count<0||count>100000)throw new Error('Frame count must be an integer from 0 to 100,000.');
      stop('debug-run');await runDiagnosticFrames(count,data.buttons&0xffffff);
      present();return state();
    }
    case 'replay-fingerprints':{
      if(!loaded||running||frameCount!==0)throw new Error('Fingerprint replay requires a freshly loaded, paused game.');
      if(!Array.isArray(data.runs)||!data.runs.length)throw new Error('A fingerprint replay requires input runs.');
      let total=0;
      for(const {count,buttons} of data.runs){
        if(!Number.isSafeInteger(count)||count<1||!Number.isInteger(buttons)||buttons<0||buttons>0xffffff)
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
      heap().set(new Uint8Array(data.buffer),wasm.exports.dkc_sram());checkSave(true);startTrace();return state();
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
  if(data.type==='input'){input=data.buttons&0xffffff;return;}
  queue=queue.then(async()=>{
    try{const result=await command(data);if(data.id){const transfer=result?.buffer?[result.buffer]:[];send({type:'response',id:data.id,value:result},transfer);}}
    catch(error){send({type:data.id?'response':'error',id:data.id,error:error.message,stack:error.stack});}
  });
};
send({type:'worker-ready'});
