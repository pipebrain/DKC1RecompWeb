// WebGPU translation of DKC1Recomp v0.0.17 runner/macos_graphics.metal.
// The CRT operates in linear light and encodes sRGB at the final pass.
struct Vertex { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
struct Params {
  sourceOutput: vec4f, // source dimensions, presentation dimensions
  filtering: vec4f,       // mode, strength, softness, shading
  beam: vec4f,         // horizontal sigma, dark sigma, bright sigma, fade
  blur: vec4f,         // direction, glow, halation
  tube: vec4f,         // curvature x/y, corner radius, vignette
  mask: vec4f,         // kind, pitch, strength, gain
}
@group(0) @binding(0) var frame: texture_2d<f32>;
@group(0) @binding(1) var linearSampler: sampler;
@group(0) @binding(2) var<uniform> params: Params;
@group(0) @binding(3) var glowImage: texture_2d<f32>;
@group(0) @binding(4) var haloImage: texture_2d<f32>;

@vertex fn vertex(@builtin(vertex_index) i:u32) -> Vertex {
  let pts = array(vec2f(-1.,-1.),vec2f(3.,-1.),vec2f(-1.,3.));
  let p = pts[i];
  return Vertex(vec4f(p,0.,1.),vec2f((p.x+1.)*.5,(1.-p.y)*.5));
}
fn pixel(at:vec2i) -> vec3f {
  return textureLoad(frame,clamp(at,vec2i(0),vec2i(textureDimensions(frame))-1),0).rgb;
}
fn sampleFrame(uv:vec2f) -> vec3f {
  return textureSampleLevel(frame,linearSampler,uv,0).rgb;
}
@fragment fn flat(v:Vertex) -> @location(0) vec4f {
  let size=vec2f(textureDimensions(frame));
  if(params.filtering.x==0.) { return vec4f(pixel(vec2i(v.uv*size)),1); }
  if(params.filtering.x==1.) { return vec4f(sampleFrame(v.uv),1); }
  let scale=max(params.sourceOutput.zw/size,vec2f(1));
  let p=v.uv*size-.5;
  let f=saturate((fract(p)-(.5-.5/scale))*scale);
  return vec4f(sampleFrame((floor(p)+f+.5)/size),1);
}

fn diff(a:vec3f,b:vec3f) -> f32 {
  return dot(abs(a-b),vec3f(.299,.587,.114))*2.+abs((a.r-b.r)-(a.b-b.b))*.5;
}
fn equal(a:vec3f,b:vec3f) -> bool { return diff(a,b)<.004; }
fn decode(c:vec3f,n:vec3f,s:vec3f,w:vec3f,e:vec3f,nw:vec3f,ne:vec3f,sw:vec3f,se:vec3f) -> vec3f {
  if(params.filtering.x<1.) { return c; }
  if(equal(c,nw)&&equal(c,ne)&&equal(c,sw)&&equal(c,se)&&equal(n,s)&&equal(n,e)&&equal(n,w)&&!equal(c,n)){return mix(c,n,.5);}
  if(equal(c,n)&&equal(c,s)&&equal(e,ne)&&equal(e,se)&&equal(w,nw)&&equal(w,sw)&&equal(e,w)&&!equal(c,e)){return mix(c,e,.5);}
  if(equal(c,e)&&equal(c,w)&&equal(n,ne)&&equal(n,nw)&&equal(s,se)&&equal(s,sw)&&equal(n,s)&&!equal(c,n)){return mix(c,n,.5);}
  return c;
}
@fragment fn reconstruct(v:Vertex) -> @location(0) vec4f {
  let size=params.sourceOutput.xy;
  let pos=v.uv*size;
  let t=vec2i(floor(pos));
  let fp=fract(pos);
  let dir=select(vec2i(-1),vec2i(1),fp>=vec2f(.5));
  let f=abs(fp-.5)+.5;
  let scale=max(params.sourceOutput.zw/size,vec2f(1));
  let band=1.+2.*params.filtering.z;
  let aa=min(scale.x,scale.y)/band;
  let dx=vec2i(dir.x,0);
  let dy=vec2i(0,dir.y);
  let B1=pixel(t-2*dy); let C1=pixel(t+dx-2*dy);
  let A=pixel(t-dx-dy); let B=pixel(t-dy); let C=pixel(t+dx-dy); let C4=pixel(t+2*dx-dy);
  let D0=pixel(t-2*dx); let D=pixel(t-dx); let E=pixel(t); let F=pixel(t+dx); let F4=pixel(t+2*dx);
  let G0=pixel(t-2*dx+dy); let G=pixel(t-dx+dy); let H=pixel(t+dy); let I=pixel(t+dx+dy); let I4=pixel(t+2*dx+dy);
  let G5=pixel(t-dx+2*dy); let H5=pixel(t+2*dy); let I5=pixel(t+dx+2*dy);
  let e=decode(E,B,H,D,F,A,C,G,I); let fc=decode(F,C,I,E,F4,B,C4,H,I4);
  let hc=decode(H,E,H5,G,I,D,F,G5,I5); let ic=decode(I,F,I5,H,I4,E,F4,H5,I5);
  let adj=.5*saturate((f-(1.-.5*band/scale))*scale/band);
  var base=mix(mix(e,fc,adj.x),mix(hc,ic,adj.x),adj.y);
  let g=f-.5;
  let gradient=mix(mix(e,fc,g.x),mix(hc,ic,g.x),g.y);
  let similarity=max(max(diff(e,fc),diff(e,hc)),diff(e,ic));
  base=mix(base,gradient,params.filtering.w*(1.-smoothstep(.03,.14,similarity)));
  let wd1=diff(E,C)+diff(E,G)+diff(I,H5)+diff(I,F4)+4.*diff(H,F);
  let wd2=diff(H,D)+diff(H,I5)+diff(F,I4)+diff(F,B)+4.*diff(E,I);
  if(params.filtering.x<2. || wd1>=wd2 || equal(E,H) || equal(E,F) || (equal(E,I)&&equal(H,F))) { return vec4f(base,1); }
  let nc=select(hc,fc,diff(E,F)<=diff(E,H));
  var cov=saturate((f.x+f.y-1.5)*aa+.5);
  if(params.filtering.x>=3.) {
    let left=2.*diff(F,G)<=diff(H,C) && !equal(E,G) && !equal(D,G);
    let up=diff(F,G)>=2.*diff(H,C) && !equal(E,C) && !equal(B,C);
    if(left){cov=max(cov,saturate((2.*f.x+f.y-2.)*aa*.75+.5));}
    if(up){cov=max(cov,saturate((f.x+2.*f.y-2.)*aa*.75+.5));}
    if(params.filtering.x>=4.) {
      if(left && 4.*diff(F,G)<=diff(H,C) && !equal(E,G0) && !equal(D0,G0)){cov=max(cov,saturate((3.*f.x+f.y-2.5)*aa*.6+.5));}
      if(up && diff(F,G)>=4.*diff(H,C) && !equal(E,C1) && !equal(B1,C1)){cov=max(cov,saturate((f.x+3.*f.y-2.5)*aa*.6+.5));}
    }
  }
  return vec4f(mix(base,nc,cov*params.filtering.y),1);
}

fn srgbDecode(c:vec3f) -> vec3f {
  return select(c/12.92,pow((c+.055)/1.055,vec3f(2.4)),c>=vec3f(.04045));
}
fn srgbEncode(c:vec3f) -> vec3f {
  let x=saturate(c);
  return select(x*12.92,1.055*pow(x,vec3f(1./2.4))-.055,x>=vec3f(.0031308));
}
@fragment fn lines(v:Vertex) -> @location(0) vec4f {
  let size=vec2f(textureDimensions(frame));
  let p=v.uv*size;
  let c=floor(p.x);
  let inv=-.5/(params.beam.x*params.beam.x);
  var rgb=vec3f(0); var sum=0.;
  for(var k=-2;k<=2;k++){
    let x=c+f32(k); let d=x+.5-p.x; let w=exp(d*d*inv);
    rgb+=w*srgbDecode(pixel(vec2i(i32(x),i32(p.y)))); sum+=w;
  }
  return vec4f(rgb/sum,1);
}
@fragment fn beam(v:Vertex) -> @location(0) vec4f {
  let dim=textureDimensions(frame); let p=v.uv*vec2f(dim);
  let i0=i32(floor(p.y-.5)); var rgb=vec3f(0);
  for(var k=-1;k<=2;k++){
    let i=i0+k;
    if(i>=0 && i<i32(dim.y)){
      let line=saturate(pixel(vec2i(i32(p.x),i)));
      let sigma=mix(vec3f(params.beam.y),vec3f(params.beam.z),sqrt(line));
      let d=p.y-(f32(i)+.5);
      rgb+=line*exp(-d*d/(2.*sigma*sigma))/(sigma*2.5066283);
    }
  }
  return vec4f(mix(pixel(vec2i(p)),rgb,params.beam.w),1);
}
@fragment fn down(v:Vertex) -> @location(0) vec4f {
  let t=1./vec2f(textureDimensions(frame));
  let c=sampleFrame(v.uv-t)+sampleFrame(v.uv+t)+sampleFrame(v.uv+vec2f(t.x,-t.y))+sampleFrame(v.uv+vec2f(-t.x,t.y));
  return vec4f(c*.25,1);
}
@fragment fn blur(v:Vertex) -> @location(0) vec4f {
  let stride=params.blur.xy/vec2f(textureDimensions(frame));
  var c=sampleFrame(v.uv); var sum=1.;
  for(var k=1;k<=4;k++){
    let w=exp(-f32(k*k)/8.); let offset=stride*f32(k);
    c+=w*(sampleFrame(v.uv+offset)+sampleFrame(v.uv-offset)); sum+=2.*w;
  }
  return vec4f(c/sum,1);
}
fn grain(p:vec2f) -> f32 { return fract(52.9829189*fract(.06711056*p.x+.00583715*p.y)); }
@fragment fn compose(v:Vertex) -> @location(0) vec4f {
  let size=params.sourceOutput.zw; let p=v.uv*2.-1.;
  let q=p*(1.+params.tube.xy*p.yx*p.yx)*(1.+max(params.tube.x,params.tube.y));
  let uv=(q+1.)*.5; let edgePixels=min(uv*size,(1.-uv)*size);
  let radius=params.tube.z*size.y;
  let inside=select(min(edgePixels.x,edgePixels.y),radius-length(max(vec2f(radius)-edgePixels,vec2f(0))),radius>0.);
  let sc=saturate(uv);
  var c=sampleFrame(sc)*(1.-params.blur.z-params.blur.w)
    +textureSampleLevel(glowImage,linearSampler,sc,0).rgb*params.blur.z
    +textureSampleLevel(haloImage,linearSampler,sc,0).rgb*params.blur.w;
  if(params.mask.x>0.) {
    let col=floor(v.pos.x);
    let stripe=floor((col%params.mask.y)*3./params.mask.y);
    let transmission=select(vec3f(0),vec3f(1),vec3f(stripe)==vec3f(0,1,2));
    var mask=mix(vec3f(1),transmission,params.mask.z);
    let shift=(floor(col/params.mask.y)%2.)*params.mask.y*.5;
    if(params.mask.x==2. && ((floor(v.pos.y)+shift)%params.mask.y)<1.){mask*=1.-params.mask.z;}
    c*=params.mask.w*mask;
  }
  let knee=.9;
  c=select(c,knee+(1.-knee)*tanh((c-knee)/(1.-knee)),c>=vec3f(knee));
  c*=smoothstep(-.5,.5,inside)*(1.-params.tube.w*smoothstep(.5,1.5,length(p)));
  let noise=grain(v.pos.xy)-grain(v.pos.xy+vec2f(17,41));
  return vec4f(srgbEncode(c)+noise*(.5/255.),1);
}

fn luma(c:vec3f) -> f32 { return dot(c,vec3f(.2126,.7152,.0722)); }
fn finishCurve(x:f32) -> f32 {
  if(x<.18){return x*(.17/.18);}
  if(x<.50){return .17+(x-.18)*(.31/.32);}
  if(x<.78){return .48+(x-.50)*(.25/.28);}
  return .73+(x-.78)*(.21/.22);
}
fn finishHash(p:vec2u,seed:u32) -> f32 {
  var x=(p.x*0x9e3779b9u) ^ (p.y*0x85ebca6bu) ^ seed;
  x ^= x>>16; x*=0x7feb352du; x^=x>>15; x*=0x846ca68bu; x^=x>>16;
  return f32(x&0xffffu)/65535.;
}
@fragment fn hdFinish(v:Vertex) -> @location(0) vec4f {
  let size=vec2i(textureDimensions(frame));
  let p=clamp(vec2i(v.uv*vec2f(size)),vec2i(0),size-1);
  let uv=(vec2f(p)+.5)/vec2f(size);
  let finish=params.filtering.y; let polish=params.filtering.z;
  var c=pixel(p);
  if(polish>0.) {
    var safe=true;
    for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
      let cell=clamp(p/4+vec2i(x,y),vec2i(0),size/4-1);
      if(textureLoad(frame,cell*4,0).a<1.){safe=false;}
    }}
    if(safe) {
      let nw=luma(pixel(p+vec2i(-1,-1))); let ne=luma(pixel(p+vec2i(1,-1)));
      let sw=luma(pixel(p+vec2i(-1,1))); let se=luma(pixel(p+vec2i(1,1)));
      let lo=min(luma(c),min(min(nw,ne),min(sw,se))); let hi=max(luma(c),max(max(nw,ne),max(sw,se)));
      let tangent=vec2f(-(nw+ne-sw-se),nw+sw-ne-se);
      let mag=max(abs(tangent.x),abs(tangent.y));
      if(hi-lo>=max(.045,hi*.18) && mag>=.03){
        let offset=tangent/mag*.75/vec2f(size);
        let filtered=.5*(sampleFrame(uv-offset)+sampleFrame(uv+offset));
        if(luma(filtered)>=lo && luma(filtered)<=hi){c=mix(c,filtered,polish*.65);}
      }
    }
  }
  if(finish>0.){
    let subdued=mix(vec3f(luma(c)),c,.92);
    let grade=vec3f(finishCurve(subdued.r),finishCurve(subdued.g),finishCurve(subdued.b));
    let noise=finishHash(vec2u(p),0x1234u)-finishHash(vec2u(p),0x9abcu);
    c=saturate(c+(grade-c+noise*.010)*finish*3.);
  }
  return vec4f(c,1);
}
