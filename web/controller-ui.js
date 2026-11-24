import {ACTIONS,DEFAULT_PROFILE,createProfile,validateProfile,parseProfile,serializeProfile,evaluateProfile,bindingLabel,detectBinding,bindingPressed,acceptsSource,CONTROLLER_STORAGE_KEY,LEGACY_CONTROLLER_KEY,defaultControllerSettings,validateControllerSettings} from './gamepad-profiles.js';

const clone=value=>JSON.parse(JSON.stringify(value));
const $=id=>document.getElementById(id);
const baseDeviceKey=pad=>`${pad.id}\u001f${pad.mapping||''}\u001f${pad.buttons.length}:${pad.axes.length}`;
const snapshot=pad=>pad?{id:pad.id,index:pad.index,mapping:pad.mapping||'',connected:pad.connected!==false,buttons:Array.from(pad.buttons,b=>typeof b==='number'?b:{pressed:Boolean(b.pressed),value:Number(b.value)||0}),axes:Array.from(pad.axes,Number)}:null;

const STOMP_EFFECTS={
  standard:{duration:140,startDelay:0,strongMagnitude:0.8,weakMagnitude:1},
  light:{duration:55,startDelay:0,strongMagnitude:0x2800/65535,weakMagnitude:0x5000/65535},
};

function rumbleOutputs(pad){
  const motors=[pad?.vibrationActuator,...(pad?.hapticActuators||[])];
  const dual=motors.find(motor=>typeof motor?.playEffect==='function' &&
    (motor.effects ? motor.effects.includes('dual-rumble') : !motor.type || motor.type==='dual-rumble'));
  const legacy=motors.find(motor=>typeof motor?.pulse==='function');
  return {dual,legacy};
}

async function playRumble({dual,legacy},effect){
  if(dual){
    try{
      const result=await dual.playEffect('dual-rumble',effect);
      if(result!=='not-supported')return result;
    }catch(error){
      if(error?.name!=='NotSupportedError')throw error;
    }
  }
  if(legacy){
    const completed=await legacy.pulse(Math.max(effect.strongMagnitude,effect.weakMagnitude),effect.duration);
    return completed===true?'complete':completed===false?'preempted':'error';
  }
  return 'not-supported';
}

export function initControllerUI({getMode=()=>'keyboard',onNotice=()=>{},bindingDialog}={}) {
  const panel=$('controller-panel'),message=$('controller-message'),deviceSelect=$('controller-device'),profileSelect=$('controller-profile');
  let settings=defaultControllerSettings(),storedVersion=null,storageAvailable=true,pads=[],selectedKey=null,player=0;
  const deviceSlots=new Map();
  let routed=[null,null],assistCapture=null,assistListener=null;
  const deviceKey=pad=>deviceSlots.get(pad.index)?.key;
  const route=(n=player,target=settings)=>n===1?target.player2:target;
  const heldAssist=new Set();
  let profile=clone(DEFAULT_PROFILE),committedId=DEFAULT_PROFILE.id,dirty=false,capture=null,lastPaint=0,lastDevices='',previewBits=0,outputBits=0;
  function tell(text,error=false){message.textContent=text;message.classList.toggle('error',error);}
  function writeSettings(next=settings){
    try{
      const encoded=JSON.stringify(validateControllerSettings(next));
      if(localStorage.getItem(CONTROLLER_STORAGE_KEY)!==storedVersion)throw new Error('Controller settings changed in another tab. Reload to use the newer settings.');
      localStorage.setItem(CONTROLLER_STORAGE_KEY,encoded);storedVersion=encoded;storageAvailable=true;
    }
    catch(error){storageAvailable=false;throw new Error(`Controller profile was not saved: ${error.message}`);}
  }
  try{
    storedVersion=localStorage.getItem(CONTROLLER_STORAGE_KEY);
    const raw=storedVersion??localStorage.getItem(LEGACY_CONTROLLER_KEY);
    if(raw!==null){
      if(raw.length>1048576)throw new Error('Stored controller settings are too large.');
      settings=validateControllerSettings(JSON.parse(raw));
    }
  }catch(error){storageAvailable=false;tell(`Controller settings could not be loaded: ${error.message}`,true);}
  function selectedPad(){return pads.find(p=>deviceKey(p)===selectedKey)||null;}
  function findProfile(id){return id===DEFAULT_PROFILE.id?DEFAULT_PROFILE:settings.profiles.find(p=>p.id===id);}
  function cancelCapture(){if(capture)bindingDialog.dismiss();capture=null;assistCapture=null;}
  function chooseProfile(id){
    cancelCapture();const found=findProfile(id)||DEFAULT_PROFILE;profile=clone(found);committedId=found.id;dirty=false;renderEditor();
  }
  function dirtyGuard(){if(!dirty)return false;tell('Save or discard your profile changes first.',true);return true;}
  function refreshProfiles(){
    profileSelect.replaceChildren();
    for(const p of [DEFAULT_PROFILE,...settings.profiles]){const option=document.createElement('option');option.value=p.id;option.textContent=p.name;profileSelect.append(option);}
    if(!findProfile(profile.id)){const option=document.createElement('option');option.value=profile.id;option.textContent=`${profile.name||'New profile'} (unsaved)`;profileSelect.append(option);}
    profileSelect.value=profile.id;
  }
  function renderEditor(){
    refreshProfiles();$('controller-capture-mode').value=settings.captureMode;
    $('player-deadzone').value=route().deadzone??'';
    $('controller-rumble').checked=settings.rumble;
    const builtin=profile.id===DEFAULT_PROFILE.id;
    $('controller-name').value=profile.name;$('controller-name').disabled=builtin;
    $('controller-deadzone').value=profile.deadzone;$('controller-deadzone').disabled=builtin;
    $('controller-draft').textContent=dirty?'Unsaved changes':builtin?'Built-in profile · make a copy to edit':'Saved profile';
    $('controller-save').disabled=builtin||!dirty;$('controller-discard').disabled=!dirty;
    $('controller-delete').disabled=builtin||!settings.profiles.some(p=>p.id===profile.id);
    for(const button of panel.querySelectorAll('[data-controller-listen],[data-controller-clear]'))button.disabled=builtin;
    $('controller-bind-add').disabled=builtin;
    for(const action of ACTIONS){
      const list=$(`controller-binding-${action.id}`);list.replaceChildren();
      const bindings=profile.bindings[action.id]||[];
      if(!bindings.length){list.textContent='Not bound';continue;}
      for(const [index,binding] of bindings.entries()){
        const item=document.createElement('span');item.className='controller-binding';
        const label=document.createElement('span');label.textContent=bindingLabel(binding);item.append(label);
        if(!builtin){const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label',`Remove ${bindingLabel(binding)} from ${action.label}`);remove.addEventListener('click',()=>{profile.bindings[action.id].splice(index,1);markDirty();});item.append(remove);}
        list.append(item);
      }
    }
  }
  function markDirty(){dirty=true;renderEditor();}
  function addBinding(action,binding){
    if(profile.id===DEFAULT_PROFILE.id)throw new Error('Choose New profile or Copy profile before editing.');
    const next=clone(profile);next.bindings[action]??=[];next.bindings[action].push(binding);
    profile=validateProfile(next);markDirty();
  }
  function rememberSelection(){
    const selected=route();selected.lastProfile=profile.id;
    if(selectedKey)Object.defineProperty(selected.assignments,selectedKey,{value:profile.id,writable:true,enumerable:true,configurable:true});
    try{writeSettings();}catch(error){tell(`${error.message} The selection still works for this session.`,true);}
  }
  function registerPads(values){
    pads=Array.from(values||[]).filter(p=>p&&p.connected!==false&&p.buttons&&p.axes);
    const seen=new Set(pads.map(p=>p.index));
    for(const index of deviceSlots.keys())if(!seen.has(index))deviceSlots.delete(index);
    for(const pad of pads){
      const base=baseDeviceKey(pad);
      if(deviceSlots.get(pad.index)?.base===base)continue;
      const used=new Set(Array.from(deviceSlots.values(),slot=>slot.key));
      let key=base,ordinal=1;while(used.has(key))key=base+'\u001f'+(++ordinal);
      deviceSlots.set(pad.index,{base,key});
    }
    routed=[null,null];
    const active=[0,1].filter(n=>acceptsSource(getMode(n),'gamepad'));
    for(const n of active)if(route(n).lastDevice)routed[n]=pads.find(p=>deviceKey(p)===route(n).lastDevice&&!routed.includes(p))||null;
    for(const n of active)if(!route(n).lastDevice)routed[n]=pads.find(p=>!routed.includes(p))||null;
  }
  function playerPad(n){
    if(acceptsSource(getMode(n),'gamepad'))return routed[n];
    return route(n).lastDevice?pads.find(p=>deviceKey(p)===route(n).lastDevice):pads.find(p=>!routed.includes(p));
  }
  function profileFor(n,pad){
    const key=pad?deviceKey(pad):null,selected=route(n);
    const remembered=key||selected.lastDevice;
    const id=remembered&&Object.hasOwn(selected.assignments,remembered)?selected.assignments[remembered]:
      !key||!Object.keys(selected.assignments).length?selected.lastProfile:DEFAULT_PROFILE.id;
    return findProfile(id)||DEFAULT_PROFILE;
  }
  function refreshDevices(){
    const selected=route(),devices=new Map();
    for(const key of [...Object.keys(selected.assignments),selected.lastDevice]){
      if(key)devices.set(key,`${key.split('\u001f')[0]} (disconnected)`);
    }
    for(const pad of pads)devices.set(deviceKey(pad),pads.filter(p=>p.id===pad.id).length>1?`${pad.id} (port ${pad.index+1})`:pad.id);
    const signature=JSON.stringify([...devices]);
    if(signature===lastDevices&&deviceSelect.value===(selected.lastDevice||''))return;
    lastDevices=signature;deviceSelect.replaceChildren();
    for(const [key,name] of [['','Automatic'],...devices]){
      const option=document.createElement('option');option.value=key;option.textContent=name;deviceSelect.append(option);
    }
    deviceSelect.value=selected.lastDevice||'';
  }
  function poll(values){
    registerPads(values);
    const preferred=playerPad(player),next=preferred?deviceKey(preferred):route().lastDevice;
    if(next!==selectedKey&&!dirty&&!capture&&!assistCapture){
      selectedKey=next;chooseProfile(profileFor(player,preferred).id);
    }
    const pad=selectedPad();
    heldAssist.clear();
    for(const [action,binding] of Object.entries(settings.assistBindings)){
      if(binding&&routed.some(p=>p&&bindingPressed(binding,p,0.3)))heldAssist.add(action);
    }
    if(assistCapture){
      const listening=assistCapture;
      if(!pad||performance.now()>listening.until){assistCapture=null;assistListener?.('No controller input captured.');}
      else{
        const binding=detectBinding(listening.baseline,pad,{mode:'auto'});
        if(binding){
          assistCapture=null;
          try{saveAssist(listening.id,binding);assistListener?.('Controller shortcut saved.');}catch(error){assistListener?.(error.message);}
        }
      }
    }
    if(capture){
      if(!pad){cancelCapture();tell('Controller disconnected. Reconnect it before listening.',true);}
      else if(performance.now()>capture.until){cancelCapture();tell('No input captured. Release the controls, then try again.');}
      else{
        try{
          // Compare against the rest snapshot, so gradual stick movement is captured.
          const binding=detectBinding(capture.baseline,pad,{deadzone:profile.deadzone,mode:capture.mode,hatDirection:capture.action});
          if(binding){
            // Listened sticks follow the profile dead zone. Manual bindings
            // may still supply their own explicit threshold.
            if(binding.type==='axis')delete binding.threshold;
            const action=capture.action;cancelCapture();addBinding(action,binding);tell(`Added ${bindingLabel(binding)}. Save the profile to keep it.`);
          }
          else for(let i=0;i<capture.baseline.buttons.length;i++)if(!(typeof pad.buttons[i]==='number'?pad.buttons[i]>.5:pad.buttons[i]?.pressed))capture.baseline.buttons[i]={value:0,pressed:false};
        }catch(error){cancelCapture();tell(error.message,true);}
      }
    }
    previewBits=pad?evaluateProfile(profile,pad,route().deadzone===null?profile.deadzone:route().deadzone/100):0;
    outputBits=panel.hidden&&!dirty&&!capture?previewBits:0;
    if(!panel.hidden&&performance.now()-lastPaint>100){lastPaint=performance.now();refreshDevices();}
    return outputBits;
  }
  function open(){
    if(!panel.hidden)return true;
    panel.hidden=false;
    renderEditor();refreshDevices();
    return true;
  }
  function canClose(){if(dirtyGuard())return false;cancelCapture();return true;}
  function close(){
    if(!canClose())return false;
    panel.hidden=true;
    return true;
  }
  deviceSelect.addEventListener('change',()=>{
    if(dirtyGuard()){deviceSelect.value=route().lastDevice||'';return;}
    const key=deviceSelect.value||null,other=route(1-player);
    if(key&&acceptsSource(getMode(1-player),'gamepad')&&key===other.lastDevice){
      tell('This controller is assigned to the other player.',true);deviceSelect.value=route().lastDevice||'';return;
    }
    try{
      const next=clone(settings);route(player,next).lastDevice=key;writeSettings(next);settings=next;
      registerPads(pads);resetEditor();
    }catch(error){deviceSelect.value=route().lastDevice||'';tell(error.message,true);}
  });
  profileSelect.addEventListener('change',()=>{
    if(dirtyGuard()){profileSelect.value=profile.id;return;}
    chooseProfile(profileSelect.value);rememberSelection();tell('Profile loaded. Close Config, then resume the game.');
  });
  function makeProfile(copy){
    if(dirtyGuard())return;
    const pad=selectedPad(),name=copy?`${profile.name.slice(0,60)} copy`:pad?`${pad.id.split(' (')[0].slice(0,55)} custom`:'Custom controller';
    profile=createProfile(name,pad,copy?profile:null);dirty=true;cancelCapture();renderEditor();$('controller-name').focus();tell('Bind your controls, then Save. The game stays paused while configuring.');
  }
  $('controller-new').addEventListener('click',()=>makeProfile(false));$('controller-copy').addEventListener('click',()=>makeProfile(true));
  $('controller-name').addEventListener('input',event=>{profile.name=event.target.value;dirty=true;$('controller-draft').textContent='Unsaved changes';$('controller-save').disabled=false;$('controller-discard').disabled=false;});
  $('controller-deadzone').addEventListener('change',event=>{
    try{const next=clone(profile);next.deadzone=Number(event.target.value);profile=validateProfile(next);markDirty();}
    catch(error){event.target.value=profile.deadzone;tell(error.message,true);}
  });
  $('controller-save').addEventListener('click',()=>{
    try{
      const validated=validateProfile(profile),profiles=settings.profiles.filter(p=>p.id!==validated.id);
      if(profiles.length>=64)throw new Error('Delete a profile before saving another.');
      const next=clone(settings);next.profiles=[...profiles,validated];
      const selected=route(player,next);selected.lastProfile=validated.id;
      if(selectedKey){Object.defineProperty(selected.assignments,selectedKey,{value:validated.id,enumerable:true,configurable:true,writable:true});}
      writeSettings(next);settings=next;profile=clone(validated);committedId=profile.id;dirty=false;cancelCapture();renderEditor();tell('Profile saved in this browser.');onNotice('Profile saved.',profile.name);
    }catch(error){tell(error.message,true);}
  });
  $('controller-discard').addEventListener('click',()=>{chooseProfile(committedId);tell('Unsaved changes discarded.');});
  $('controller-delete').addEventListener('click',()=>{
    if(dirtyGuard())return;
    try{
      const next=clone(settings);next.profiles=next.profiles.filter(p=>p.id!==profile.id);
      for(const selected of [next,next.player2]){
        if(selected.lastProfile===profile.id)selected.lastProfile=DEFAULT_PROFILE.id;
        for(const key of Object.keys(selected.assignments))if(selected.assignments[key]===profile.id)delete selected.assignments[key];
      }
      writeSettings(next);settings=next;chooseProfile(DEFAULT_PROFILE.id);tell('Custom profile deleted.');
    }catch(error){tell(error.message,true);}
  });
  $('controller-export').addEventListener('click',()=>{
    try{
      const exported=profile.id===DEFAULT_PROFILE.id?createProfile(profile.name,null,profile):profile;
      const text=serializeProfile(exported),url=URL.createObjectURL(new Blob([text],{type:'application/json'}));
      const link=document.createElement('a');link.href=url;link.download=`${profile.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'controller-profile'}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      tell(dirty?'Draft exported. Save to keep it in this browser.':'Controller profile exported.');
    }catch(error){tell(error.message,true);}
  });
  $('controller-import').addEventListener('change',async event=>{
    const file=event.target.files[0];event.target.value='';if(!file)return;
    if(dirtyGuard())return;
    try{
      if(file.size>65536)throw new Error('Profile file must be no larger than 64 KiB.');
      const imported=parseProfile(await file.text());profile=createProfile(imported.name,imported.device,imported);dirty=true;cancelCapture();renderEditor();tell('Profile loaded from file. Save to keep it in this browser.');
    }catch(error){tell(`Profile could not be loaded: ${error.message}`,true);}
  });
  for(const action of ACTIONS){
    const row=document.createElement('div');row.className='controller-binding-row';
    const label=document.createElement('strong');label.textContent=action.label;row.append(label);
    const bindings=document.createElement('div');bindings.id=`controller-binding-${action.id}`;bindings.className='controller-bindings';row.append(bindings);
    const listen=document.createElement('button');listen.type='button';listen.textContent='Set';listen.dataset.controllerListen='';listen.dataset.action=action.id;
    listen.setAttribute('aria-label',`Listen for ${action.label}`);
    listen.addEventListener('click',()=>{
      const pad=selectedPad(),mode=$('controller-capture-mode').value;
      if(!pad){tell('Connect a controller and press a button first.',true);return;}
      if(mode==='hat'&&!['up','right','down','left'].includes(action.id)){tell('Hat capture applies to a direction. Use Axis value for other actions.',true);return;}
      capture={action:action.id,mode,baseline:snapshot(pad),until:performance.now()+12000};
      bindingDialog.show(action.label,()=>{cancelCapture();tell('Listening cancelled.');});
    });row.append(listen);
    const clear=document.createElement('button');clear.type='button';clear.textContent='Clear';clear.dataset.controllerClear='';clear.dataset.action=action.id;clear.setAttribute('aria-label',`Clear bindings for ${action.label}`);clear.addEventListener('click',()=>{profile.bindings[action.id]=[];markDirty();});row.append(clear);
    $('controller-bindings').append(row);
    const option=document.createElement('option');option.value=action.id;option.textContent=action.label;$('controller-bind-action').append(option);
  }
  function manualVisibility(){
    const type=$('controller-bind-type').value;
    $('controller-bind-index').max=type==='button'?'255':'63';
    $('controller-bind-threshold').max=type==='button'?'1':'2';
    for(const element of panel.querySelectorAll('[data-binding-fields]'))element.hidden=!element.dataset.bindingFields.split(' ').includes(type);
  }
  $('controller-bind-type').addEventListener('change',manualVisibility);manualVisibility();
  $('controller-bind-add').addEventListener('click',()=>{
    try{
      const action=$('controller-bind-action').value,type=$('controller-bind-type').value,index=Number($('controller-bind-index').value);let binding;
      if(type==='button')binding={type:'button',index,threshold:Number($('controller-bind-threshold').value)};
      else if(type.startsWith('hat-'))binding={type:'hat',index,direction:type.slice(4)};
      else if(type==='axis-value')binding={type,index,value:Number($('controller-bind-value').value),tolerance:Number($('controller-bind-tolerance').value)};
      else binding={type:'axis',index,direction:type==='axis-negative'?-1:1,rest:Number($('controller-bind-rest').value),threshold:Number($('controller-bind-threshold').value)};
      addBinding(action,binding);tell(`Added ${bindingLabel(binding)}. Save the profile to keep it.`);
    }catch(error){tell(error.message,true);}
  });
  $('controller-capture-mode').addEventListener('change',event=>saveOption(next=>{next.captureMode=event.target.value;}));
  $('player-deadzone').addEventListener('change',event=>saveOption(next=>{route(player,next).deadzone=event.target.value===''?null:Number(event.target.value);}));
  $('controller-rumble').addEventListener('change',event=>{
    try{const next={...settings,rumble:event.target.checked};writeSettings(next);settings=next;rumbleRequest++;updateRumble();onNotice('Setting saved.',settings.rumble?'Rumble on':'Rumble off');}
    catch(error){event.target.checked=settings.rumble;onNotice('Rumble: '+error.message);}
  });
  function saveOption(change){
    try{const next=clone(settings);change(next);writeSettings(next);settings=next;}
    catch(error){tell(error.message,true);}
    renderEditor();
  }
  let rumbleRequest=0, rumbleDraft=null;
  const rumbleRows=$('rumble-advanced');
  const rumbleControls=[...rumbleRows.querySelectorAll('[data-rumble-value]')];
  const rumbleLabels={duration:'Duration',low:'Low motor',high:'High motor'};
  function rumbleValues(){
    const {duration,strongMagnitude,weakMagnitude}=STOMP_EFFECTS[settings.stompStrength];
    return settings.stompEffect||{duration,low:Math.round(strongMagnitude*100),high:Math.round(weakMagnitude*100)};
  }
  function rumbleEffect(){
    const effect=rumbleDraft||settings.stompEffect;
    return effect?{duration:effect.duration,startDelay:0,strongMagnitude:effect.low/100,weakMagnitude:effect.high/100}
      :STOMP_EFFECTS[settings.stompStrength];
  }
  function paintRumbleValues(){
    const values=rumbleValues();
    for(const control of rumbleControls)control.value=values[control.dataset.rumbleValue];
  }
  rumbleRows.addEventListener('input',event=>{
    const control=event.target,key=control.dataset.rumbleValue;
    if(!key||!control.value||!control.validity.valid)return;
    rumbleDraft={...rumbleValues(),[key]:Number(control.value)};
    for(const peer of rumbleControls)if(peer!==control&&peer.dataset.rumbleValue===key)peer.value=control.value;
  });
  rumbleRows.addEventListener('change',event=>{
    const control=event.target,key=control.dataset.rumbleValue;
    if(!key)return;
    try{
      if(!control.value||!control.validity.valid)throw new Error('Enter a value in the displayed range.');
      const value=Number(control.value),next={...settings,stompEffect:{...rumbleValues(),[key]:value}};
      writeSettings(next);settings=next;
      onNotice('Setting saved.',`${rumbleLabels[key]} · ${value}${key==='duration'?' ms':'%'}`);
    }catch(error){onNotice('Rumble: '+error.message);}
    finally{rumbleDraft=null;paintRumbleValues();}
  });
  function updateRumble(){
    $('rumble-advanced').hidden=!settings.rumble;
  }
  $('controller-rumble-test').addEventListener('click',async()=>{
    if(!settings.rumble)return;
    registerPads(pads); // Input modes may have changed since the last animation frame.
    const port=Number($('rumble-player').value),pad=playerPad(port);
    const request=++rumbleRequest;
    if(!pad){onNotice('Rumble: no controller assigned.',`Player ${port+1}`);return;}
    let message;
    try{
      const result=await playRumble(rumbleOutputs(pad),rumbleEffect());
      if(result==='complete')message='Test pulse completed.';
      else if(result==='not-supported')message='The browser exposes no rumble output for this controller.';
      else if(result==='preempted')message='Test pulse was interrupted.';
      else message='The test pulse could not complete.';
    }catch(error){message=error.message||'The browser rejected the test pulse.';}
    if(request===rumbleRequest)onNotice(`Rumble: ${message}`,pad.id);
  });
  function saveAssist(id,binding){
    const next={...settings,assistBindings:{...settings.assistBindings,[id]:binding}};writeSettings(next);settings=next;
  }
  function resetEditor(){
    const pad=playerPad(player);selectedKey=pad?deviceKey(pad):route().lastDevice;
    chooseProfile(profileFor(player,pad).id);lastDevices=null;refreshDevices();
  }
  function inputState(n=0){
    const pad=routed[n];if(!pad)return {buttons:0,source:null};
    const active=profileFor(n,pad),zone=route(n).deadzone;
    const consumed=Array.from(heldAssist,id=>settings.assistBindings[id]).filter(binding=>bindingPressed(binding,pad,0.3));
    return {buttons:evaluateProfile(active,pad,zone===null?active.deadzone:zone/100,consumed),source:`${deviceKey(pad)}:${pad.index}:${active.id}`};
  }
  resetEditor();updateRumble();paintRumbleValues();
  return {poll,open,close,canClose,isEditing:()=>dirty||Boolean(capture||assistCapture),
    isCapturing:()=>Boolean(capture||assistCapture),inputState,heldAssist:()=>new Set(heldAssist),exportSettings:()=>clone(settings),
    applySettings(value){
      if(!canClose())throw new Error('Save or discard controller changes first.');
      settings=validateControllerSettings(value);storedVersion=localStorage.getItem(CONTROLLER_STORAGE_KEY);storageAvailable=true;registerPads(pads);resetEditor();rumbleDraft=null;updateRumble();paintRumbleValues();
    },
    setPlayer(n){if(!canClose())return false;player=n;resetEditor();return true;},
    pulseStomp(){
      const pad=routed.find(Boolean);
      if(settings.rumble&&pad)playRumble(rumbleOutputs(pad),rumbleEffect()).catch(()=>{});
    },
    assistBinding:id=>settings.assistBindings[id],clearAssist:id=>saveAssist(id,null),
    listenAssist(id,callback){
      const pad=selectedPad();if(!pad)throw new Error('Connect and select a controller first.');
      cancelCapture();assistListener=callback;assistCapture={id,baseline:snapshot(pad),until:performance.now()+12000};
    },
    cancelCapture,status(n=player){
    const pad=n===player?selectedPad():playerPad(n),shownProfile=n===player?profile:profileFor(n,pad);
    return {open:!panel.hidden,dirty,capturing:capture?{action:capture.action,mode:capture.mode}:null,device:pad?{id:pad.id,mapping:pad.mapping||'',index:pad.index,buttons:pad.buttons.length,axes:pad.axes.length}:null,profile:clone(shownProfile),mappedBits:previewBits,outputBits,storageAvailable,savedProfiles:settings.profiles.map(p=>({id:p.id,name:p.name}))};
  }};
}

// Use fresh D-pad/button edges so a held game button cannot click into a sheet.
export function createSettingsNavigation(){
  let previous=0,wasOpen=false;
  let menuHeld=true;
  return function navigate(pads,blocked,rawBits=0,onMenu=()=>{},afterClose=()=>{}){
    const dialog=document.querySelector('#settings:not([hidden]) #app-settings');
    const standard=Array.from(pads||[]).filter(p=>p?.connected!==false&&p?.mapping==='standard');
    const down=(pad,i)=>Boolean(pad.buttons[i]?.pressed||pad.buttons[i]?.value>.5||pad.buttons[i]>.5);
    const menu=standard.some(p=>down(p,16)||(down(p,9)&&down(p,8)));
    const openEdge=menu&&!menuHeld;menuHeld=menu;
    if(openEdge&&!blocked&&!dialog){onMenu();return;}
    const mask=standard.reduce((bits,pad)=>bits|evaluateProfile(DEFAULT_PROFILE,pad),rawBits);
    const pressed=mask&~previous;previous=mask;
    if(!dialog||!wasOpen||blocked||!pressed){wasOpen=Boolean(dialog);return;}
    const elements=Array.from(dialog.querySelectorAll('button:not(:disabled),select:not(:disabled),input:not(:disabled),summary,[tabindex="0"]'))
      .filter(el=>el.getClientRects().length&&!el.closest('[hidden]')&&(!el.closest('details:not([open])')||el.tagName==='SUMMARY'));
    if(!elements.length)return;
    const focus=document.activeElement,current=elements.indexOf(focus),next=pressed&32?1:pressed&16?-1:0;
    if(next){elements[(current+next+elements.length)%elements.length].focus();return;}
    if(pressed&256){document.getElementById('settings-done').click();afterClose();return;}
    const direction=pressed&128?1:pressed&64?-1:0;
    if(direction&&focus?.tagName==='SELECT'){
      focus.selectedIndex=Math.max(0,Math.min(focus.options.length-1,focus.selectedIndex+direction));focus.dispatchEvent(new Event('change',{bubbles:true}));return;
    }
    if(direction&&focus?.matches('input[type=number],input[type=range]')){
      direction>0?focus.stepUp():focus.stepDown();focus.dispatchEvent(new Event('input',{bubbles:true}));focus.dispatchEvent(new Event('change',{bubbles:true}));return;
    }
    if(direction){elements[(current+direction+elements.length)%elements.length].focus();return;}
    if(pressed&1&&current>=0)focus.click();
  };
}
