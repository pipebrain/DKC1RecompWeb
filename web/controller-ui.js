import {ACTIONS,DEFAULT_PROFILE,createProfile,validateProfile,parseProfile,serializeProfile,evaluateProfile,bindingLabel,detectBinding} from './gamepad-profiles.js';

const STORAGE_KEY='dkc.controller-settings.v1';
const clone=value=>JSON.parse(JSON.stringify(value));
const $=id=>document.getElementById(id);
const deviceKey=pad=>`${pad.id}\u001f${pad.mapping||''}\u001f${pad.buttons.length}:${pad.axes.length}`;
const snapshot=pad=>pad?{id:pad.id,index:pad.index,mapping:pad.mapping||'',connected:pad.connected!==false,buttons:Array.from(pad.buttons,b=>typeof b==='number'?b:{pressed:Boolean(b.pressed),value:Number(b.value)||0}),axes:Array.from(pad.axes,Number)}:null;

export function initControllerUI({onOpen=async()=>{},onClose=()=>{}}={}) {
  const panel=$('controller-panel'),message=$('controller-message'),deviceSelect=$('controller-device'),profileSelect=$('controller-profile');
  let settings={profiles:[],assignments:{},lastDevice:null},storageAvailable=true,pads=[],selectedKey=null;
  let profile=clone(DEFAULT_PROFILE),committedId=DEFAULT_PROFILE.id,dirty=false,capture=null,lastPaint=0,lastDevices='',previewBits=0,outputBits=0;
  function tell(text,error=false){message.textContent=text;message.classList.toggle('error',error);}
  function writeSettings(next=settings){
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify(next));storageAvailable=true;}
    catch(error){storageAvailable=false;throw new Error(`Controller profile was not saved: ${error.message}`);}
  }
  try{
    const raw=localStorage.getItem(STORAGE_KEY);
    if(raw){
      if(raw.length>1048576)throw new Error('Stored controller settings are too large.');
      const saved=JSON.parse(raw);
      if(!saved||!Array.isArray(saved.profiles)||saved.profiles.length>64)throw new Error('Invalid stored controller settings.');
      const profiles=saved.profiles.map(validateProfile);
      if(new Set(profiles.map(p=>p.id)).size!==profiles.length)throw new Error('Duplicate stored profiles.');
      const assignments={};
      if(saved.assignments&&typeof saved.assignments==='object')for(const [key,id] of Object.entries(saved.assignments)){
        if(typeof key==='string'&&key.length<2048&&typeof id==='string'&&(id===DEFAULT_PROFILE.id||profiles.some(p=>p.id===id)))Object.defineProperty(assignments,key,{value:id,writable:true,enumerable:true,configurable:true});
      }
      settings={profiles,assignments,lastDevice:typeof saved.lastDevice==='string'?saved.lastDevice:null};
    }
  }catch(error){storageAvailable=false;tell(`Controller settings could not be loaded: ${error.message}`,true);}
  function selectedPad(){return pads.find(p=>deviceKey(p)===selectedKey)||null;}
  function findProfile(id){return id===DEFAULT_PROFILE.id?DEFAULT_PROFILE:settings.profiles.find(p=>p.id===id);}
  function cancelCapture(){capture=null;$('controller-capture-cancel').hidden=true;}
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
    refreshProfiles();const builtin=profile.id===DEFAULT_PROFILE.id;
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
    if(selectedKey)settings.assignments[selectedKey]=profile.id;
    settings.lastDevice=selectedKey;
    try{writeSettings();}catch(error){tell(`${error.message} The selection still works for this session.`,true);}
  }
  function refreshDevices(){
    const signature=JSON.stringify(pads.map(p=>[deviceKey(p),p.index]));
    if(signature===lastDevices&&deviceSelect.value===(selectedKey||''))return;
    lastDevices=signature;deviceSelect.replaceChildren();
    if(!pads.length||selectedKey&&!selectedPad()){
      const option=document.createElement('option');option.value=selectedKey||'';option.textContent=selectedKey?'Selected controller disconnected':'No controller detected';deviceSelect.append(option);
    }
    for(const pad of pads){const option=document.createElement('option');option.value=deviceKey(pad);option.textContent=pad.id;deviceSelect.append(option);}
    deviceSelect.value=selectedKey||'';
  }
  function paintLive(){
    const pad=selectedPad();
    $('controller-device-info').textContent=pad?`${pad.id} · ${pad.mapping==='standard'?'Browser standard mapping':'Raw / non-standard mapping'} · ${pad.buttons.length} buttons · ${pad.axes.length} axes`:'Connect a controller and press a button so the browser can expose it.';
    $('controller-live-buttons').textContent=pad?Array.from(pad.buttons,(button,index)=>{const value=typeof button==='number'?button:button.value;return `B${index}: ${Number(value||0).toFixed(2)}${button.pressed?' ●':''}`;}).join('  '):'—';
    $('controller-live-axes').textContent=pad?Array.from(pad.axes,(value,index)=>`Axis ${index}: ${Number(value).toFixed(3)}`).join('  '):'—';
    $('controller-mapped').textContent=ACTIONS.filter(a=>previewBits&a.bit).map(a=>a.label).join(', ')||'None';
    const summary=$('controller-summary');
    summary.textContent=pad?pad.mapping!=='standard'&&profile.id===DEFAULT_PROFILE.id?'Raw controller detected · use Input to bind a profile':`${profile.name} · ${pad.id}`:'Controller: connect and press a button';
  }
  function poll(values){
    pads=Array.from(values||[]).filter(p=>p&&p.connected!==false&&p.buttons&&p.axes);
    if(!selectedPad()&&!dirty&&!capture){
      const preferred=pads.find(p=>deviceKey(p)===settings.lastDevice)||pads[0]||null;
      const next=preferred?deviceKey(preferred):null;
      if(next!==selectedKey){selectedKey=next;chooseProfile(settings.assignments[selectedKey]||DEFAULT_PROFILE.id);}
    }
    const pad=selectedPad();
    if(capture){
      if(!pad){cancelCapture();tell('Controller disconnected. Reconnect it before listening.',true);}
      else if(performance.now()>capture.until){cancelCapture();tell('No input captured. Release the controls, then try Listen again.');}
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
    previewBits=pad?evaluateProfile(profile,pad):0;
    outputBits=panel.hidden&&!dirty&&!capture?previewBits:0;
    const now=performance.now();if(now-lastPaint>100){lastPaint=now;refreshDevices();paintLive();}
    return outputBits;
  }
  async function open({notify=true,focus=true}={}){
    if(!panel.hidden)return true;
    // Set visibility before notifying the host so opening its Settings sheet
    // can activate this pane without recursively opening the controller UI.
    panel.hidden=false;
    if(notify)try{await onOpen();}catch(error){tell(error.message,true);}
    renderEditor();refreshDevices();paintLive();
    const pane=panel.closest('[data-settings-pane]');
    if(pane)pane.scrollTop=0;
    else if(!panel.closest('dialog'))panel.scrollIntoView({block:'start'});
    if(focus)deviceSelect.focus({preventScroll:true});
    return true;
  }
  function canClose(){return !dirtyGuard();}
  function close({notify=true}={}){
    if(!canClose())return false;
    if(panel.hidden)return true;
    cancelCapture();panel.hidden=true;
    // The Settings host restores focus to the menu that opened the sheet.
    if(notify)try{Promise.resolve(onClose()).catch(error=>tell(error.message,true));}catch(error){tell(error.message,true);}
    return true;
  }
  $('controller-capture-cancel').addEventListener('click',()=>{cancelCapture();tell('Listening cancelled.');});
  deviceSelect.addEventListener('change',()=>{
    if(dirtyGuard()){deviceSelect.value=selectedKey||'';return;}
    selectedKey=deviceSelect.value;chooseProfile(settings.assignments[selectedKey]||DEFAULT_PROFILE.id);rememberSelection();paintLive();
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
      const next={...settings,profiles:[...profiles,validated],assignments:{...settings.assignments},lastDevice:selectedKey};
      if(selectedKey)next.assignments[selectedKey]=validated.id;
      writeSettings(next);settings=next;profile=clone(validated);committedId=profile.id;dirty=false;cancelCapture();renderEditor();tell('Profile saved in this browser. Close Config, then resume.');
    }catch(error){tell(error.message,true);}
  });
  $('controller-discard').addEventListener('click',()=>{chooseProfile(committedId);tell('Unsaved changes discarded.');});
  $('controller-delete').addEventListener('click',()=>{
    if(dirtyGuard())return;
    try{
      const next={...settings,profiles:settings.profiles.filter(p=>p.id!==profile.id),assignments:{...settings.assignments}};
      for(const key of Object.keys(next.assignments))if(next.assignments[key]===profile.id)delete next.assignments[key];
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
    const listen=document.createElement('button');listen.type='button';listen.textContent='Listen';listen.dataset.controllerListen='';listen.dataset.action=action.id;
    listen.setAttribute('aria-label',`Listen for ${action.label}`);
    listen.addEventListener('click',()=>{
      const pad=selectedPad(),mode=$('controller-capture-mode').value;
      if(!pad){tell('Connect a controller and press a button first.',true);return;}
      if(mode==='hat'&&!['up','right','down','left'].includes(action.id)){tell('Hat capture applies to a direction. Use Axis value for other actions.',true);return;}
      capture={action:action.id,mode,baseline:snapshot(pad),until:performance.now()+12000};$('controller-capture-cancel').hidden=false;tell(`Listening for ${action.label}. Move or press the control you want; release held controls first.`);
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
  renderEditor();paintLive();
  return {poll,open,close,canClose,hasUnsavedChanges:()=>dirty,isEditing:()=>dirty||Boolean(capture),
    inputState(){const pad=selectedPad();return {buttons:previewBits,source:pad?`${selectedKey}:${pad.index}:${profile.id}`:null};},
    release(){cancelCapture();outputBits=0;},status(){
    const pad=selectedPad();return {open:!panel.hidden,dirty,capturing:capture?{action:capture.action,mode:capture.mode}:null,device:pad?{id:pad.id,mapping:pad.mapping||'',index:pad.index,buttons:pad.buttons.length,axes:pad.axes.length}:null,profile:clone(profile),mappedBits:previewBits,outputBits,storageAvailable,savedProfiles:settings.profiles.map(p=>({id:p.id,name:p.name}))};
  }};
}
