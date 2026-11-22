function saveKey(variant) {
  if (variant === 'stock') return 'dkc1-usa-v1.0';
  if (variant === 'dixie') return 'dkc1-dixie-v1.0';
  throw new Error('Unknown cartridge variant.');
}
let opening;
function open() {
  if(opening)return opening;
  opening=new Promise((resolve,reject)=>{
    const request=indexedDB.open('dkc-browser-saves',1);
    let blocked=false;
    request.onupgradeneeded=()=>request.result.createObjectStore('sram');
    request.onsuccess=()=>{
      const db=request.result;
      if(blocked){db.close();return;}
      db.onversionchange=()=>{db.close();opening=undefined;};
      db.onclose=()=>{opening=undefined;};
      resolve(db);
    };
    request.onerror=()=>reject(request.error);
    request.onblocked=()=>{blocked=true;reject(new Error('Save database is blocked by another tab.'));};
  }).catch(error=>{
    opening=undefined;
    throw error;
  });
  return opening;
}
function validSave(buffer){return buffer instanceof ArrayBuffer&&buffer.byteLength===2048;}
function sameSave(left,right){
  if(left===undefined)return right===null;
  if(!validSave(left)||!validSave(right))return false;
  const other=new Uint8Array(right);
  return new Uint8Array(left).every((value,index)=>value===other[index]);
}
export async function loadSave(variant='stock') {
  const key=saveKey(variant);
  const db=await open();
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction('sram','readonly');
    const request=transaction.objectStore('sram').get(key);
    transaction.oncomplete=()=>{
      if(request.result===undefined)resolve(null);
      else if(validSave(request.result))resolve(request.result);
      else reject(new Error('The stored cartridge save is not a 2,048-byte SRAM file.'));
    };
    transaction.onabort=()=>reject(transaction.error||new Error('Save read aborted.'));
  });
}
// Normal play supplies the last committed bytes. An explicit .srm file
// import may replace the slot even if another tab has since written to it.
export async function storeSave(buffer,expected,variant='stock') {
  const key=saveKey(variant);
  if(!validSave(buffer))throw new Error('Cartridge SRAM must be exactly 2,048 bytes.');
  const db=await open();
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction('sram','readwrite',{durability:'strict'});
    const store=transaction.objectStore('sram');
    let conflict;
    transaction.oncomplete=()=>resolve();
    transaction.onabort=()=>reject(conflict||transaction.error||new Error('Save transaction aborted.'));
    if(expected===undefined){store.put(buffer,key);return;}
    const read=store.get(key);
    read.onsuccess=()=>{
      if(sameSave(read.result,buffer))return;
      if(sameSave(read.result,expected)){store.put(buffer,key);return;}
      conflict=new Error('The cartridge save in this browser differs from the one this tab loaded.');
      transaction.abort();
    };
  });
}

// ROM retention has its own database so forgetting a cartridge never touches SRAM.
async function romTransaction(mode, operation) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('dkc-browser-rom', 1);
    let blocked = false;
    request.onupgradeneeded = () => request.result.createObjectStore('cartridge');
    request.onblocked = () => {
      blocked = true;
      reject(new Error('Close other player tabs and try again.'));
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => blocked ? request.result.close() : resolve(request.result);
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('cartridge', mode);
      const result = operation(transaction.objectStore('cartridge'));
      transaction.oncomplete = () => resolve(result());
      transaction.onabort = () => reject(transaction.error || new Error('ROM storage transaction was interrupted.'));
    });
  } finally {
    db.close();
  }
}

export function readRememberedRom() {
  return romTransaction('readonly', store => {
    const enabled = store.get('enabled');
    const image = store.get('image');
    return () => ({enabled: enabled.result !== false, image: image.result});
  });
}

export function setRememberRom(enabled, image, finishConfig=false) {
  return romTransaction('readwrite', store => {
    store.put(enabled, 'enabled');
    if(finishConfig)store.delete('pending-config');
    if (!enabled) store.delete('image');
    else if (image) store.put(image, 'image');
    return () => enabled;
  });
}

export function rememberPickedRom(image) {
  return romTransaction('readwrite', store => {
    // A different tab may have turned remembering off since this tab opened.
    const enabled = store.get('enabled');
    enabled.onsuccess = () => {
      if (enabled.result !== false) store.put(image, 'image');
    };
    return () => enabled.result !== false;
  });
}

// Quick states belong to a particular core version and cartridge variant.
async function stateSlot(variant,slot,write){
  if(!['stock','dixie'].includes(variant)||!Number.isInteger(slot)||slot<1||slot>5)throw new Error('Invalid state slot.');
  const key='v0.0.17-web2/'+saveKey(variant)+'/'+slot;
  const db=await new Promise((resolve,reject)=>{
    const open=indexedDB.open('dkc-browser-states',1);
    open.onupgradeneeded=()=>open.result.createObjectStore('slots');
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>resolve(open.result);
  });
  try{
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction('slots',write?'readwrite':'readonly'),store=tx.objectStore('slots');
      const request=write?store.put(write,key):store.get(key);
      tx.oncomplete=()=>resolve(request.result);
      tx.onabort=()=>reject(tx.error||new Error('State storage interrupted.'));
    });
  }finally{db.close();}
}
export const loadStateSlot=(variant,slot)=>stateSlot(variant,slot);
export const storeStateSlot=(variant,slot,snapshot)=>stateSlot(variant,slot,snapshot);

// The same IndexedDB transaction that applies the ROM setting removes the
// import journal. A journal present on restart means the import never committed.
export function readConfigJournal(){
  return romTransaction('readonly',store=>{
    const get=store.get('pending-config');return ()=>get.result;
  });
}
export function writeConfigJournal(entries){
  return romTransaction('readwrite',store=>{
    if(entries)store.put(entries,'pending-config');else store.delete('pending-config');
    return ()=>{};
  });
}
export function readRememberPreference(){
  return romTransaction('readonly',store=>{
    const get=store.get('enabled');return ()=>get.result!==false;
  });
}
