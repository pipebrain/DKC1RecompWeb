// User-selected PCMs stay in this origin. Keep large blobs out of config files
// and process one track at a time when importing a compressed archive.
const namePattern = /^(track|dkc_msu)-(\d+)\.pcm$/i;
const maxTrack = 256 * 1024 * 1024;
const maxPack = 3 * 1024 * 1024 * 1024;
const view = async blob => new DataView(await blob.arrayBuffer());
const invalid = message => {throw new Error(message);};

function chooseTrack(entries, name, read) {
  const parts = name.split('/');
  if (parts.includes('__MACOSX') || parts.some(part => part.startsWith('.'))) return;
  const match = namePattern.exec(parts.pop());
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 32) return;
  const number = Number(match[2]), dir = parts.join('/');
  if (!entries.has(dir)) entries.set(dir,new Map());
  const tracks = entries.get(dir), preferred = match[1].toLowerCase() === 'track';
  const existing = tracks.get(number);
  if (!existing || (preferred && !existing.preferred)) tracks.set(number,{read,preferred});
}

async function buildPack(entries, name) {
  const groups = [...entries.values()].filter(group => group.has(1));
  if (groups.length !== 1) invalid('Choose one music pack containing track-1.pcm or dkc_msu-1.pcm.');
  const tracks = [];
  let total = 0;
  for (const [number,entry] of groups[0]) {
    const file = await entry.read();
    if (file.size < 12 || file.size > maxTrack || (file.size - 8) % 4) invalid('Invalid PCM size for track ' + number);
    const header = await view(file.slice(0,8));
    if (header.getUint32(0) !== 0x4d535531) invalid('Missing MSU1 PCM header on track ' + number);
    total += file.size;
    if (total > maxPack) invalid('This music pack exceeds the browser import limit.');
    tracks.push({number,file,frames:(file.size-8)/4,loop:header.getUint32(4,true)});
  }
  return {name,tracks};
}

export async function folderPack(files) {
  const entries = new Map();
  for (const file of files) chooseTrack(entries,file.webkitRelativePath || file.name,() => file);
  return buildPack(entries,files[0]?.webkitRelativePath?.split('/')[0] || 'Music folder');
}

const crcTable = Uint32Array.from({length:256},(_,i) => {
  let crc=i;
  for (let k=0;k<8;k++) crc=(crc>>>1)^((crc&1)?0xedb88320:0);
  return crc>>>0;
});
async function extract(archive,entry) {
  const {offset,compressed,size,method,crc} = entry;
  const header = await view(archive.slice(offset,offset+30));
  if (header.byteLength !== 30 || header.getUint32(0,true) !== 0x04034b50) invalid('Damaged ZIP entry.');
  const start=offset+30+header.getUint16(26,true)+header.getUint16(28,true);
  if (start+compressed>archive.size) invalid('Truncated ZIP entry.');
  let stream=archive.slice(start,start+compressed).stream();
  if (method === 8) stream=stream.pipeThrough(new DecompressionStream('deflate-raw'));
  const reader=stream.getReader(), chunks=[];
  let actual=0, sum=0xffffffff;
  try {
    while (true) {
      const {value,done}=await reader.read();
      if (done) break;
      actual+=value.length;
      if (actual>size) invalid('PCM exceeds its declared ZIP size.');
      for (const byte of value) sum=(sum>>>8)^crcTable[(sum^byte)&255];
      chunks.push(value);
    }
  } finally {await reader.cancel().catch(()=>{});}
  if (actual !== size || ((sum ^ 0xffffffff)>>>0) !== crc) invalid('PCM failed its ZIP checksum.');
  return new Blob(chunks);
}
export async function archivePack(file) {
  const end=await view(file.slice(Math.max(0,file.size-65557)));
  let i=end.byteLength-22;
  while (i>=0 && (end.getUint32(i,true)!==0x06054b50 || i+22+end.getUint16(i+20,true)!==end.byteLength)) i--;
  if (i<0 || end.getUint32(i+4,true)!==0) invalid('Choose a single ZIP or .msu1 archive.');
  const count=end.getUint16(i+10,true), size=end.getUint32(i+12,true), offset=end.getUint32(i+16,true);
  if (count>8192 || size>8*1024*1024 || offset+size>file.size) invalid('Unsupported ZIP directory.');
  const directory=await view(file.slice(offset,offset+size)), entries=new Map(), decoder=new TextDecoder();
  let pos=0;
  for (let n=0;n<count;n++) {
    if (pos+46>size || directory.getUint32(pos,true)!==0x02014b50) invalid('Invalid ZIP directory entry.');
    const length=directory.getUint16(pos+28,true);
    const next=pos+46+length+directory.getUint16(pos+30,true)+directory.getUint16(pos+32,true);
    if (next>size) invalid('Invalid ZIP entry name.');
    const name=decoder.decode(new Uint8Array(directory.buffer,pos+46,length));
    const flags=directory.getUint16(pos+8,true), method=directory.getUint16(pos+10,true);
    const entry={offset:directory.getUint32(pos+42,true),compressed:directory.getUint32(pos+20,true),
      size:directory.getUint32(pos+24,true),crc:directory.getUint32(pos+16,true),method};
    chooseTrack(entries,name,() => {
      if ((flags&1) || ![0,8].includes(method) || entry.size>maxTrack) invalid('Unsupported PCM compression or track size.');
      return extract(file,entry);
    });
    pos=next;
  }
  return buildPack(entries,file.name);
}

async function transaction(mode,operation) {
  const db=await new Promise((resolve,reject)=>{
    const open=indexedDB.open('dkc-browser-music',1);
    open.onupgradeneeded=()=>open.result.createObjectStore('packs');
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>resolve(open.result);
  });
  try {
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction('packs',mode);
      const req=operation(tx.objectStore('packs'));
      tx.oncomplete=()=>resolve(req.result);
      tx.onabort=()=>reject(tx.error||new Error('Music storage operation failed.'));
    });
  } finally {db.close();}
}
export const readMusicPack=()=>transaction('readonly',store=>store.get('current'));
export const storeMusicPack=pack=>transaction('readwrite',store=>pack?store.put(pack,'current'):store.delete('current'));

export function setupMusicPaths() {
  const folder=document.querySelector('#music-folder'), archive=document.querySelector('#music-archive');
  const clear=document.querySelector('#forget-music'), status=document.querySelector('#music-pack-status');
  let cache=null, generation=0;
  const describe=()=>{status.textContent=cache ? cache.name+' · '+cache.tracks.length+' tracks. Applies on next game load.' : 'No music pack selected.';clear.disabled=!cache;};
  const run=async task=>{
    generation++;
    folder.disabled=archive.disabled=clear.disabled=true;
    try {await task();describe();} catch(error){status.textContent=error.message;clear.disabled=!cache;}
    finally{folder.value=archive.value='';folder.disabled=archive.disabled=false;}
  };
  for(const [input,parse] of [[folder,files=>folderPack(files)],[archive,files=>archivePack(files[0])]]) {
    input.addEventListener('change',()=>{if(input.files.length)run(async()=>{
      status.textContent='Checking and storing music…';
      const pack=await parse([...input.files]);
      await storeMusicPack(pack);cache=pack;
    });});
  }
  clear.addEventListener('click',()=>run(async()=>{await storeMusicPack(null);cache=null;}));
  readMusicPack().then(pack=>{if(!generation){cache=pack;describe();}}).catch(error=>{if(!generation)status.textContent=error.message;});
}
