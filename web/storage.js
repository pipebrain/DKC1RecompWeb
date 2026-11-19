const KEY='dkc1-usa-v1.0';
let opening;
function open() {
  if(!opening)opening=new Promise((resolve,reject)=>{
    const request=indexedDB.open('dkc-browser-saves',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('sram');
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
    request.onblocked=()=>reject(new Error('Save database is blocked by another tab.'));
  });
  return opening;
}
export async function loadSave() {
  const db=await open();
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction('sram','readonly');
    const request=transaction.objectStore('sram').get(KEY);
    request.onsuccess=()=>resolve(request.result || null);
    request.onerror=()=>reject(request.error);
  });
}
export async function storeSave(buffer) {
  if(buffer.byteLength!==2048)throw new Error('Cartridge SRAM must be exactly 2,048 bytes.');
  const db=await open();
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction('sram','readwrite');
    transaction.objectStore('sram').put(buffer,KEY);
    transaction.oncomplete=()=>resolve();
    transaction.onerror=()=>reject(transaction.error);
    transaction.onabort=()=>reject(transaction.error || new Error('Save transaction aborted.'));
  });
}
