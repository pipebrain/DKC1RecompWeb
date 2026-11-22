// Executed by fullscreen_check inside an actual Chrome page on the test origin.
// Read back the submitted GPU texture before the browser composites the canvas.
export async function checkVideoPixels(){
  const {createPresenter}=await import('./graphics.js');
  const {VIDEO_DEFAULTS,videoChange}=await import('./video-settings.js');
  const canvas=document.createElement('canvas');
  canvas.style.cssText='position:fixed;left:-10000px;width:'+512/devicePixelRatio+'px;height:'+448/devicePixelRatio+'px';
  document.body.append(canvas);
  const context=canvas.getContext('webgpu'),configure=context.configure.bind(context);
  context.configure=opts=>configure({...opts,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
  const p=await createPresenter(canvas);
  const errors=[];
  p.device.addEventListener('uncapturederror',event=>errors.push(event.error.message));
  const width=512,height=448;
  const staging=p.device.createBuffer({size:width*height*4,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
  function pattern(w,h,alpha){
    const pixels=new Uint8Array(w*h*4);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const index=(y*w+x)*4;
      const stripe=((x*3+y*2)%53)<27;
      pixels[index]=stripe?225:13;
      pixels[index+1]=27+((x+y)&7)*23;
      pixels[index+2]=stripe?230:59;
      pixels[index+3]=alpha;
    }
    return pixels;
  }
  const defaults={...VIDEO_DEFAULTS,pixelAspect:'square'};
  const native=pattern(256,224,255);
  async function capture(settings,bytes=native,w=256,h=224){
    p.configure({...defaults,...settings});
    p.draw(bytes,w,h);
    if(canvas.width!==width || canvas.height!==height)throw new Error('Unexpected test canvas size.');
    const encoder=p.device.createCommandEncoder();
    encoder.copyTextureToBuffer({texture:context.getCurrentTexture()},{buffer:staging,bytesPerRow:width*4},{width,height});
    p.device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const rgba=new Uint8Array(staging.getMappedRange()).slice();
    staging.unmap();
    return rgba;
  }
  async function hash(data){
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(n=>n.toString(16).padStart(2,'0')).join('');
  }
  try{
    const nearest=await capture({});
    const bgra=navigator.gpu.getPreferredCanvasFormat()==='bgra8unorm';
    // Test every output pixel against a 2× reference made directly from the source.
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const dst=(y*width+x)*4, src=((y>>1)*256+(x>>1))*4;
      for(let i=0;i<3;i++)if(nearest[dst+i]!==native[src+(bgra?i:2-i)])throw new Error('Nearest source mismatch at '+x+', '+y);
      if(nearest[dst+3]!==255)throw new Error('Game output must be opaque.');
    }
    const result={nearest:await hash(nearest)};
    for(const upscaler of ['bilinear','sharp-bilinear','reconstruct'])result[upscaler]=await hash(await capture({upscaler}));
    // At exactly 2×, sharp bilinear retains the original texel centers.
    if(result.nearest===result.bilinear || result.reconstruct===result.bilinear)throw new Error('Flat filters did not change the picture.');
    for(const preset of ['living-room','studio','soft']){
      result[preset]=await hash(await capture({display:'crt',...videoChange('crtPreset',preset)}));
    }
    if(new Set([result['living-room'],result.studio,result.soft,result.nearest]).size!==4)throw new Error('CRT preset outputs did not differ.');
    const hd=pattern(1024,896,0);
    result.hd=await hash(await capture({},hd,1024,896));
    result.protected=await hash(await capture({hdPolish:100},hd,1024,896));
    if(result.hd!==result.protected)throw new Error('HD polish changed protected pixels.');
    result.finish=await hash(await capture({hdFinish:75},hd,1024,896));
    if(result.finish===result.hd)throw new Error('HD finish did not change eligible HD output.');
    for(let i=3;i<hd.length;i+=4)hd[i]=255;
    result.polish=await hash(await capture({hdPolish:100},hd,1024,896));
    if(result.polish===result.hd)throw new Error('HD polish did not modify eligible edges.');
    if(errors.length)throw new Error(errors.join('\n'));
    return result;
  }finally{staging.destroy();p.destroy();canvas.remove();}
}
