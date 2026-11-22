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
