export async function createPresenter(canvas) {
  if (!navigator.gpu) throw new Error('WebGPU is unavailable. Use a WebGPU-enabled browser over HTTPS or localhost.');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('No WebGPU adapter is available in this browser on this device.');
  const device = await adapter.requestDevice();
  const context = canvas.getContext('webgpu');
  if (!context) throw new Error('Could not create the WebGPU canvas.');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({device, format, alphaMode: 'opaque'});
  const texture = device.createTexture({size: [256,224],format:'bgra8unorm',usage:GPUTextureUsage.COPY_DST|GPUTextureUsage.TEXTURE_BINDING});
  const sampler = device.createSampler({magFilter:'nearest',minFilter:'nearest'});
  const module = device.createShaderModule({code:`
    struct Vertex { @builtin(position) position: vec4f, @location(0) uv: vec2f }
    @vertex fn vs(@builtin(vertex_index) i: u32) -> Vertex {
      let p = array(vec2f(-1.,-1.),vec2f(3.,-1.),vec2f(-1.,3.));
      var v: Vertex; v.position=vec4f(p[i],0.,1.);
      v.uv=vec2f((p[i].x+1.)*.5,(1.-p[i].y)*.5); return v;
    }
    @group(0) @binding(0) var frame: texture_2d<f32>;
    @group(0) @binding(1) var nearest: sampler;
    @fragment fn fs(v:Vertex) -> @location(0) vec4f {
      return vec4f(textureSample(frame,nearest,v.uv).rgb,1.);
    }`});
  const pipeline = await device.createRenderPipelineAsync({layout:'auto',vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',targets:[{format}]},primitive:{topology:'triangle-list'}});
  const bindings = device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:texture.createView()},{binding:1,resource:sampler}]});
  let lost = null, scale = null;
  device.lost.then(info => { lost = new Error(`WebGPU device lost: ${info.message || info.reason}`); });
  function render() {
    if (lost) throw lost;
    const bounds = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1,
      device.limits.maxTextureDimension2D / Math.max(1, bounds.width, bounds.height));
    const width = Math.max(1,Math.round(bounds.width*ratio));
    const height = Math.max(1,Math.round(bounds.height*ratio));
    if (canvas.width!==width || canvas.height!==height) {canvas.width=width;canvas.height=height;}
    const encoder=device.createCommandEncoder();
    const pass=encoder.beginRenderPass({colorAttachments:[{view:context.getCurrentTexture().createView(),clearValue:{r:0,g:0,b:0,a:1},loadOp:'clear',storeOp:'store'}]});
    const targetAspect=scale===null?4/3:256/224;
    const viewWidth=Math.min(width,height*targetAspect,scale===null?Infinity:224*scale*targetAspect*ratio);
    const viewHeight=viewWidth/targetAspect;
    pass.setViewport((width-viewWidth)/2,(height-viewHeight)/2,viewWidth,viewHeight,0,1);
    pass.setPipeline(pipeline);pass.setBindGroup(0,bindings);pass.draw(3);pass.end();
    device.queue.submit([encoder.finish()]);
  }
  function draw(buffer) {
    if (lost) throw lost;
    if (buffer.byteLength !== 256 * 224 * 4) throw new Error('Expected a 256 × 224 stock frame.');
    device.queue.writeTexture({texture},buffer,{bytesPerRow:1024,rowsPerImage:224},{width:256,height:224});
    render();
  }
  let resizeFrame = 0, destroyed = false;
  function scheduleResize() {
    if (resizeFrame || destroyed || lost) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      if (!destroyed && !lost) render();
    });
  }
  const observer = new ResizeObserver(scheduleResize);
  observer.observe(canvas);
  window.addEventListener('resize', scheduleResize);
  document.addEventListener('fullscreenchange', scheduleResize);
  function clear() { draw(new Uint8Array(256 * 224 * 4)); }
  clear();
  return {draw, clear, device, setScale(value){if(scale!==value){scale=value;scheduleResize();}}, destroy(){
    destroyed = true;
    observer.disconnect();
    cancelAnimationFrame(resizeFrame);
    window.removeEventListener('resize', scheduleResize);
    document.removeEventListener('fullscreenchange', scheduleResize);
    texture.destroy();device.destroy();
  }};
}
