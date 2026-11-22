// Explicit services for the standalone module. Unknown imports fail before boot.
export function importsFor(module, instance, report = () => {}, materials=null) {
  const decoder=new TextDecoder();
  const memory=()=>{
    const value=instance()?.exports.memory;
    if(!(value instanceof WebAssembly.Memory))throw new Error('The standalone module has not exported memory.');
    return value;
  };
  const view=()=>new DataView(memory().buffer);
  const bytes=()=>new Uint8Array(memory().buffer);
  function string(pointer){const heap=bytes();let end=pointer;while(end<heap.length&&heap[end])end++;return decoder.decode(heap.subarray(pointer,end));}
  function write64(pointer,value){view().setBigUint64(pointer,BigInt(value),true);}
  function descriptor(fd){return fd===1||fd===2;}
  function grow(size){const mem=memory();if(size<=mem.buffer.byteLength)return 1;try{mem.grow(Math.ceil((size-mem.buffer.byteLength)/65536));return 1;}catch{return 0;}}
  const wasi={
    fd_write(fd,iov,count,written){
      if(!descriptor(fd))return 8;
      const data=view(),heap=bytes();let total=0,text='';
      for(let i=0;i<count;i++){const ptr=data.getUint32(iov+i*8,true),length=data.getUint32(iov+i*8+4,true);text+=decoder.decode(heap.subarray(ptr,ptr+length));total+=length;}
      data.setUint32(written,total,true);
      if(text.trim())report({type:'log',level:fd===2?'stderr':'stdout',text});
      return 0;
    },
    fd_read(fd,iov,count,read){if(fd!==0)return 8;view().setUint32(read,0,true);return 0;},
    fd_close(){return 8;},
    fd_seek(){return 70;},
    fd_fdstat_get(fd,pointer){
      if(fd!==0&&!descriptor(fd))return 8;
      bytes().fill(0,pointer,pointer+24);view().setUint8(pointer,2);
      write64(pointer+8,fd===0?2n:64n);return 0;
    },
    fd_sync(fd){return descriptor(fd)?0:8;},
    fd_prestat_get(){return 8;},
    fd_prestat_dir_name(){return 8;},
    environ_sizes_get(count,size){view().setUint32(count,0,true);view().setUint32(size,0,true);return 0;},
    environ_get(){return 0;},
    args_sizes_get(count,size){view().setUint32(count,0,true);view().setUint32(size,0,true);return 0;},
    args_get(){return 0;},
    clock_time_get(clock,precision,out){
      // A synchronous game frame owns this single worker. Monotonic elapsed
      // time approximates process/thread CPU clocks for the watchdog;
      // the browser does not expose POSIX per-process CPU accounting.
      if(clock<0||clock>3)return 28;
      write64(out,BigInt(Math.floor((clock===0?Date.now():performance.now())*1e6)));return 0;
    },
    clock_res_get(clock,out){if(clock<0||clock>3)return 28;write64(out,1000000n);return 0;},
    random_get(pointer,length){for(let i=0;i<length;i+=65536)crypto.getRandomValues(bytes().subarray(pointer+i,pointer+Math.min(length,i+65536)));return 0;},
    proc_exit(code){throw new Error(`The C runtime exited with code ${code}.`);},
  };
  const env={
    dkc_hd_open:pointer=>materials?.open(string(pointer))||0,
    dkc_hd_read:(handle,pointer,length)=>materials?.read(handle,bytes().subarray(pointer,pointer+length))??-1,
    dkc_hd_close:handle=>materials?.close(handle),
    // Optional native directory discovery is unavailable in this host.
    // This Emscripten libc syscall ABI returns a negative errno (ENOSYS=52).
    __syscall_getdents64:()=>-52,
    emscripten_date_now:()=>Date.now(),
    emscripten_get_now:()=>performance.now(),
    emscripten_get_now_is_monotonic:()=>1,
    emscripten_resize_heap:grow,
    _emscripten_resize_heap:grow,
    emscripten_notify_memory_growth:()=>{},
    emscripten_memcpy_big(destination,source,size){bytes().copyWithin(destination,source,source+size);return destination;},
    abort(){throw new Error('The C runtime aborted.');},
    __assert_fail(condition,file,line,fn){throw new Error(`C assertion: ${string(condition)} at ${string(file)}:${line} (${string(fn)})`);},
  };
  const known={wasi_snapshot_preview1:wasi,env};
  const imports={},inventory=WebAssembly.Module.imports(module);
  const unsupported=[];
  for(const item of inventory){
    const value=known[item.module]?.[item.name];
    if(item.kind!=='function'||typeof value!=='function'){unsupported.push(`${item.module}.${item.name} (${item.kind})`);continue;}
    (imports[item.module]??={})[item.name]=value;
  }
  if(unsupported.length)throw new Error(`Unsupported Wasm imports: ${unsupported.join(', ')}`);
  return {imports,inventory};
}
