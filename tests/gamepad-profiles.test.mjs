import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIONS,DEFAULT_PROFILE,createProfile,validateProfile,parseProfile,
  serializeProfile,evaluateProfile,detectBinding,bindingLabel,
} from '../web/gamepad-profiles.js';

// Browser-shaped raw fixture using only the user's reported index ranges.
// Its hat values are synthetic examples, not a verified SN30 Pro+ mapping.
function rawPad() {
  return {id:'8BitDo SN30 Pro+ (Vendor: 2dc8 Product: 6102)',mapping:'',
    connected:true,index:0,buttons:Array.from({length:12},()=>({pressed:false,value:0})),
    axes:[0,0,0,0,0,0,0,0,0,3.285714]};
}
function press(pad,index,value=1) {pad.buttons[index]={pressed:value>=0.5,value};}
function profile() {return createProfile('My raw controller',rawPad());}
function bind(value,action,binding) {value.bindings[action].push(binding);return value;}

test('default standard profile preserves all existing button and axis masks',()=>{
  const standard=rawPad();standard.mapping='standard';
  standard.buttons=Array.from({length:16},()=>({pressed:false,value:0}));
  const assignments={b:0,y:2,select:8,start:9,up:12,down:13,left:14,right:15,a:1,x:3,l:4,r:5};
  for(const action of ACTIONS){
    const pad=structuredClone(standard);press(pad,assignments[action.id]);
    assert.equal(evaluateProfile(DEFAULT_PROFILE,pad),action.bit,action.id);
  }
  for(const [index,value,bit] of [[0,-1,64],[0,1,128],[1,-1,16],[1,1,32]]){
    const pad=structuredClone(standard);pad.axes[index]=value;
    assert.equal(evaluateProfile(DEFAULT_PROFILE,pad),bit);
  }
  standard.axes[0]=0.35;standard.axes[1]=-0.35;
  assert.equal(evaluateProfile(DEFAULT_PROFILE,standard),0,'deadzone boundary remains released');
  const raw=rawPad();press(raw,0);
  assert.equal(evaluateProfile(DEFAULT_PROFILE,raw),0,'raw pads need an explicit custom mapping');
  assert(Object.isFrozen(DEFAULT_PROFILE.bindings.up[0]));
});

test('custom raw profiles read B0-B7, B10/B11 and stick axes 0/1/2/5',()=>{
  const mapping=profile();
  const indices=[0,1,2,3,4,5,6,7,10,11];
  indices.forEach((index,n)=>bind(mapping,ACTIONS[n].id,{type:'button',index}));
  for(let n=0;n<indices.length;n++){
    const pad=rawPad();press(pad,indices[n]);
    assert.equal(evaluateProfile(mapping,pad),ACTIONS[n].bit);
  }
  const sticks=profile();
  for(const [action,index,direction] of [['left',0,-1],['up',1,-1],['right',2,1],['down',5,1]])
    bind(sticks,action,{type:'axis',index,direction});
  const pad=rawPad();pad.axes[0]=-.7;pad.axes[1]=-.8;pad.axes[2]=.6;pad.axes[5]=.9;
  assert.equal(evaluateProfile(sticks,pad),64|16|128|32);
  pad.connected=false;assert.equal(evaluateProfile(sticks,pad),0);
});

test('multiple bindings OR together; missing, non-finite and out-of-range axes stay released',()=>{
  const mapping=profile();bind(mapping,'b',{type:'button',index:0});bind(mapping,'b',{type:'button',index:10});
  bind(mapping,'left',{type:'axis',index:9,direction:1});
  bind(mapping,'up',{type:'axis',index:30,direction:-1});
  const pad=rawPad();press(pad,10);assert.equal(evaluateProfile(mapping,pad),1);
  press(pad,0);assert.equal(evaluateProfile(mapping,pad),1);
  press(pad,0,0);press(pad,10,0);pad.axes[9]=NaN;
  assert.equal(evaluateProfile(mapping,pad),0);
  pad.axes[9]=Infinity;assert.equal(evaluateProfile(mapping,pad),0);
  assert.equal(evaluateProfile(mapping,null),0);
});

test('rest-offset axes do not fire a resting trigger and obey explicit thresholds',()=>{
  const mapping=profile();bind(mapping,'r',{type:'axis',index:5,direction:1,rest:-1,threshold:.5});
  const pad=rawPad();pad.axes[5]=-1;assert.equal(evaluateProfile(mapping,pad),0);
  pad.axes[5]=-.51;assert.equal(evaluateProfile(mapping,pad),0);
  pad.axes[5]=-.49;assert.equal(evaluateProfile(mapping,pad),2048);
  pad.axes[5]=1;assert.equal(evaluateProfile(mapping,pad),2048);
});

test('explicit common eight-way hat binding handles diagonals and neutral without stick shortcuts',()=>{
  const mapping=profile();
  for(const direction of ['up','right','down','left']) bind(mapping,direction,{type:'hat',index:9,direction});
  const masks=[16,16|128,128,128|32,32,32|64,64,64|16];
  const pad=rawPad();assert.equal(evaluateProfile(mapping,pad),0,'out-of-range neutral');
  pad.axes[9]=0;assert.equal(evaluateProfile(mapping,pad),0,'center is not an encoded hat sector');
  for(let i=0;i<8;i++){
    pad.axes[9]=-1+i*2/7;assert.equal(evaluateProfile(mapping,pad),masks[i],`sector ${i}`);
  }
});

test('exact axis values allow arbitrary hats and alternatives without assuming vendor orientation',()=>{
  const mapping=profile();bind(mapping,'up',{type:'axis-value',index:9,value:-.75,tolerance:.02});
  bind(mapping,'up',{type:'axis-value',index:9,value:-.5,tolerance:.02});
  const pad=rawPad();assert.equal(evaluateProfile(mapping,pad),0);
  pad.axes[9]=-.75;assert.equal(evaluateProfile(mapping,pad),16);
  pad.axes[9]=-.51;assert.equal(evaluateProfile(mapping,pad),16);
  pad.axes[9]=-.8;assert.equal(evaluateProfile(mapping,pad),0);
});

test('capture uses actual changes instead of absolute resting values',()=>{
  const neutral=rawPad(),pressed=structuredClone(neutral);press(pressed,11);
  assert.deepEqual(detectBinding(neutral,pressed),{type:'button',index:11});
  assert.equal(detectBinding(neutral,neutral),null);
  const stick=structuredClone(neutral);stick.axes[5]=-.9;
  assert.deepEqual(detectBinding(neutral,stick),{type:'axis',index:5,direction:-1,rest:0,threshold:.35});
  const triggerNeutral=rawPad();triggerNeutral.axes[2]=-1;
  const trigger=structuredClone(triggerNeutral);trigger.axes[2]=.6;
  const captured=detectBinding(triggerNeutral,trigger);
  const mapping=profile();bind(mapping,'b',captured);
  assert.equal(evaluateProfile(mapping,triggerNeutral),0);assert.equal(evaluateProfile(mapping,trigger),1);
  const hat=structuredClone(neutral);hat.axes[9]=-1;
  assert.deepEqual(detectBinding(neutral,hat),{type:'axis-value',index:9,value:-1,tolerance:.08});
  assert.deepEqual(detectBinding(neutral,hat,{mode:'hat',hatDirection:'up'}),{type:'hat',index:9,direction:'up'});
});

test('profile roundtrip preserves all bindings, identity and device metadata without aliasing defaults',()=>{
  const mapping=createProfile('Custom copy',rawPad(),DEFAULT_PROFILE);
  bind(mapping,'b',{type:'axis-value',index:9,value:-.4,tolerance:.01});
  const copy=parseProfile(serializeProfile(mapping));
  assert.deepEqual(copy,mapping);assert.notEqual(copy.bindings.b,mapping.bindings.b);
  assert.equal(DEFAULT_PROFILE.bindings.b.length,1);
  assert.equal(copy.device.axes,10);assert.equal(copy.device.mapping,'');
  const exportedDefault=parseProfile(serializeProfile(DEFAULT_PROFILE));
  assert.notEqual(exportedDefault.id,'standard');assert.deepEqual(exportedDefault.bindings,DEFAULT_PROFILE.bindings);
  assert.match(bindingLabel({type:'axis-value',index:9,value:-1}),/Axis 9/);
});

test('imports reject corrupt versions, builtin overrides, invalid indices and prototype payloads',()=>{
  const original=profile();
  assert.throws(()=>parseProfile('{oops'),/valid JSON/);
  assert.throws(()=>parseProfile(' '.repeat(65537)),/64 KiB/);
  assert.throws(()=>parseProfile(JSON.stringify({...original,version:2})),/format or version/);
  assert.throws(()=>validateProfile({...original,id:'standard'}),/built-in/);
  for(const bad of [
    {type:'button',index:-1},{type:'button',index:1.5},{type:'axis',index:2,direction:0},
    {type:'axis',index:2,direction:1,rest:3.285},{type:'axis-value',index:9,value:NaN},
    {type:'hat',index:9,direction:'diagonal'},{type:'script',source:'alert(1)'},
  ])assert.throws(()=>validateProfile({...original,bindings:{b:[bad]}}));
  assert.throws(()=>validateProfile({...original,bindings:{b:Array(17).fill({type:'button',index:0})}}),/at most 16/);
  assert.throws(()=>validateProfile({...original,bindings:{jump:[]}}),/Unknown/);
  const poisoned=JSON.stringify(original).replace('"bindings":{','"bindings":{"__proto__":{},');
  assert.throws(()=>parseProfile(poisoned),/Unknown/);
  assert.throws(()=>validateProfile(Object.assign(Object.create({name:'inherited'}),original)),/must be an object/);
  assert.equal({}.polluted,undefined);
});

test('portable controller settings preserve legacy profiles and validate both routes and shortcuts',async()=>{
  const {defaultControllerSettings,validateControllerSettings}=await import('../web/gamepad-profiles.js');
  const profile=createProfile('Raw',rawPad()),defaults=defaultControllerSettings();
  const legacy={profiles:[profile],assignments:{first:profile.id},lastDevice:'first'};
  const result=validateControllerSettings(legacy);
  assert.deepEqual(result.player2,defaults.player2);assert.equal(result.assignments.first,profile.id);
  result.captureMode='hat';result.lastProfile=profile.id;result.player2.deadzone=0;
  result.player2.assignments.second='standard';result.player2.lastDevice='second';result.assistBindings['quick-save']={type:'axis',index:5,direction:1};
  assert.deepEqual(validateControllerSettings(JSON.parse(JSON.stringify(result))),result);
  assert.throws(()=>validateControllerSettings({...result,profiles:[profile,profile]}),/Duplicate/);
  assert.throws(()=>validateControllerSettings({...result,player2:{...result.player2,lastProfile:'missing'}}),/Unknown/);
  assert.throws(()=>validateControllerSettings({...result,rumble:'yes'}),/rumble/);
  assert.throws(()=>validateControllerSettings({...result,assistBindings:{...result.assistBindings,'quick-load':{type:'button',index:256}}}),/index/);
});

test('a per-player dead zone and a consumed Assist binding only affect their mapped input',()=>{
  const pad=rawPad();pad.mapping='standard';pad.axes[0]=0.3;press(pad,0);
  assert.equal(evaluateProfile(DEFAULT_PROFILE,pad),1);
  assert.equal(evaluateProfile(DEFAULT_PROFILE,pad,.25),129);
  assert.equal(evaluateProfile(DEFAULT_PROFILE,pad,.25,[{type:'button',index:0}]),128);
});
