// Exercise real menu commands and the persistent state slot through a page reopen.
import assert from 'node:assert/strict';
export async function verifyAssist({inPage,command,closeSettings,click,poll,reopen,report}){
  await command('config','speed');
  await inPage(()=>{
    const box=document.querySelector('[data-pref="assist"]');box.checked=true;box.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await closeSettings();
  await inPage(()=>dkcDebug.runFrames(600));
  const anchor=await inPage(()=>dkcDebug.frameHash());
  await command('config','saves');await click('[data-command="quick-save"]');
  await poll(()=>inPage(()=>document.querySelector('#save-status').textContent.includes('Saved state to slot')),'store quick state');
  await closeSettings();await inPage(()=>dkcDebug.runFrames(15));const expected=await inPage(()=>dkcDebug.frameHash());
  await command('config','speed');await click('[data-command="rewind-step"]');
  await poll(()=>inPage(()=>dkcDebug.status().frameCount<615),'rewind game');
  const rewound=await inPage(()=>dkcDebug.status().frameCount);
  await click('[data-command="frame-step"]');await poll(()=>inPage(n=>dkcDebug.status().frameCount===n,rewound+1),'advance paused frame');
  await closeSettings();await reopen();
  await command('config','saves');await click('[data-command="quick-load"]');
  await poll(()=>inPage(n=>dkcDebug.status().frameCount===n,anchor.frameCount),'load previous session’s state');
  assert.deepEqual(await inPage(()=>dkcDebug.frameHash()),anchor);
  await closeSettings();await inPage(()=>dkcDebug.runFrames(15));
  assert.deepEqual(await inPage(()=>dkcDebug.frameHash()),expected);
  report.checks.push('Save State survived reopening the player, restored the exact frame, and reproduced its continuation. Rewind and paused frame advance passed.');

  // Match an interrupted operation at each boundary seen by the shipping app.
  const rollback=await inPage(async()=>{
    const prefs=await import('./settings.js'),storage=await import('./storage.js');
    const {KEYBOARD_STORAGE_KEY}=await import('./keyboard-profiles.js');
    const {CONTROLLER_STORAGE_KEY}=await import('./gamepad-profiles.js');
    const keys=[prefs.PLAYER_KEY,KEYBOARD_STORAGE_KEY,CONTROLLER_STORAGE_KEY];
    const before=keys.map(key=>localStorage.getItem(key));
    const config=prefs.makeConfig({...prefs.readPlayer(),volume:17},JSON.parse(before[1]),JSON.parse(before[2]),false);
    config.keyboard.mode='both';
    const setter=Storage.prototype.setItem;
    let message;
    try{
      Storage.prototype.setItem=function(key,value){
        if(key===KEYBOARD_STORAGE_KEY)throw new DOMException('Storage quota test','QuotaExceededError');
        return setter.call(this,key,value);
      };
      await prefs.storeConfig(config,null);
    }catch(error){message=error.message;}
    finally{Storage.prototype.setItem=setter;}
    const rolledBack=keys.every((key,index)=>localStorage.getItem(key)===before[index]);
    const remembered=await storage.readRememberPreference();
    const key=keys[0],after=JSON.stringify({...prefs.readPlayer(),volume:17});
    await storage.writeConfigJournal([{key,before:before[0],after}]);
    localStorage.setItem(key,after);
    return {message,rolledBack,remembered,original:before[0]};
  });
  assert.equal(rollback.message,'Storage quota test');assert(rollback.rolledBack);assert(rollback.remembered);
  await reopen();
  assert.equal(await inPage(async()=>localStorage.getItem((await import('./settings.js')).PLAYER_KEY)),rollback.original);
  report.checks.push('A partial localStorage write rolled back with ROM retention intact. Reopening the player recovered an interrupted config import.');

  await command('config','options');
  await inPage(()=>{
    const box=document.querySelector('[data-pref="diagnostics"]');box.checked=true;box.dispatchEvent(new Event('change',{bubbles:true}));
    const create=URL.createObjectURL;
    URL.createObjectURL=function(blob){
      if(blob.type==='application/json')window.reproForCheck=blob.text().then(JSON.parse);
      return create.call(this,blob);
    };
  });
  await closeSettings();await inPage(()=>dkcDebug.runFrames(12));
  await command('config','options');await click('[data-command="export-repro"]');
  const trace=await poll(()=>inPage(async()=>{
    const value=await window.reproForCheck;
    if(value)return {format:value.schema,elapsed:value.endFrame-value.startFrame,inputs:value.inputs,
      bytes:atob(value.checkpointBase64).length,frame:value.fingerprints.frame_sha256};
  }),'exported player repro');
  assert.equal(trace.format,'dkc.web-repro');assert(trace.bytes>200000);
  assert.deepEqual(trace.inputs,[{buttons:0,count:12}]);assert.equal(trace.elapsed,12);
  assert.equal(trace.frame,(await inPage(()=>dkcDebug.frameHash())).sha256);
  await inPage(()=>document.querySelector('[data-pref="diagnostics"]').click());
  await closeSettings();
  report.checks.push('The Options sheet exported a local checkpoint and a matching 12-frame input trace.');
}
