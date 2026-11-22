import {VIDEO_DEFAULTS,widths} from './video-settings.js';

function smoothstep(low,high,value) {
  const t=Math.min(1,Math.max(0,(value-low)/(high-low)));
  return t*t*(3-2*t);
}

// Same beam, mask transmission and scale fades as runner/desktop_crt.c.
function parameters(p,width,height,viewWidth,viewHeight) {
  let mask=['none','fine','coarse','slot'].indexOf(p.mask);
  let strength=p.maskStrength/100*smoothstep(5,7,viewWidth/width);
  if(mask===0 || strength<.005) {mask=0;strength=0;}
  const gain=1/((1-2*strength/3)*(mask===3?1-strength/6:1));
  const curve=.03*p.curvature/100;
  const filter=p.upscaler==='reconstruct'?
    ['sharp','dither','diagonal','level-2','level-3'].indexOf(p.reconstruction):
    ['nearest','bilinear','reconstruct','sharp-bilinear'].indexOf(p.upscaler);
  return new Float32Array([
    width,height,viewWidth,viewHeight,filter,p.strength/100,p.softness/100,p.shading/100,
    .6-.35*p.sharpness/100,.5-.32*p.scanlines/100,.5,smoothstep(3,5,viewHeight/height),
    0,0,.2*p.glow/100,.2*p.halation/100,curve,.6*curve,curve ? .015 : 0,curve ? .03 : 0,
    mask===3?2:Math.min(1,mask),mask===1?3:6,strength,gain,
  ]);
}

export async function createPresenter(canvas) {
  if (!navigator.gpu) throw new Error('WebGPU is unavailable. Use a WebGPU-enabled browser over HTTPS or localhost.');
  const adapter=await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('No WebGPU adapter is available on this device.');
  const device=await adapter.requestDevice();
  const context=canvas.getContext('webgpu');
  if (!context) throw new Error('Could not create the WebGPU canvas.');
  const format=navigator.gpu.getPreferredCanvasFormat();
  context.configure({device,format,alphaMode:'opaque'});
  const response=await fetch(new URL('./video.wgsl',import.meta.url));
  if(!response.ok)throw new Error('Could not load the video shaders.');
  const module=device.createShaderModule({label:'DKC video',code:await response.text()});
  const info=await module.getCompilationInfo();
  const errors=info.messages.filter(m=>m.type==='error');
  if(errors.length)throw new Error(errors.map(e=>'Video shader line '+e.lineNum+': '+e.message).join('\n'));
  const fragment=GPUShaderStage.FRAGMENT;
  const layout=device.createBindGroupLayout({entries:[
    {binding:0,visibility:fragment,texture:{}},{binding:1,visibility:fragment,sampler:{}},
    {binding:2,visibility:fragment,buffer:{type:'uniform',hasDynamicOffset:true}},
    {binding:3,visibility:fragment,texture:{}},{binding:4,visibility:fragment,texture:{}},
  ]});
  const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]});
  const names=['flat','reconstruct','lines','beam','down','blur','compose','hdFinish'];
  const pipelines=Object.fromEntries(await Promise.all(names.map(async name=>{
    const target=['flat','reconstruct','compose'].includes(name)?format:name==='hdFinish'?'bgra8unorm':'rgba16float';
    const pipeline=await device.createRenderPipelineAsync({label:name,layout:pipelineLayout,
      vertex:{module,entryPoint:'vertex'},fragment:{module,entryPoint:name,targets:[{format:target}]},
      primitive:{topology:'triangle-list'}});
    return [name,pipeline];
  })));
  const sampler=device.createSampler({magFilter:'linear',minFilter:'linear'});
  const stride=device.limits.minUniformBufferOffsetAlignment;
  const paramsBuffer=device.createBuffer({size:stride*12,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  const textures=new Map(),bindings=new Map();
  let source,sourceWidth=256,sourceHeight=224,blank=true;
  let prefs={...VIDEO_DEFAULTS},lost=null,destroyed=false,resizeFrame=0;
  device.lost.then(info=>{lost=new Error('WebGPU device lost: '+(info.message||info.reason));});
  function texture(name,width,height,format,usage) {
    let item=textures.get(name);
    if(item && item.width===width && item.height===height)return item;
    item?.texture.destroy();
    bindings.clear();
    const tex=device.createTexture({label:name,size:[width,height],format,usage});
    item={texture:tex,view:tex.createView(),name,width,height};
    textures.set(name,item);
    return item;
  }
  function target(name,width,height,format='rgba16float') {
    return texture(name,width,height,format,GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING);
  }
  function bind(input,glow=input,halo=input) {
    const key=input.name+' '+glow.name+' '+halo.name;
    if(!bindings.has(key))bindings.set(key,device.createBindGroup({layout,entries:[
      {binding:0,resource:input.view},{binding:1,resource:sampler},
      {binding:2,resource:{buffer:paramsBuffer,size:96}},
      {binding:3,resource:glow.view},{binding:4,resource:halo.view},
    ]}));
    return bindings.get(key);
  }
  function render(){
    if(lost)throw lost;
    if(!source || destroyed)return;
    const bounds=canvas.getBoundingClientRect(),dpr=window.devicePixelRatio||1;
    const limit=device.limits.maxTextureDimension2D;
    const factor=Math.min(dpr,limit/Math.max(1,bounds.width),limit/Math.max(1,bounds.height));
    const width=Math.max(1,Math.round(bounds.width*factor)),height=Math.max(1,Math.round(bounds.height*factor));
    if(canvas.width!==width || canvas.height!==height){canvas.width=width;canvas.height=height;}
    const aspect=sourceWidth/sourceHeight*(prefs.pixelAspect==='square'?1:7/6);
    let w=Math.min(width,height*aspect);
    if(!document.fullscreenElement && prefs.windowScale!=='fit')
      w=Math.min(w,224*aspect*Number(prefs.windowScale)*factor);
    const vw=Math.max(1,Math.round(w)),vh=Math.max(1,Math.round(w/aspect));
    const viewport=[(width-w)/2,(height-w/aspect)/2,w,w/aspect,0,1];
    const surface=context.getCurrentTexture().createView();
    const encoder=device.createCommandEncoder();
    const values=parameters(prefs,sourceWidth,sourceHeight,vw,vh);
    let index=0;
    function pass(name,input,output,light=input,halo=input) {
      const offset=index++*stride;
      device.queue.writeBuffer(paramsBuffer,offset,values);
      const commands=encoder.beginRenderPass({colorAttachments:[{view:output?.view??surface,
        clearValue:{r:0,g:0,b:0,a:1},loadOp:'clear',storeOp:'store'}]});
      if(!output)commands.setViewport(...viewport);
      commands.setPipeline(pipelines[name]);commands.setBindGroup(0,bind(input,light,halo),[offset]);
      commands.draw(3);commands.end();
    }
    let input=source;
    if(sourceHeight===224*4 && (prefs.hdFinish>0 || prefs.hdPolish>0)){
      const finished=target('HD finish',sourceWidth,sourceHeight,'bgra8unorm');
      const strength=values[5],softness=values[6];
      values[5]=(prefs.hdFinish??0)/100;values[6]=(prefs.hdPolish??0)/100;
      pass('hdFinish',source,finished);
      values[5]=strength;values[6]=softness;input=finished;
    }
    if(prefs.display==='crt') {
      const lines=target('scanlines',vw,sourceHeight),beam=target('beam',vw,vh);
      pass('lines',input,lines);pass('beam',lines,beam);
      const blur=(name,from,divisor)=>{
        const w=Math.max(1,Math.floor(vw/divisor)),h=Math.max(1,Math.floor(vh/divisor));
        const a=target(name,w,h),b=target(name+' horizontal',w,h);
        pass('down',from,a);
        values[12]=1;values[13]=0;pass('blur',a,b);
        values[12]=0;values[13]=1;pass('blur',b,a);
        return a;
      };
      const glow=blur('glow',beam,4),halo=blur('halation',glow,16);
      pass('compose',beam,null,glow,halo);
    }else{
      pass(prefs.upscaler==='reconstruct'?'reconstruct':'flat',input,null);
    }
    device.queue.submit([encoder.finish()]);
  }
  function draw(buffer,width=256,height=224) {
    if(lost)throw lost;
    if(buffer.byteLength!==width*height*4)throw new Error('Invalid frame dimensions.');
    sourceWidth=width;sourceHeight=height;blank=false;
    source=texture('cartridge',width,height,'bgra8unorm',GPUTextureUsage.COPY_DST|GPUTextureUsage.TEXTURE_BINDING);
    device.queue.writeTexture({texture:source.texture},buffer,{bytesPerRow:width*4},{width,height});
    render();
  }
  function clear(){
    const width=widths[prefs.aspect];
    draw(new Uint8Array(width*224*4),width,224);blank=true;
  }
  function scheduleResize(){
    if(resizeFrame || destroyed || lost)return;
    resizeFrame=requestAnimationFrame(()=>{resizeFrame=0;if(!destroyed && !lost)render();});
  }
  const observer=new ResizeObserver(scheduleResize);observer.observe(canvas);
  window.addEventListener('resize',scheduleResize);document.addEventListener('fullscreenchange',scheduleResize);
  clear();
  return {draw,device,clear,configure(player){
      prefs={...VIDEO_DEFAULTS,...player};
      if(blank && widths[prefs.aspect]!==sourceWidth)clear();else render();
    },
    destroy(){
      destroyed=true;observer.disconnect();cancelAnimationFrame(resizeFrame);
      window.removeEventListener('resize',scheduleResize);document.removeEventListener('fullscreenchange',scheduleResize);
      for(const item of textures.values())item.texture.destroy();
      paramsBuffer.destroy();device.destroy();
    }};
}
