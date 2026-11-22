const KEY='dkc1-usa-v1.0';
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
export async function loadSave() {
  const db=await open();
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction('sram','readonly');
    const request=transaction.objectStore('sram').get(KEY);
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
export async function storeSave(buffer,expected) {
  if(!validSave(buffer))throw new Error('Cartridge SRAM must be exactly 2,048 bytes.');
  const db=await open();
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction('sram','readwrite',{durability:'strict'});
    const store=transaction.objectStore('sram');
    let conflict;
    transaction.oncomplete=()=>resolve();
    transaction.onabort=()=>reject(conflict||transaction.error||new Error('Save transaction aborted.'));
    if(expected===undefined){store.put(buffer,KEY);return;}
    const read=store.get(KEY);
    read.onsuccess=()=>{
      if(sameSave(read.result,buffer))return;
      if(sameSave(read.result,expected)){store.put(buffer,KEY);return;}
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

export function setRememberRom(enabled, image) {
  return romTransaction('readwrite', store => {
    store.put(enabled, 'enabled');
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
