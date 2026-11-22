// Native HD rasters and optional scene metadata selected by the player.
const raster=/^[a-f0-9]{64}\.dkhd$/;
const companions=new Set(['preload.txt','background-centers.txt','object-silhouettes.txt','object-bases.bin',
  'connected-world.bin','connected-cave.bin','fixed-hoard-wide.bgra','fixed-treehouse-wide.bgra']);
const decoder=new TextDecoder();
export async function collectHdPack(files,progress=()=>{}){
  const groups=new Map();
  for(const file of files){
    const parts=(file.webkitRelativePath||file.name).split('/'),name=parts.pop();
    if(parts.some(part=>part.startsWith('.')||part==='__MACOSX')||!raster.test(name)&&!companions.has(name))continue;
    const folder=parts.join('/');if(!groups.has(folder))groups.set(folder,new Map());
    const entries=groups.get(folder);
    if(entries.has(name))throw new Error('Repeated HD material filename.');
    entries.set(name,file);
  }
  const candidates=Array.from(groups).filter(([,entries])=>[...entries.keys()].some(name=>raster.test(name)));
  if(candidates.length!==1)throw new Error('Choose one Materials folder containing .dkhd rasters.');
  const [folder,entries]=candidates[0],rasters=[...entries].filter(([name])=>raster.test(name));
  if(rasters.length>65536)throw new Error('The HD compositor supports up to 65,536 indexed materials.');
  let count=0;
  if(entries.has('preload.txt')){
    const index=entries.get('preload.txt');if(index.size>65*65536+32)throw new Error('HD material index exceeds its maximum length.');
    const lines=(await index.text()).split('\n'),header=/^DKHPv001 ([1-9]\d*)$/.exec(lines.shift());
    if(!header||lines.pop()!==''||lines.length!==Number(header[1])||lines.length>65536)throw new Error('Invalid HD material index.');
    for(const [i,key] of lines.entries())if(!/^[a-f0-9]{64}$/.test(key)||i&&lines[i-1]>=key||!entries.has(key+'.dkhd'))throw new Error('The sorted HD material index refers to a missing or invalid raster.');
    count=lines.length;
  }
  for(let i=0;i<rasters.length;i+=32){
    if(i%256===0)progress(i,rasters.length);
    await Promise.all(rasters.slice(i,i+32).map(async([name,file])=>{
      const bytes=await file.slice(0,12).arrayBuffer(),data=new DataView(bytes);
      if(bytes.byteLength!==12||decoder.decode(bytes.slice(0,8))!=='DKHDv001')throw new Error('Invalid HD raster header in '+name);
      const w=data.getUint16(8,true),h=data.getUint16(10,true);
      if(!w||!h||w%4||h%4||w>1368||h>896||file.size!==12+w*h*4)throw new Error('Invalid HD raster dimensions or length in '+name);
    }));
  }
  const assets=Array.from(entries,([name,file])=>({name,file:file.slice()}));
  return {name:folder.split('/').pop()||'Materials',count,rasters:rasters.length,assets};
}

function transaction(mode,operation){
  return new Promise((resolve,reject)=>{
    const open=indexedDB.open('dkc-browser-hd',1);
    open.onupgradeneeded=()=>open.result.createObjectStore('packs');
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
      const db=open.result;
      try{
        const tx=db.transaction('packs',mode),result=operation(tx.objectStore('packs'));
        tx.oncomplete=()=>{db.close();resolve(result.result);};
        tx.onabort=()=>{db.close();reject(tx.error||new Error('HD material storage failed.'));};
      }catch(error){db.close();reject(error);}
    };
  });
}
export const readHdPack=()=>transaction('readonly',store=>store.get('current'));
export function setupHdPaths(){
  const folder=document.querySelector('#hd-folder'),clear=document.querySelector('#forget-hd'),status=document.querySelector('#hd-pack-status');
  let selected=null,revision=0;
  const show=()=>{status.textContent=selected?`${selected.name} · ${selected.rasters} materials. Applies on next game load.`:'No HD materials selected.';clear.disabled=!selected;};
  transaction('readonly',store=>store.get('description')).then(value=>{if(!revision){selected=value;show();}}).catch(error=>{if(!revision)status.textContent=error.message;});
  async function replace(files){
    revision++;folder.disabled=clear.disabled=true;
    try{
      status.textContent=files?'Checking HD materials…':'Removing HD materials…';
      const pack=files?await collectHdPack(files,(count,total)=>{status.textContent=`Checking HD materials… ${count.toLocaleString()} of ${total.toLocaleString()}`;}):null;
      if(pack)status.textContent=`Saving ${pack.rasters.toLocaleString()} HD materials in this browser…`;
      const summary=pack?{name:pack.name,rasters:pack.rasters}:null;
      await transaction('readwrite',store=>{
        if(!pack){store.delete('description');return store.delete('current');}
        store.put(summary,'description');return store.put(pack,'current');
      });
      selected=summary;show();
    }catch(error){status.textContent=error.message;clear.disabled=!selected;}
    finally{folder.disabled=false;folder.value='';}
  }
  folder.addEventListener('change',()=>{if(folder.files.length)replace([...folder.files]);});
  clear.addEventListener('click',()=>replace(null));
}

// Called only in the game worker. libc holds a stream for the manifest and
// the current raster. Closed source buffers can be collected immediately.
export function hdReader(pack,progress=()=>{}){
  const files=new Map((pack?.assets||[]).map(({name,file})=>[name,file])),streams=new Map();
  let next=0,loaded=0;
  return {
    open(name){
      const file=files.get(name);if(!file)return 0;
      const stream={bytes:new Uint8Array(new FileReaderSync().readAsArrayBuffer(file)),position:0};
      if(loaded<pack.count&&raster.test(name)){
        loaded++;
        if(loaded===1||loaded%512===0||loaded===pack.count)progress(loaded,pack.count);
      }
      const handle=++next;streams.set(handle,stream);return handle;
    },
    read(handle,target){
      const stream=streams.get(handle);if(!stream)return -1;
      const bytes=stream.bytes.subarray(stream.position,stream.position+target.length);
      target.set(bytes);stream.position+=bytes.length;return bytes.length;
    },
    close(handle){streams.delete(handle);},
  };
}
