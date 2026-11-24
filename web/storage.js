// Use the original stock keys so Candy saves and Phase 2 state slots carry over.
const CARTRIDGE_KEY = 'dkc1-usa-v1.0';
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
    const request=transaction.objectStore('sram').get(CARTRIDGE_KEY);
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
    if(expected===undefined){store.put(buffer,CARTRIDGE_KEY);return;}
    const read=store.get(CARTRIDGE_KEY);
    read.onsuccess=()=>{
      if(sameSave(read.result,buffer))return;
      if(sameSave(read.result,expected)){store.put(buffer,CARTRIDGE_KEY);return;}
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

const STATE_SLOTS=[1,2,3,4,5];

function stateKey(slot){
  if(!STATE_SLOTS.includes(slot))throw new Error('Invalid state slot.');
  return 'v0.0.17-web2/'+CARTRIDGE_KEY+'/'+slot;
}

async function stateTransaction(mode,operation){
  const db=await new Promise((resolve,reject)=>{
    const open=indexedDB.open('dkc-browser-states',1);
    open.onupgradeneeded=()=>open.result.createObjectStore('slots');
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>resolve(open.result);
  });
  try{
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction('slots',mode);
      tx.onabort=()=>reject(tx.error||new Error('State storage interrupted.'));
      const result=operation(tx.objectStore('slots'));
      tx.oncomplete=()=>resolve(result());
    });
  }finally{db.close();}
}

function readStateSlots(store,onRead=()=>{}){
  const requests=STATE_SLOTS.map(slot=>store.get(stateKey(slot)));
  const values=()=>requests.map(request=>request.result);
  // Requests in one transaction finish in the order they were queued.
  requests.at(-1).onsuccess=()=>onRead(values());
  return values;
}

function stateOrder(snapshot){
  return snapshot.saveOrder??snapshot.savedAt??0;
}

export const loadStateSlots=()=>stateTransaction('readonly',readStateSlots);
export const loadStateSlot=slot=>stateTransaction('readonly',store=>{
  const request=store.get(stateKey(slot));return ()=>request.result;
});
export const storeStateSlot=(slot,snapshot)=>stateTransaction('readwrite',store=>{
  store.add(snapshot,stateKey(slot));return ()=>{};
});
export const deleteStateSlot=slot=>stateTransaction('readwrite',store=>{
  store.delete(stateKey(slot));return ()=>{};
});

export function appendStateSlot(snapshot){
  return stateTransaction('readwrite',store=>{
    let slot=null;
    // Select the empty slot and add the snapshot in one transaction so
    // simultaneous saves cannot compete for the same slot or overwrite one.
    readStateSlots(store,entries=>{
      const index=entries.indexOf(undefined);
      if(index===-1)return;
      const savedAt=snapshot.savedAt??Date.now();
      const newest=entries.reduce((latest,entry)=>entry?Math.max(latest,stateOrder(entry)):latest,0);
      const saveOrder=Math.max(savedAt,newest+1);
      slot=STATE_SLOTS[index];
      store.add({...snapshot,savedAt,saveOrder},stateKey(slot));
    });
    return ()=>slot;
  });
}

export async function loadLatestStateSlot(){
  const entries=await loadStateSlots();
  let latest;
  for(const [index,snapshot] of entries.entries()){
    // Undated older states have no chronological metadata. Use the higher
    // slot as the tie breaker when the available ordering information agrees.
    if(snapshot&&(!latest||stateOrder(snapshot)>=stateOrder(latest.snapshot)))
      latest={slot:STATE_SLOTS[index],snapshot};
  }
  return latest;
}

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
