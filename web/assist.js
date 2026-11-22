// As in v0.0.17, capture every third guest frame, bounded by time and memory.
const MAX_FRAMES=300, MAX_BYTES=128*1024*1024;
export function captureState(core, frameCount){
  const size=core.dkc_state_write(0,0);
  const ptr=size&&core.dkc_alloc(size);
  if(!ptr)throw new Error('Could not allocate a game snapshot.');
  try{
    if(core.dkc_state_write(ptr,size)!==size)throw new Error('Could not capture the game state.');
    return {frameCount,buffer:core.memory.buffer.slice(ptr,ptr+size)};
  }finally{core.dkc_free(ptr);}
}
export function restoreState(core,{buffer}){
  if(!(buffer instanceof ArrayBuffer)||!buffer.byteLength||buffer.byteLength>16*1024*1024)
    throw new Error('Invalid game snapshot.');
  const ptr=core.dkc_alloc(buffer.byteLength);
  if(!ptr)throw new Error('Could not allocate a game snapshot.');
  try{
    new Uint8Array(core.memory.buffer,ptr,buffer.byteLength).set(new Uint8Array(buffer));
    if(!core.dkc_state_read(ptr,buffer.byteLength))throw new Error('The game state is incompatible.');
  }finally{core.dkc_free(ptr);}
}
export class RewindHistory{
  frames=[];
  bytes=0;
  clear(){this.frames.length=0;this.bytes=0;}
  capture(core,count){
    if(count%3)return;
    const entry=captureState(core,count);
    this.frames.push(entry);this.bytes+=entry.buffer.byteLength;
    while(this.frames.length>MAX_FRAMES||this.bytes>MAX_BYTES)this.bytes-=this.frames.shift().buffer.byteLength;
  }
  previous(count){
    while(this.frames.length){
      const entry=this.frames.pop();this.bytes-=entry.buffer.byteLength;
      if(entry.frameCount<count)return entry;
    }
    throw new Error('No earlier game frames are available.');
  }
}
