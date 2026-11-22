// Values shared by the Settings form, the worker, and the WebGPU presenter.
const percent = value => ({default:value,min:0,max:100,step:1});
export const VIDEO_OPTIONS = {
  hdTextures:[false,true],hdPolish:percent(0),hdFinish:percent(0),
  aspect:['4:3','16:10','16:9'], pixelAspect:['snes','square'],
  windowScale:['fit','1','2','3','4'], edge:['glide','reflect','bars','shift'],
  aquaticFixes:[false,true], frameGeneration:['off','poses','midpoints'],
  layer:['all','bg1','bg2','bg3','objects'], provenance:[false,true],
  screenColor:['raw','crt','composite','trinitron'], display:['flat','crt'],
  upscaler:['nearest','bilinear','reconstruct','sharp-bilinear'],
  reconstruction:['level-2','sharp','dither','diagonal','level-3'],
  strength:percent(100),softness:percent(50),shading:percent(60),
  crtPreset:['living-room','studio','soft','custom'],
  scanlines:percent(55),sharpness:percent(80),mask:['fine','none','coarse','slot'],
  maskStrength:percent(30),glow:percent(40),halation:percent(25),curvature:percent(50),
};
export const VIDEO_DEFAULTS=Object.fromEntries(Object.entries(VIDEO_OPTIONS)
  .map(([key,rule])=>[key,Array.isArray(rule)?rule[0]:rule.default]));
const presetKeys=['scanlines','sharpness','mask','maskStrength','glow','halation','curvature'];
const presets={
  'living-room':[55,80,'fine',30,40,25,50],
  studio:[85,95,'fine',40,25,15,0],
  soft:[35,50,'coarse',20,60,40,67],
};
export function videoChange(key,value) {
  if(key==='crtPreset' && presets[value])
    return Object.fromEntries([['crtPreset',value],...presetKeys.map((k,i)=>[k,presets[value][i]])]);
  if(presetKeys.includes(key)) return {[key]:value,crtPreset:'custom'};
  return {[key]:value};
}
export const widths={'4:3':256,'16:10':308,'16:9':342};
export function coreVideoArgs(p) {
  return [widths[p.aspect],['reflect','bars','shift','glide'].indexOf(p.edge),
    {all:255,bg1:1,bg2:2,bg3:4,objects:16}[p.layer],+p.provenance,+p.aquaticFixes,+(p.frameGeneration!=='off')];
}
