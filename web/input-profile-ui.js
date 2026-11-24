import {ACTIONS,bindingLabel,detectBinding} from './gamepad-profiles.js';
import {keyboardCodeLabel,keyboardEventCode} from './keyboard-profiles.js';
import {INPUT_PROFILES_KEY,newProfile,validateInputProfiles} from './input-profiles.js';

const labels=new Map(ACTIONS.map(({id})=>[id,id.length===1?id.toUpperCase():id[0].toUpperCase()+id.slice(1)]));
const directions=['up','right','down','left'];

function inputLabel(binding) {
  if(binding.kind==='keyboard')return 'Keyboard · '+(binding.code==='ShiftLeft'?'Shift':keyboardCodeLabel(binding.code));
  if(binding.kind==='mouse')return 'Mouse · Button '+binding.button;
  const input=binding.input;
  return binding.label+' · '+(input.type==='button'?'Button '+input.index:bindingLabel(input));
}

function capturePadBinding(previous,pad,action) {
  const found=detectBinding(previous,pad);
  if(found?.type==='axis-value'&&Math.abs(previous.axes[found.index])>1&&directions.includes(action)){
    const cardinal=-1+directions.indexOf(action)*4/7;
    if(Math.abs(found.value-cardinal)<.08)return {type:'hat',index:found.index,direction:action};
  }
  return found;
}

async function playRumble(pad,values) {
  const [duration,low,high]=values;
  const effect={duration,startDelay:0,strongMagnitude:low/100,weakMagnitude:high/100};
  const motors=[pad.vibrationActuator,...(pad.hapticActuators??[])];
  const dual=motors.find(motor=>typeof motor?.playEffect==='function'&&
    (motor.effects?motor.effects.includes('dual-rumble'):!motor.type||motor.type==='dual-rumble'));
  if(dual){
    try{
      const result=await dual.playEffect('dual-rumble',effect);
      if(result!=='not-supported')return result;
    }catch(error){if(error.name!=='NotSupportedError')throw error;}
  }
  const legacy=motors.find(motor=>typeof motor?.pulse==='function');
  if(legacy)return await legacy.pulse(Math.max(low,high)/100,duration)?'complete':'preempted';
  return 'not-supported';
}

export function initInputProfileUI({initial,routing,openProfile,goBack,renameTitle,notify,onChange}) {
  const byId=id=>document.getElementById(id);
  const selectors=[byId('player-one'),byId('player-two')];
  const list=byId('profile-list'),add=byId('add-profile'),empty=byId('profiles-empty');
  const mappings=byId('profile-mappings'),dialog=byId('binding-dialog'),cancel=byId('cancel-binding');
  const nameDialog=byId('profile-dialog'),nameField=byId('profile-name'),deleteDialog=byId('delete-profile-dialog');
  const stomp=byId('stomp-rumble'),advanced=byId('rumble-advanced');
  const rumbleFields=[...advanced.querySelectorAll('input[type="number"]')];
  const sliders=[null,byId('rumble-low-slider'),byId('rumble-high-slider')];
  let value=initial,selected=null,capture=null,renaming=false,stored;
  try{stored=localStorage.getItem(INPUT_PROFILES_KEY);}catch{/* Initial preferences may be session-only. */}
  const edited=()=>value.profiles.find(profile=>profile.id===selected);
  const report=error=>notify(error.message||String(error));
  function store(next){
    try {
      const checked=validateInputProfiles(next),encoded=JSON.stringify(checked);
      if(localStorage.getItem(INPUT_PROFILES_KEY)!==stored)throw new Error('Input profiles changed in another tab. Reload to apply the other changes.');
      localStorage.setItem(INPUT_PROFILES_KEY,encoded);
      stored=encoded;value=checked;routing.apply(value);onChange();
      return true;
    }catch(error){report(error);return false;}
  }
  function updateProfile(update){
    const next=structuredClone(value);
    const profile=next.profiles.find(profile=>profile.id===selected);
    update(profile);
    return store(next);
  }
  function paintSelectors(){
    const options=[...value.profiles.map(profile=>[profile.id,profile.name]),['','Disabled']];
    selectors.forEach((select,port)=>{
      select.replaceChildren(...options.map(([id,name])=>new Option(name,id)));
      select.value=value.players[port]??'';
    });
  }
  function showProfiles(){
    list.replaceChildren(...value.profiles.map(profile=>{
      const item=byId('profile-list-item').content.firstElementChild.cloneNode(true);
      const button=item.querySelector('button');
      button.dataset.profile=profile.name;
      button.querySelector('span').textContent=profile.name;
      button.addEventListener('click',()=>edit(profile.id,button));
      return item;
    }));
    empty.hidden=value.profiles.length>0;
    paintSelectors();
  }
  function focusMapping(action){
    mappings.querySelector(`[data-input="${labels.get(action)}"] button`)?.focus({preventScroll:true});
  }
  function showMappings(){
    const bindings=edited().bindings;
    mappings.replaceChildren(...ACTIONS.map(({id:action})=>{
      const label=labels.get(action),row=byId('mapping-row-template').content.firstElementChild.cloneNode(true);
      row.dataset.input=label;
      row.querySelector('strong').textContent=label;
      const summary=row.querySelector('.supporting');
      const found=bindings.filter(binding=>binding.action===action);
      if(!found.length)summary.textContent='Unassigned';
      for(const binding of found){
        const line=document.createElement('div');
        line.textContent=inputLabel(binding);summary.append(line);
      }
      const [set,clear]=row.querySelectorAll('button');
      set.setAttribute('aria-label','Set '+label);set.setAttribute('aria-haspopup','dialog');
      clear.setAttribute('aria-label','Clear '+label);clear.disabled=!found.length;
      set.addEventListener('click',()=>startCapture(action,set));
      clear.addEventListener('click',()=>{
        if(!updateProfile(profile=>{profile.bindings=profile.bindings.filter(binding=>binding.action!==action);}))return;
        showMappings();focusMapping(action);
        const previous=found.length===1?inputLabel(found[0]):found.length+' bindings';
        notify(label+' bindings cleared.',previous+' → Unassigned');
      });
      return row;
    }));
  }
  function showRumble(){
    const profile=edited();
    stomp.checked=profile.rumbleEnabled;
    advanced.hidden=!stomp.checked;
    profile.rumble.forEach((value,index)=>{
      rumbleFields[index].value=value;
      if(sliders[index])sliders[index].value=value;
    });
  }
  async function edit(id,opener){
    selected=id;
    showMappings();showRumble();
    await openProfile(edited().name,opener);
  }
  selectors.forEach((select,port)=>select.addEventListener('change',()=>{
    const before=value.profiles.find(profile=>profile.id===value.players[port])?.name??'Disabled';
    const next=structuredClone(value);
    next.players[port]=select.value||null;
    const after=select.selectedOptions[0].text;
    if(store(next))notify('Setting saved.',`Player ${port+1} profile · ${before} → ${after}`);
    else paintSelectors();
  }));

  function askName(trigger,rename){
    renaming=rename;
    nameDialog.querySelector('h2').textContent=rename?'Rename profile':'New profile';
    nameDialog.querySelector('[type="submit"]').textContent=rename?'Rename profile':'Create profile';
    nameField.value=rename?edited().name:'';
    nameField.setCustomValidity('');
    trigger.focus({preventScroll:true});
    nameDialog.showModal();
    if(rename)nameField.select();
  }
  add.addEventListener('click',()=>askName(add,false));
  byId('rename-profile').addEventListener('click',event=>askName(event.currentTarget,true));
  byId('cancel-profile').addEventListener('click',()=>nameDialog.close());
  nameField.addEventListener('input',()=>nameField.setCustomValidity(''));
  byId('new-profile').addEventListener('submit',async event=>{
    event.preventDefault();
    const name=nameField.value.trim(),before=renaming?edited().name:null;
    const taken=name.toLowerCase()==='disabled'||value.profiles.some(profile=>
      (!renaming||profile.id!==selected)&&profile.name.toLowerCase()===name.toLowerCase());
    nameField.setCustomValidity(!name?'Enter a name.':taken?'This entry already exists.':'');
    if(!nameField.reportValidity())return;
    if(name===before){nameDialog.close();return;}
    const id=renaming?selected:crypto.randomUUID(),next=structuredClone(value);
    if(renaming)next.profiles.find(profile=>profile.id===id).name=name;
    else next.profiles.push(newProfile(id,name));
    if(!store(next))return;
    nameDialog.close();
    showProfiles();
    if(renaming){
      renameTitle(name);notify('Profile renamed.',before+' → '+name);
    }else{
      await edit(id,add);
      notify('Profile saved.',name);
    }
  });
  byId('delete-profile').addEventListener('click',event=>{
    const name=edited().name;
    byId('delete-profile-message').textContent=value.players.includes(selected)
      ?`Delete “${name}”? Players using it will switch to Disabled.`
      :`Delete “${name}” and its device mappings?`;
    event.currentTarget.focus({preventScroll:true});
    deleteDialog.showModal();
  });
  byId('cancel-delete-profile').addEventListener('click',()=>deleteDialog.close());
  byId('confirm-delete-profile').addEventListener('click',async()=>{
    const name=edited().name;
    const players=value.players.flatMap((id,port)=>id===selected?[`Player ${port+1} profile`]:[]);
    const next={...value,profiles:value.profiles.filter(profile=>profile.id!==selected),
      players:value.players.map(id=>id===selected?null:id)};
    if(!store(next))return;
    deleteDialog.close();
    selected=null;showProfiles();await goBack();
    notify('Profile deleted.',players.length?name+' · '+players.join(', ')+' → Disabled':name);
  });

  function snapshot(pad){
    return {buttons:Array.from(pad.buttons,button=>typeof button==='number'?button:button.value??Number(button.pressed)),
      axes:Array.from(pad.axes)};
  }
  function startCapture(action,trigger){
    trigger.focus({preventScroll:true});
    byId('binding-title').textContent='Set '+labels.get(action);
    capture={action,rest:new Map(routing.devices().map(({key,pad})=>[key,snapshot(pad)]))};
    dialog.showModal();
  }
  function stopCapture(){
    capture=null;
    if(dialog.open)dialog.close();
  }
  function addBinding(binding){
    stopCapture();
    const label=labels.get(binding.action),description=inputLabel(binding);
    const exists=edited().bindings.some(item=>item.action===binding.action&&item.kind===binding.kind&&(
      item.kind==='keyboard'?item.code===binding.code:item.kind==='mouse'?item.button===binding.button:
        item.device===binding.device&&item.input.type===binding.input.type&&item.input.index===binding.input.index&&
        item.input.direction===binding.input.direction&&item.input.value===binding.input.value));
    if(!exists){
      if(!updateProfile(profile=>profile.bindings.push(binding)))return;
      showMappings();focusMapping(binding.action);
    }
    notify(label+(exists?' is already bound.':' binding saved.'),description);
  }
  function pollCapture(){
    if(!capture)return;
    for(const {key,pad} of routing.devices()){
      const previous=capture.rest.get(key);
      if(!previous){capture.rest.set(key,snapshot(pad));continue;}
      const input=capturePadBinding(previous,pad,capture.action);
      if(input){
        addBinding({action:capture.action,kind:'gamepad',device:key,label:`Gamepad ${pad.index+1} · ${pad.id||'Controller'}`,input});
        return;
      }
      // An input held while the dialog opened can be learned after release.
      pad.buttons.forEach((button,index)=>{
        const value=typeof button==='number'?button:button.value??Number(button.pressed);
        if(value<.5)previous.buttons[index]=value;
      });
    }
  }
  dialog.addEventListener('keydown',event=>{
    if(!capture||event.code==='Escape'||event.code==='Tab'||
      (event.target===cancel&&['Enter','Space'].includes(event.code)))return;
    const code=keyboardEventCode(event);
    if(!code)return;
    event.preventDefault();
    if(!event.repeat)addBinding({action:capture.action,kind:'keyboard',code});
  });
  function captureMouse(event){
    if(!capture||cancel.contains(event.target)||(event.pointerType&&event.pointerType!=='mouse'))return;
    const {left,top,right,bottom}=dialog.getBoundingClientRect();
    if(event.clientX<left||event.clientX>=right||event.clientY<top||event.clientY>=bottom)return;
    if(event.type==='contextmenu'?event.button!==2:event.button<0)return;
    event.preventDefault();
    if(event.type==='pointerdown'&&event.button===2)return;
    addBinding({action:capture.action,kind:'mouse',button:event.button});
  }
  dialog.addEventListener('pointerdown',captureMouse);
  dialog.addEventListener('contextmenu',captureMouse);
  dialog.addEventListener('cancel',event=>{event.preventDefault();stopCapture();});
  cancel.addEventListener('click',stopCapture);
  window.addEventListener('blur',stopCapture);

  stomp.addEventListener('change',()=>{
    const enabled=stomp.checked;
    if(updateProfile(profile=>{profile.rumbleEnabled=enabled;}))notify('Setting saved.',enabled?'Rumble · Off → On':'Rumble · On → Off');
    showRumble();
  });
  rumbleFields.forEach((field,index)=>{
    const slider=sliders[index],label=['Rumble duration','Low motor level','High motor level'][index],unit=index?'%':' ms';
    const change=()=>{
      if(!field.validity.valid){showRumble();return;}
      const before=edited().rumble[index],after=field.valueAsNumber;
      if(after!==before&&updateProfile(profile=>{profile.rumble[index]=after;}))
        notify('Setting saved.',`${label} · ${before}${unit} → ${after}${unit}`);
      showRumble();
    };
    field.addEventListener('input',()=>{if(slider&&field.validity.valid)slider.value=field.value;});
    field.addEventListener('change',change);
    slider?.addEventListener('input',()=>{field.value=slider.value;});
    slider?.addEventListener('change',()=>{
      field.value=slider.value;
      change();
    });
  });
  byId('preview-stomp').addEventListener('click',async()=>{
    if(!rumbleFields.every(field=>field.reportValidity()))return;
    const profile=edited(),devices=routing.padsForProfile(profile);
    if(!devices.length){notify('Rumble: no controller assigned.');return;}
    const values=rumbleFields.map(field=>field.valueAsNumber);
    try{
      const results=await Promise.all(devices.map(pad=>playRumble(pad,values)));
      if(results.includes('complete'))notify(`Rumble: ${values[0]} ms · Low ${values[1]}% · High ${values[2]}%`);
      else if(results.every(result=>result==='not-supported'))notify('Rumble: the browser exposes no rumble output for this controller.');
      else notify('Rumble: test pulse interrupted.');
    }catch(error){notify('Rumble: '+error.message);}
  });
  function pulseStomp(){
    const active=new Set();
    for(const [port,id] of value.players.entries()){
      const profile=value.profiles.find(item=>item.id===id);
      if(!profile?.rumbleEnabled)continue;
      for(const {pad} of routing.activePads(port))if(!active.has(pad)){
        active.add(pad);playRumble(pad,profile.rumble).catch(()=>{});
      }
    }
  }

  showProfiles();
  return {
    exportSettings:()=>value,
    applySettings(next){
      value=next;stored=localStorage.getItem(INPUT_PROFILES_KEY);
      routing.apply(next);showProfiles();
    },
    pollCapture,stopCapture,pulseStomp,
    assistKey:id=>value.shortcuts.keyboard[id],
  };
}
