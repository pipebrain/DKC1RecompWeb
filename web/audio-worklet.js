class DkcAudio extends AudioWorkletProcessor {
  constructor() {
    super();
    this.capacity=32768;this.ring=new Float32Array(this.capacity*2);
    this.read=0;this.write=0;this.count=0;this.position=0;this.sourceRate=32040;
    this.enabled=true;this.started=false;this.underruns=0;this.overruns=0;this.report=0;
    this.port.onmessage=({data})=>{
      if(data.type==='samples') {
        const samples=new Int16Array(data.buffer), frames=samples.length/2;
        this.sourceRate=data.rate;
        if(frames>this.capacity-this.count){this.read=0;this.write=0;this.count=0;this.position=0;this.started=false;this.overruns++;}
        for(let i=0;i<frames;i++){this.ring[this.write*2]=samples[i*2]/32768;this.ring[this.write*2+1]=samples[i*2+1]/32768;this.write=(this.write+1)%this.capacity;}
        this.count+=frames;
        this.port.postMessage({type:'recycle-audio',buffer:data.buffer},[data.buffer]);
      } else if(data.type==='reset') {this.read=0;this.write=0;this.count=0;this.position=0;this.started=false;}
      else if(data.type==='enabled') this.enabled=data.enabled;
    };
  }
  process(inputs,outputs) {
    const [left,right]=outputs[0];
    if(!left)return true;
    if(!this.started && this.count>=1024)this.started=true;
    const step=this.sourceRate/sampleRate;
    let starved=false;
    for(let i=0;i<left.length;i++) {
      if(this.started && this.count>=2) {
        const next=(this.read+1)%this.capacity;
        const l=this.ring[this.read*2]*(1-this.position)+this.ring[next*2]*this.position;
        const r=this.ring[this.read*2+1]*(1-this.position)+this.ring[next*2+1]*this.position;
        left[i]=this.enabled?l:0;if(right)right[i]=this.enabled?r:0;
        this.position+=step;
        while(this.position>=1 && this.count>0){this.position--;this.read=(this.read+1)%this.capacity;this.count--;}
      } else {left[i]=0;if(right)right[i]=0;if(this.started)starved=true;}
    }
    if(starved){this.underruns++;this.started=false;}
    this.report+=left.length;
    if(this.report>=sampleRate){this.report=0;this.port.postMessage({type:'audio-stats',queuedFrames:this.count,underruns:this.underruns,overruns:this.overruns});}
    return true;
  }
}
registerProcessor('dkc-audio',DkcAudio);
