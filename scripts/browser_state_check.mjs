// Exercise real menu commands and the persistent state slot through a page reopen.
import assert from 'node:assert/strict';
export async function verifyStateSlots({inPage,command,closeSettings,click,poll,reopen,key,report}){
  async function useSlot(slot,action){
    await command('config','saves');
    await inPage(number=>{
      const selector=document.querySelector('[data-pref="stateSlot"]');
      selector.value=String(number);
      selector.dispatchEvent(new Event('change',{bubbles:true}));
    },slot);
    await click('[data-command="quick-'+action+'"]');
    const expected=(action==='save'?'Saved state to slot ':'Loaded state from slot ')+slot+'.';
    await poll(()=>inPage(message=>document.querySelector('#save-status').textContent===message,expected),expected);
    await closeSettings();
  }
  await inPage(()=>dkcDebug.runFrames(600));
  const first=await inPage(()=>dkcDebug.frameHash());
  const focusScreen=()=>inPage(()=>document.querySelector('#screen').focus());
  const savedFrame=()=>inPage(async()=>(await (await import('./storage.js')).loadStateSlot(1))?.frameCount??null);
  await focusScreen();await key('u','KeyU',85);
  await poll(async()=>(await savedFrame())===first.frameCount,'keyboard Quick Save');
  await inPage(()=>dkcDebug.runFrames(45));
  const second=await inPage(()=>dkcDebug.frameHash());
  assert.notEqual(first.sha256,second.sha256);
  await command('config','options');
  await key('u','KeyU',85);await key('i','KeyI',73);
  assert.deepEqual(await inPage(()=>dkcDebug.frameHash()),second);
  assert.equal(await savedFrame(),first.frameCount);
  await closeSettings();
  await focusScreen();await key('i','KeyI',73);
  await poll(()=>inPage(frame=>dkcDebug.status().frameCount===frame,first.frameCount),'keyboard Quick Load');
  assert.deepEqual(await inPage(()=>dkcDebug.frameHash()),first);
  await inPage(()=>dkcDebug.runFrames(45));
  const selectSource=mode=>inPage(value=>{
    const el=document.querySelector('#input-source');el.value=value;
    el.dispatchEvent(new Event('change',{bubbles:true}));
  },mode);
  await command('config','controllers');await selectSource('gamepad');
  await poll(()=>inPage(()=>dkcDebug.keyboard().mode==='gamepad'),'keyboard disconnected from both ports');
  await closeSettings();await focusScreen();await key('u','KeyU',85);await key('i','KeyI',73);
  assert.deepEqual(await inPage(()=>dkcDebug.frameHash()),second);
  assert.equal(await savedFrame(),first.frameCount);
  await command('config','controllers');await selectSource('keyboard');
  await poll(()=>inPage(()=>dkcDebug.keyboard().mode==='keyboard'),'keyboard restored');
  await closeSettings();
  report.checks.push('Focused keyboard shortcuts save and restore the selected slot. Settings focus and disconnecting the keyboard from both ports block both shortcuts.');
  await useSlot(5,'save');
  await inPage(()=>dkcDebug.runFrames(15));
  const continuation=await inPage(()=>dkcDebug.frameHash());

  await reopen();
  await useSlot(5,'load');
  assert.deepEqual(await inPage(()=>dkcDebug.frameHash()),second);
  await inPage(()=>dkcDebug.runFrames(15));
  assert.deepEqual(await inPage(()=>dkcDebug.frameHash()),continuation);
  await useSlot(1,'load');
  assert.deepEqual(await inPage(()=>dkcDebug.frameHash()),first);
  await inPage(()=>dkcDebug.runFrames(45));
  assert.deepEqual(await inPage(()=>dkcDebug.frameHash()),second);
  report.checks.push('Slots 1 and 5 independently restored both exact frames and their continuations after reopening.');

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
}
