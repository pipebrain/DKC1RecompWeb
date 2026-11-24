// Browser regression checks for the shipping shell, using the real stock core.
import assert from 'node:assert/strict';

export async function verifyUnringed({evaluate,poll,screenshot,send,reopen,chooseDkmFile,rom,report}){
  const run=(action,...args)=>evaluate(`(${action})(...${JSON.stringify(args)})`);
  const click=selector=>run(value=>{
    const element=document.querySelector(value);
    if(!element||element.disabled||!element.getClientRects().length)throw new Error('Unavailable '+value);
    element.click();
  },selector);
  const wait=(action,description)=>poll(()=>run(action),description);
  async function rail(command){
    await click('#open-menu');
    await click(`#navigation-rail [data-command="${command}"]`);
  }
  const set= (key,value,phase='change')=>run((name,next,event)=>{
    const element=document.querySelector(`[data-pref="${name}"]`);
    if(element.type==='checkbox')element.checked=next;
    else element.value=next;
    element.dispatchEvent(new Event(event,{bubbles:true}));
  },key,value,phase);
  const inspect=()=>run(()=>{
    const bar=document.querySelector('.app-bar').getBoundingClientRect();
    const fps=document.querySelector('.fps-counter'),frame=document.querySelector('#game').getBoundingClientRect();
    const page=document.querySelector('main > .page:not([hidden])'),main=document.querySelector('main');
    const frameRect=[frame.left,frame.top,frame.width,frame.height];
    return {barBottom:bar.bottom,fpsTop:fps.getBoundingClientRect().top,fpsRight:fps.getBoundingClientRect().right,
      fpsHidden:fps.hidden,fpsZ:Number(getComputedStyle(fps).zIndex),fpsOpacity:getComputedStyle(fps).opacity,
      frameRect, y:scrollY,width:innerWidth,height:innerHeight,
      pageWidth:page?.getBoundingClientRect().width,mainWidth:main.getBoundingClientRect().width,
      pageHeight:page?.getBoundingClientRect().height,mainHeight:main.getBoundingClientRect().height,
      pageZ:page&&Number(getComputedStyle(page).zIndex),pageBackground:page&&getComputedStyle(page).backgroundColor};
  });
  const settingsReady=()=>wait(()=>!document.querySelector('#settings').hidden,'Settings page');
  assert.deepEqual(await run(()=>[document.title,document.documentElement.dataset.appearance,getComputedStyle(document.body).backgroundColor]),
    ['DKC1R Web','black','rgb(0, 0, 0)']);
  assert.equal(await run(()=>document.querySelector('#game-overlay').textContent.trim()),'Load ROM');
  await chooseDkmFile('open-rom',rom,'rom-file');
  await wait(()=>dkcDebug.status().loaded&&!dkcDebug.status().loading,'selected ROM');
  assert.equal(await run(()=>document.querySelector('#game-overlay').textContent.trim()),'Start Game');
  await click('#game-overlay');
  await wait(()=>dkcDebug.status().running,'start from the game overlay');
  assert.equal(await run(()=>document.querySelector('#start-game span').textContent),'Pause Game');
  assert.equal(await run(()=>document.querySelector('#start-game use').getAttribute('href')),'#pause-icon');
  await rail('start-game');
  await wait(()=>!dkcDebug.status().running&&!dkcDebug.status().playbackBusy&&document.activeElement.id==='screen','pause from the rail');
  assert.equal(await run(()=>document.querySelector('#game-overlay').textContent.trim()),'Resume Game');
  assert.equal(await run(()=>document.activeElement.id),'screen','Pausing returns focus to the game for mapped Start');
  assert.equal(await run(()=>getComputedStyle(document.activeElement).outlineStyle),'none','The focused game screen has no outline');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await wait(()=>dkcDebug.status().running,'mapped keyboard Start resumes');
  await rail('start-game');
  await wait(()=>!dkcDebug.status().running,'pause again');
  await click('#game-overlay');
  await wait(()=>dkcDebug.status().running,'resume from the game overlay');
  await rail('reset-game');
  await wait(()=>!dkcDebug.status().loading&&dkcDebug.status().frameCount===0&&dkcDebug.status().message==='Game reloaded.','reload from the rail');
  report.checks.push('ROM picker, Start and Resume overlays, rail Pause, mapped Enter resume, and Reload Game exercised in Chrome.');

  for(const [width,height] of [[390,844],[844,390],[320,568],[667,320],[960,1150]]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width!==960});
    const game=await inspect();
    await rail('settings');
    await settingsReady();
    const before=await inspect();
    assert.deepEqual(before.frameRect,game.frameRect,'Game position jumped entering settings');
    await run(()=>document.querySelector('[data-pref=showFps]').scrollIntoView({block:'center'}));
    await set('showFps',true);
    const on=await inspect();
    assert.equal(on.fpsHidden,false,'FPS counter should show while still in Settings');
    assert(on.fpsTop>=on.barBottom+7,'FPS counter overlaps the app bar');
    assert(on.fpsZ<on.pageZ,'FPS counter is in front of the Settings surface');
    assert.equal(on.pageWidth,on.mainWidth);
    assert.equal(on.pageHeight,on.mainHeight);
    await run(()=>window.scrollTo(0,document.documentElement.scrollHeight));
    const bottom=await inspect();
    assert(bottom.y>0,'Settings did not scroll');
    assert.equal(bottom.fpsTop,on.fpsTop,'FPS counter scrolled out of the viewport');
    assert.deepEqual(bottom.frameRect,game.frameRect,'Game position scrolled with Settings');
    await screenshot(`settings-${width}x${height}.png`);
    await click('#settings-done');
    await wait(()=>document.querySelector('#settings').hidden,'return to game');
    const after=await inspect();
    assert.deepEqual(after.frameRect,game.frameRect);
    assert.equal(after.fpsTop,on.fpsTop);
    assert.equal(after.fpsRight,on.fpsRight);
  }
  report.checks.push('Five phone/desktop viewports keep the game stationary and show FPS below the app bar, behind Settings, while scrolling.');

  await send('Emulation.clearDeviceMetricsOverride');
  await rail('settings');
  await settingsReady();
  await click('[data-detail="options"]');
  await wait(()=>!document.querySelector('[data-settings-pane="options"]').hidden,'Advanced system');
  const previous=await inspect();
  await set('uiBackgroundOpacity',30,'input');
  const live=await inspect();
  assert.notEqual(live.pageBackground,previous.pageBackground);
  assert.equal(await run(async()=>(await import('./settings.js')).readPlayer().uiBackgroundOpacity),80);
  await set('uiBackgroundOpacity',30);
  await wait(()=>document.querySelector('#snackbar-host').textContent.includes('UI background opacity'),'saved slider notification');
  assert.equal(await run(async()=>(await import('./settings.js')).readPlayer().uiBackgroundOpacity),30);
  await set('notificationMax',2);
  await set('verboseNotifications',false);
  assert.equal(await run(()=>document.querySelectorAll('.snackbar').length),2,'Newest notification must remove the oldest');
  assert.equal(await run(()=>document.querySelector('.snackbar:last-child .snackbar-context')),null);
  assert(await run(()=>document.querySelector('[data-pref="notificationsEnabled"]').checked),'Notifications default on');
  await click('[data-pref="notificationsEnabled"]');
  assert.equal(await run(()=>document.querySelectorAll('[data-notification-option]:disabled').length),4);
  assert.equal(await run(()=>document.querySelectorAll('.snackbar').length),0,'Turning off notifications clears active messages');
  await set('uiBackgroundOpacity',31);
  await set('uiBackgroundOpacity',30);
  assert.equal(await run(()=>document.querySelectorAll('.snackbar').length),0,'Settings changes stay quiet with notifications off');
  assert.equal(await run(async()=>(await import('./settings.js')).readPlayer().notificationsEnabled),false);
  await click('[data-pref="notificationsEnabled"]');
  assert.equal(await run(()=>document.querySelectorAll('[data-notification-option]:disabled').length),0);
  assert.equal(await run(()=>document.querySelector('[data-pref="notificationMax"]').value),'2');
  assert.equal(await run(()=>document.querySelector('[data-pref="verboseNotifications"]').checked),false);
  await click('#settings-done');
  await wait(()=>!document.querySelector('#settings-home').hidden,'back to Settings');
  const slider=await run(()=>document.querySelector('[data-pref=volume][type=range]').value);
  await set('volume',24,'input');
  assert.equal(await run(()=>document.querySelector('[data-pref=volume][type=number]').value),'24');
  assert.equal(await run(async()=>(await import('./settings.js')).readPlayer().volume),Number(slider));
  await set('volume',24);
  await set('appearance','light');
  assert.equal(await run(()=>document.documentElement.dataset.appearance),'light');
  await set('appearance','black');
  await set('displayScale','1');
  assert.equal(await run(()=>document.querySelector('#scale-resolution').textContent),'256 × 224');
  await set('displayScale','custom');
  await set('customScale',3);
  assert.equal(await run(()=>document.querySelector('#scale-resolution').textContent),'768 × 672');
  await set('displayScale','fit');
  await click('#settings-done');
  await wait(()=>document.querySelector('#settings').hidden,'exit Settings');
  for(const [command,id] of [['about','about'],['cheats','cheats'],['save-states','saves']]){
    await rail(command);
    await wait(()=>document.querySelector('main > .page:not([hidden])'),command);
    const actual=await inspect();
    assert.equal(actual.pageWidth,actual.mainWidth);
    assert(actual.pageZ>actual.fpsZ);
    assert.match(actual.pageBackground,/0\.3|30%/);
    if(id==='about')await wait(()=>document.querySelector('#about-content a[href*="DKC1Recomp"]'),'About credits');
    if(id==='cheats'){
      assert.equal(await run(()=>document.querySelectorAll('.warp-entry').length),7);
      await click('.warp-entry');
      assert.match(await run(()=>document.querySelector('.snackbar:last-child').textContent),/Warp unavailable/);
    }
    await click('#settings-done');
    await wait(()=>!document.querySelector('main > .page:not([hidden])'),'leave '+command);
  }
  report.checks.push('Theme, live sliders, persisted settings, notification switch and preferences, scaling, page opacity, About, and unavailable warp actions exercised.');

  await rail('fullscreen');
  await wait(()=>document.fullscreenElement?.id==='game'&&document.querySelector('#game > #fps-counter'),'only the screen enters fullscreen');
  assert(await run(()=>document.querySelector('#game').contains(document.querySelector('#fps-counter'))),'HUD stayed outside fullscreen');
  await run(()=>document.exitFullscreen());
  await wait(()=>!document.fullscreenElement&&document.querySelector('main > #fps-counter'),'leave fullscreen');
  report.checks.push('Native browser fullscreen contains only the game frame and its HUD.');

  await rail('quick-load');
  await wait(()=>document.querySelector('#snackbar-host').textContent.includes('No save states yet.'),'empty Quick Load result');
  await run(()=>dkcDebug.runFrames(600));
  const saved=await run(()=>dkcDebug.frameHash());
  await rail('save-states');
  await wait(()=>!document.querySelector('#add-save').disabled,'save-state card insertion');
  await click('#add-save');
  await wait(()=>document.querySelector('.load-card img')?.naturalWidth===128,'thumbnail from the saved framebuffer');
  assert.equal(await run(()=>document.querySelector('.load-card time').dateTime.length>0),true);
  await screenshot('save-card.png');
  await run(async()=>{
    const storage=await import('./storage.js');
    const {savedAt,saveOrder,thumbnail,...legacy}=await storage.loadStateSlot(1);
    await storage.storeStateSlot(2,legacy);
  });
  await reopen();
  assert.equal(await run(()=>dkcDebug.status().loaded),true,'Remembered ROM should automatically load');
  await rail('save-states');
  await wait(()=>document.querySelectorAll('.load-card').length===2,'persistent cards after browser reload');
  assert.equal(await run(()=>document.querySelector('[aria-label="Load slot 2"] img').hidden),true);
  await click('[aria-label="Load slot 2"]');
  await wait(()=>document.querySelector('#saves').hidden,'load a save state from its card');
  assert.deepEqual(await run(()=>dkcDebug.frameHash()),saved);
  await run(()=>dkcDebug.runFrames(15));
  const newer=await run(()=>dkcDebug.frameHash());
  assert.notDeepEqual(newer,saved);
  await rail('quick-save');
  await wait(()=>dkcDebug.status().saveMessage==='Saved state to slot 3.','rail Quick Save takes the first empty slot');
  await run(()=>dkcDebug.runFrames(30));
  await rail('quick-load');
  await wait(()=>dkcDebug.status().saveMessage==='Loaded state from slot 3.','rail Quick Load restores the newest slot');
  assert.deepEqual(await run(()=>dkcDebug.frameHash()),newer);

  const additional=await run(async()=>{
    const storage=await import('./storage.js'),snapshot=await storage.loadStateSlot(3);
    return Promise.all([storage.appendStateSlot(snapshot),storage.appendStateSlot(snapshot)]);
  });
  assert.deepEqual(additional.sort(),[4,5],'Concurrent saves must allocate separate slots');
  const listSaves=()=>run(async()=>(await (await import('./storage.js')).loadStateSlots()).map(state=>
    state&&[state.frameCount,state.sha256,state.saveOrder]));
  const occupied=await listSaves();
  assert.deepEqual(occupied.map(([frame])=>frame),[saved.frameCount,saved.frameCount,newer.frameCount,newer.frameCount,newer.frameCount]);
  assert.equal(occupied[0][1],occupied[1][1]);
  assert.equal(occupied[2][1],occupied[3][1]);
  assert.equal(occupied[2][1],occupied[4][1]);
  await run(()=>dkcDebug.runFrames(30));
  await rail('quick-save');
  await wait(()=>document.querySelector('#snackbar-host').textContent.includes('All save-state slots are in use.'),'full Quick Save result');
  assert.deepEqual(await listSaves(),occupied,'A full Quick Save preserves all stored snapshots');
  await rail('save-states');
  await wait(()=>document.querySelector('.delete-card'),'delete saved card');
  await click('.delete-card');
  await run(()=>new Promise(resolve=>{
    const dialog=document.querySelector('#delete-state-dialog');
    dialog.addEventListener('close',()=>resolve(true),{once:true});
    dialog.querySelector('[value="cancel"]').click();
  }));
  assert.equal(await run(()=>document.querySelectorAll('.load-card').length),5);
  await click('.delete-card');
  await click('#delete-state-dialog [value="delete"]');
  await wait(()=>!document.querySelector('[aria-label="Load slot 1"]'),'delete state from browser storage');
  assert.equal(await run(async()=>Boolean(await (await import('./storage.js')).loadStateSlot(1))),false);
  await click('#settings-done');
  const reused=await run(()=>dkcDebug.frameHash());
  await rail('quick-save');
  await wait(()=>dkcDebug.status().saveMessage==='Saved state to slot 1.','Quick Save reuses the freed slot');
  await run(()=>dkcDebug.runFrames(15));
  await rail('quick-load');
  await wait(()=>dkcDebug.status().saveMessage==='Loaded state from slot 1.','Quick Load finds the newest state in a reused slot');
  assert.deepEqual(await run(()=>dkcDebug.frameHash()),reused);
  report.checks.push('Save-state cards, exact frame restoration, concurrent slot allocation, full storage protection, and Quick Load after slot reuse exercised.');

  const key=(type,key,code)=>send('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:key.toUpperCase().charCodeAt(0)});
  const tap=async(label,code)=>{
    await key('keyDown',label,code);await key('keyUp',label,code);
  };
  const change=(selector,value)=>run((selector,value)=>{
    const element=document.querySelector(selector);element.value=value;
    element.dispatchEvent(new Event('change',{bubbles:true}));
  },selector,value);
  const chooseProfile=(selector,name)=>run((selector,name)=>{
    const element=document.querySelector(selector);
    element.value=[...element.options].find(option=>option.text===name).value;
    element.dispatchEvent(new Event('change',{bubbles:true}));
  },selector,name);
  function setBinding(label){return click(`#profile-mappings [aria-label="Set ${label}"]`);}
  function openProfile(name){return click(`#profile-list [data-profile="${name}"]`);}
  function setPad(port,button,pressed){return run((port,button,pressed)=>{
    window.testPads[port].buttons[button]={pressed,value:Number(pressed)};
  },port,button,pressed);}
  async function enterProfiles(){
    await rail('settings');await settingsReady();
    await click('[data-detail="controllers"]');
    await wait(()=>!document.querySelector('[data-detail="Input Profiles"]').hidden,'Input Profiles list');
  }
  async function backToProfiles(){
    await click('#settings-done');
    await wait(()=>!document.querySelector('[data-detail="Input Profiles"]').hidden,'return to Input Profiles list');
  }
  async function submitName(name){
    await run(name=>{
      const field=document.querySelector('#profile-name');field.value=name;
      field.dispatchEvent(new Event('input',{bubbles:true}));
    },name);
    await click('#new-profile [type="submit"]');
    await poll(()=>run(expected=>document.querySelector('#app-title').textContent===expected,name),'saved profile '+name);
  }
  async function createProfile(name){
    await click('#add-profile');await submitName(name);
  }
  const savedBinding=(action,label)=>wait(
    ()=>!document.querySelector('#binding-dialog').open,'binding saved').then(async()=>{
      assert.match(await run(action=>document.querySelector(`[data-input="${action}"] .supporting`).textContent,action),label);
    });
  function mouseEvent(type,button,x,y){
    return send('Input.dispatchMouseEvent',{type,button,x,y,clickCount:1});
  }

  await run(()=>{
    window.testRumbleCalls=[];
    window.testPads=['Test Bluetooth controller','Test raw controller'].map((id,index)=>({
      id,index,connected:true,mapping:index===0?'standard':'',
      axes:index===0?[0,0,0,0]:[0,0,0,0,0,0,0,0,0,3.285],
      buttons:Array.from({length:17},()=>({pressed:false,value:0})),
      vibrationActuator:index===0?{effects:['dual-rumble'],playEffect:async(effect,options)=>{
        window.testRumbleCalls.push({effect,options});return 'complete';
      }}:null,
    }));
    Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>window.testPads});
  });
  await enterProfiles();
  assert.deepEqual(await run(()=>[...document.querySelectorAll('#profile-list button')].map(button=>button.textContent.trim())),['Keyboard']);
  await openProfile('Keyboard');
  await wait(()=>!document.querySelector('[data-detail="Profile"]').hidden,'Keyboard profile');
  assert.deepEqual(await run(()=>[...document.querySelectorAll('#profile-mappings strong')].map(title=>title.textContent)),
    ['B','Y','Select','Start','Up','Down','Left','Right','A','X','L','R']);
  assert.equal(await run(()=>document.querySelector('[data-input="B"] .supporting').textContent),'Keyboard · Z');
  assert.equal(await run(()=>document.querySelector('#rumble-advanced').hidden),true);
  for(const [width,height] of [[390,844],[844,390]]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
    const fitted=await run(()=>[...document.querySelectorAll('#profile-mappings .mapping-row')].every(row=>{
      const bounds=row.getBoundingClientRect(),actions=row.querySelector('.mapping-actions').getBoundingClientRect();
      const summary=row.querySelector('.mapping-summary').getBoundingClientRect();
      return summary.right<=actions.left&&actions.right<=bounds.right&&bounds.right<=innerWidth;
    }));
    assert(fitted,'Profile labels and Set/Clear should fit side by side at '+width+'×'+height);
    await screenshot(`input-profile-${width}x${height}.png`);
  }
  await send('Emulation.clearDeviceMetricsOverride');
  await setBinding('B');
  assert.equal(await run(()=>document.querySelector('#binding-title').textContent),'Set B');
  assert.match(await run(()=>getComputedStyle(document.querySelector('#settings')).filter),/blur/);
  await click('#cancel-binding');
  await savedBinding('B',/Keyboard · Z/);
  await backToProfiles();

  await createProfile('Mixed');
  await setBinding('B');await tap('m','KeyM');await savedBinding('B',/Keyboard · M/);
  await setBinding('X');await tap('m','KeyM');await savedBinding('X',/Keyboard · M/);
  await setBinding('R');
  const [dialogX,dialogY]=await run(()=>{
    const box=document.querySelector('#binding-dialog').getBoundingClientRect();
    return [box.left+12,box.bottom-18];
  });
  await mouseEvent('mousePressed','middle',dialogX,dialogY);
  await mouseEvent('mouseReleased','middle',dialogX,dialogY);
  await savedBinding('R',/Mouse · Button 1/);
  await setBinding('Y');await setPad(0,2,true);await savedBinding('Y',/Gamepad 1 · Test Bluetooth controller · Button 2/);
  await setPad(0,2,false);
  await click('#stomp-rumble');
  await run(()=>{
    const slider=document.querySelector('#rumble-low-slider');slider.value='33';
    slider.dispatchEvent(new Event('input',{bubbles:true}));
  });
  assert.equal(await run(()=>document.querySelector('#rumble-advanced input[aria-label="Low motor percentage"]').value),'33');
  assert.equal(await run(async()=>JSON.parse(localStorage.getItem((await import('./input-profiles.js')).INPUT_PROFILES_KEY)).profiles.find(profile=>profile.name==='Mixed').rumble[1]),80);
  await change('#rumble-low-slider',33);
  await click('#preview-stomp');
  await wait(()=>window.testRumbleCalls.length===1,'dual-rumble API receives test');
  assert.deepEqual(await run(()=>window.testRumbleCalls[0]),{
    effect:'dual-rumble',options:{duration:140,startDelay:0,strongMagnitude:0.33,weakMagnitude:1},
  });
  await click('#rename-profile');await submitName('Mixed controls');
  await backToProfiles();

  await createProfile('Raw D-pad');
  for(const [action,value] of [['Up',-1],['Right',-0.429]]){
    await setBinding(action);
    await run(value=>window.testPads[1].axes[9]=value,value);
    await savedBinding(action,/Hat axis 9/);
    await run(()=>window.testPads[1].axes[9]=3.285);
  }
  await click('#stomp-rumble');
  await click('#preview-stomp');
  await wait(()=>/no rumble output/.test(document.querySelector('.snackbar:last-child')?.textContent),'unsupported actuator reported');
  await backToProfiles();
  await click('#settings-done');await wait(()=>!document.querySelector('#settings-home').hidden,'Settings home');
  await chooseProfile('#player-one','Mixed controls');await chooseProfile('#player-two','Raw D-pad');

  const exported=await run(async()=>{
    const original=HTMLAnchorElement.prototype.click;
    let receive;
    const captured=new Promise(resolve=>{receive=resolve;});
    HTMLAnchorElement.prototype.click=function(){
      if(this.download.endsWith('.settings.json'))receive(fetch(this.href).then(response=>response.json()));
      else original.call(this);
    };
    try{
      document.querySelector('[data-command="save-config"]').click();
      return await Promise.race([captured,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Export never started')),3000))]);
    }finally{HTMLAnchorElement.prototype.click=original;}
  });
  assert.equal(exported.version,4);
  const {players,profiles}=exported.inputProfiles;
  assert.equal(exported.player.uiBackgroundOpacity,30);
  assert.equal(profiles.find(profile=>profile.id===players[0]).name,'Mixed controls');
  assert.equal(profiles.find(profile=>profile.id===players[1]).name,'Raw D-pad');

  await click('#settings-done');await wait(()=>document.querySelector('#settings').hidden,'exit input settings');
  await click('#game-overlay');await wait(()=>dkcDebug.status().running,'play with two assigned profiles');
  const [screenX,screenY]=await run(()=>{
    const box=document.querySelector('#screen').getBoundingClientRect();
    return [box.left+box.width/2,box.top+box.height/2];
  });
  await mouseEvent('mousePressed','middle',screenX,screenY);
  await key('keyDown','m','KeyM');await setPad(0,2,true);
  await run(()=>window.testPads[1].axes[9]=-.714);
  await wait(()=>dkcDebug.status().inputBits===(1|2|512|2048|((16|128)<<12)),'keyboard, mouse, and both gamepads reach the game, including a diagonal');
  await key('keyUp','m','KeyM');
  await mouseEvent('mouseReleased','middle',screenX,screenY);
  await setPad(0,2,false);await run(()=>window.testPads[1].axes[9]=3.285);
  await wait(()=>dkcDebug.status().inputBits===0,'release all inputs');

  await reopen();
  await enterProfiles();
  assert.deepEqual(await run(()=>['#player-one','#player-two'].map(id=>document.querySelector(id).selectedOptions[0].text)),['Mixed controls','Raw D-pad']);
  await openProfile('Raw D-pad');
  await wait(()=>!document.querySelector('[data-detail="Profile"]').hidden,'Raw D-pad profile');
  await click('[aria-label="Clear Up"]');
  assert.equal(await run(()=>document.querySelector('[data-input="Up"] .supporting').textContent),'Unassigned');
  await click('#delete-profile');
  await click('#cancel-delete-profile');
  assert.equal(await run(()=>document.querySelector('#player-two').selectedOptions[0].text),'Raw D-pad');
  await click('#delete-profile');
  await click('#confirm-delete-profile');
  await wait(()=>!document.querySelector('[data-detail="Input Profiles"]').hidden,'back after deletion');
  assert.equal(await run(()=>document.querySelector('#player-two').selectedOptions[0].text),'Disabled');
  assert.equal(await run(()=>document.querySelector('#profile-list [data-profile="Raw D-pad"]')),null);
  await click('#settings-done');await wait(()=>!document.querySelector('#settings-home').hidden,'Settings home after removing profile');

  const retained=['sound','volume','audioDriftCorrection','audioPreroll','pauseWhenInactive','appearance','fullscreenOnStart','stateSlot'];
  const old=await run(async player=>{
    const {defaultKeyboardSettings}=await import('./keyboard-profiles.js');
    const {defaultControllerSettings}=await import('./gamepad-profiles.js');
    const keyboard=defaultKeyboardSettings(),controllers=defaultControllerSettings();
    keyboard.bindings.b=['KeyN'];keyboard.mode='both';
    controllers.stompEffect={duration:180,low:30,high:50};
    return {schema:'dkc.player-config',version:2,player,rememberRom:true,keyboard,controllers};
  },Object.fromEntries(retained.map(name=>[name,name==='volume'?49:exported.player[name]])));
  await run(config=>{
    const input=document.querySelector('#config-file'),files=new DataTransfer();
    files.items.add(new File([JSON.stringify(config)],'legacy.config.json',{type:'application/json'}));
    input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  },old);
  await wait(()=>document.querySelector('[data-pref="volume"]').value==='49','v1.1 settings import');
  assert.equal(await run(async()=>(await import('./settings.js')).readPlayer().uiBackgroundOpacity),80);
  assert.deepEqual(await run(()=>dkcDebug.keyboard().bindings.b),['KeyN']);
  assert.equal(await run(()=>document.querySelector('#player-one').selectedOptions[0].text),'Keyboard + Gamepad');
  await click('[data-detail="options"]');
  await wait(()=>!document.querySelector('[data-settings-pane="options"]').hidden,'reset Settings');
  await click('[data-command="restore-settings"]');
  await click('#restore-settings-dialog [value="restore"]');
  await wait(()=>document.querySelector('[data-pref="volume"]').value==='100','reset preferences');
  assert.equal(await run(()=>document.documentElement.dataset.appearance),'black');
  assert.deepEqual(await run(()=>['#player-one','#player-two'].map(id=>document.querySelector(id).selectedOptions[0].text)),['Keyboard','Disabled']);
  report.checks.push('Approved Input Profiles layout, Set/Clear, add/rename/delete, saved player assignment, combined keyboard/mouse/gamepad, raw hat diagonals, per-profile rumble, v4 export, and legacy config migration verified. Controllers were simulated.');
}
