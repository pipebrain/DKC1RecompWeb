// Read back an actual WebGPU frame at a stock 4:3 presentation size.
// 1792 × 1344 expands every SNES texel by exactly 7 × 6 pixels.
export async function checkVideoPixels(){
  const {createPresenter}=await import('./graphics.js');
  const width=1792,height=1344;
  const canvas=document.createElement('canvas');
  canvas.style.cssText='position:fixed;left:-10000px;width:'+width/devicePixelRatio+'px;height:'+height/devicePixelRatio+'px';
  document.body.append(canvas);
  const context=canvas.getContext('webgpu'),configure=context.configure.bind(context);
  let device;
  context.configure=opts=>{
    device=opts.device;
    return configure({...opts,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
  };
  const presenter=await createPresenter(canvas);
  const staging=device.createBuffer({size:width*height*4,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
  try{
    const native=new Uint8Array(256*224*4);
    for(let y=0;y<224;y++)for(let x=0;x<256;x++){
      const index=(y*256+x)*4;
      native[index]=x;native[index+1]=y;native[index+2]=(x+y)%256;native[index+3]=255;
    }
    presenter.draw(native);
    if(canvas.width!==width||canvas.height!==height)throw new Error('Unexpected stock test canvas size.');
    const encoder=device.createCommandEncoder();
    encoder.copyTextureToBuffer({texture:context.getCurrentTexture()},{buffer:staging,bytesPerRow:width*4},{width,height});
    device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const pixels=new Uint8Array(staging.getMappedRange());
    const bgra=navigator.gpu.getPreferredCanvasFormat()==='bgra8unorm';
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const dst=(y*width+x)*4,src=(Math.floor(y/6)*256+Math.floor(x/7))*4;
      for(let c=0;c<3;c++)if(pixels[dst+c]!==native[src+(bgra?c:2-c)])throw new Error('Nearest source mismatch at '+x+', '+y);
      if(pixels[dst+3]!==255)throw new Error('Game output must be opaque.');
    }
    return {sourcePixels:256*224,matchingOutputPixels:width*height};
  }finally{staging.destroy();presenter.destroy();canvas.remove();}
}
