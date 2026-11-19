import {keyboardCodeLabel} from './keyboard-profiles.js';
import {bindingLabel} from './gamepad-profiles.js';

// Presentation only: the canvas and SNES framebuffer are left untouched.
export function pausePresentation(state,{keyboard={},controller={},foreground=true,focused=true,menuOpen=false,dialogOpen=false,fullscreen=false}={}){
  if(!state.loaded||state.running||state.loading)return {visible:false};
  const verb=state.hasStarted?'resume':'start';
  let input,hint;
  if(state.inputMode==='gamepad'){
    const {device,profile}=controller;
    const bindings=(profile?.bindings?.start||[]).filter(binding=>binding.type==='button'?binding.index<(device?.buttons||0):binding.index<(device?.axes||0));
    const compatible=device&&(profile?.id!=='standard'||device.mapping==='standard');
    input=device?`Gamepad · ${(profile?.name||'Controller').slice(0,48)}`:'Gamepad · Disconnected';
    if(compatible&&bindings.length){
      const labels=bindings.slice(0,2).map(bindingLabel).join(' or ');
      hint=`Press Start (${labels}) to ${verb}.`;
    }else{
      const configure=fullscreen?'press Escape to configure Input':'configure Input';
      hint=device?`No usable Start binding. Press Space to ${verb}, or ${configure}.`:`Connect your controller, or press Space to ${verb}.`;
    }
  }else{
    const labels=(keyboard.bindings?.start||[]).slice(0,2).map(keyboardCodeLabel);
    const key=labels.length?labels.join(' or '):'Space';
    input=`Keyboard · ${key}`;
    hint=`Press ${key} to ${verb}.`;
  }
  if(state.playbackError||['error','gpu-error'].includes(state.pausedReason))return {visible:true,title:'Game stopped',input,hint:fullscreen?'Press Escape, then reload this browser page.':'Reload this browser page, then load your ROM.'};
  if(state.resuming)return {visible:true,title:state.hasStarted?'Resuming…':'Starting…',input,hint:'Please wait.'};
  const steps=[];
  if(!foreground)steps.push('Return to this page');
  if(dialogOpen)steps.push('close the dialog');
  else if(menuOpen)steps.push('close the menu');
  if(!focused)steps.push('click the game screen');
  if(steps.length){
    const prefix=steps.join(', then ');hint=`${prefix[0].toUpperCase()+prefix.slice(1)}. ${hint}`;
  }
  return {visible:true,title:state.hasStarted?'Paused':'Ready to Start',input,hint};
}
