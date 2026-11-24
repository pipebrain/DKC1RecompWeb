import {keyboardCodeLabel} from './keyboard-profiles.js';
import {bindingLabel} from './gamepad-profiles.js';

function resumeInput(mode,keyboard,controller,shortcutKeys,mouseStart=[]){
  const keys=(keyboard?.bindings?.start||[]).filter(code=>!shortcutKeys.includes(code)).slice(0,2).map(keyboardCodeLabel);
  const {device,profile}=controller||{};
  const usablePad=device&&(device.mapping==='standard'||profile?.id!=='standard');
  const buttons=usablePad?(profile?.bindings?.start||[]).filter(binding=>
    binding.type==='button'?binding.index<device.buttons:binding.index<device.axes).slice(0,2).map(bindingLabel):[];
  const key=keys.join(' or '),padStart=buttons.length?'Start ('+buttons.join(' or ')+')':'';
  const mouse=mouseStart.slice(0,2).map(button=>'Mouse Button '+button).join(' or ');
  const start=(...bindings)=>bindings.filter(Boolean).join(' or ');
  if(mode==='both')return {input:'Keyboard and gamepad',binding:start(key,padStart,mouse)};
  if(mode==='gamepad')return {input:device?`Gamepad · ${(profile?.name||'Controller').slice(0,48)}`:'Gamepad · Disconnected',binding:start(padStart,mouse)};
  if(mode==='keyboard')return {input:key?'Keyboard · '+key:'Keyboard',binding:start(key,mouse)};
  if(mode==='mouse')return {input:'Mouse',binding:mouse};
  return {input:'Input disabled',binding:''};
}

// The first player's hint keeps its short form on single-player layouts.
export function pausePresentation(state,{keyboard={},controller={},secondPlayer,mouseStart,shortcutKeys=[],foreground=true,focused=true,menuOpen=false,dialogOpen=false,fullscreen=false}={}){
  if(!state.loaded||state.running||state.loading)return {visible:false};
  const verb=state.hasStarted?'resume':'start';
  const firstMode=state.inputMode||'keyboard';
  const first=resumeInput(firstMode,keyboard,controller,shortcutKeys,mouseStart);
  const second=secondPlayer&&secondPlayer.mode!=='none'?
    resumeInput(secondPlayer.mode,secondPlayer.keyboard,secondPlayer.controller,shortcutKeys,secondPlayer.mouseStart):null;
  let input=first.input,binding=first.binding;
  if(second){
    input=firstMode==='none'?'Player 2 · '+second.input:`P1 · ${first.input} / P2 · ${second.input}`;
    binding=[first.binding&&'P1 '+first.binding,second.binding&&'P2 '+second.binding].filter(Boolean).join(' or ');
  }
  let hint;
  if(binding)hint=`Press ${binding} to ${verb}.`;
  else{
    const keyboardActive=[firstMode,secondPlayer?.mode].some(mode=>mode==='both'||mode==='keyboard');
    const spaceCanResume=!(keyboardActive&&shortcutKeys.includes('Space'));
    const fallback=spaceCanResume?`Press Space to ${verb}`:`Choose ${state.hasStarted?'Resume Game':'Start Game'}`;
    if(!second&&firstMode==='gamepad'&&!controller.device)hint=`Connect your controller, or ${fallback[0].toLowerCase()+fallback.slice(1)}.`;
    else if(!second&&firstMode==='gamepad')hint=`No usable Start binding. ${fallback}, or ${fullscreen?'press Escape to configure Input':'configure Input'}.`;
    else hint=fallback+'.';
  }
  if(state.playbackError||['error','gpu-error'].includes(state.pausedReason))return {visible:true,title:'Game stopped',input,hint:fullscreen?'Press Escape, then reload this browser page.':'Reload this browser page, then load your ROM.'};
  if(state.resuming)return {visible:true,title:state.hasStarted?'Resuming…':'Starting…',input,hint:'Please wait.'};
  const steps=[];
  if(!foreground)steps.push('Return to this page');
  if(dialogOpen)steps.push('close the dialog');
  else if(menuOpen)steps.push('close the menu');
  if(!focused)steps.push('focus the game screen');
  if(steps.length){
    const prefix=steps.join(', then ');hint=`${prefix[0].toUpperCase()+prefix.slice(1)}. ${hint}`;
  }
  return {visible:true,title:state.hasStarted?'Paused':'Ready to Start',input,hint};
}
