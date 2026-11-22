// v0.0.17 Dkc1Msu1Mix timing and loop policy. Read PCM pages on demand in
// the dedicated game worker so a complete soundtrack never needs to fit in RAM.
const LOOP = [1,1,1,1,1,1,1,1,1,1,0,1,1,1,1,0,1,0,0,1,1,1,1,1,1,0,0];
export class MusicPlayer {
  constructor(pack, gain = 1) {
    this.tracks = new Map(pack.tracks.map(track => [track.number,track]));
    this.gain = gain;
    this.reader = new FileReaderSync();
    this.reset();
  }
  reset() {
    this.state = -1;
    this.track = null;
    this.playing = false;
    this.page = null;
  }
  sample() {
    if (this.position >= this.track.frames) {
      if (!this.loop) return null;
      this.position = this.track.loop;
    }
    const offset = 8 + this.position++ * 4;
    if (!this.page || offset < this.pageStart || offset + 4 > this.pageStart + this.page.byteLength) {
      this.pageStart = offset;
      this.page = new DataView(this.reader.readAsArrayBuffer(this.track.file.slice(offset,offset + 65536)));
    }
    const local = offset - this.pageStart;
    // Pack both signed channels in one integer to avoid allocating per sample.
    return this.page.getInt32(local,true);
  }
  observe(state) {
    if (this.state === state) return;
    this.state = state;
    this.page = null;
    const theme = state & 65535;
    this.track = state >>> 16 ? this.tracks.get(theme + 1) : null;
    this.playing = false;
    if (!this.track) return;
    this.loop = Boolean(LOOP[theme]) && this.track.loop < this.track.frames;
    this.position = 0;
    this.phase = 0;
    this.current = this.sample();
    this.next = this.sample();
    this.playing = this.current !== null && this.next !== null;
  }
  mix(samples, rate) {
    for (let i = 0; this.playing && i < samples.length; i += 2) {
      // Native C uses integer (toward-zero) division before applying gain.
      const first = rate - this.phase;
      for (let c = 0; c < 2; c++) {
        const a = c ? this.current >> 16 : (this.current << 16) >> 16;
        const b = c ? this.next >> 16 : (this.next << 16) >> 16;
        const linear = Math.trunc((a * first + b * this.phase) / rate);
        samples[i+c] = Math.max(-32768,Math.min(32767,samples[i+c] + Math.trunc(linear*this.gain)));
      }
      this.phase += 44100;
      while (this.phase >= rate) {
        this.phase -= rate;
        this.current = this.next;
        this.next = this.sample();
        if (this.next === null) {this.playing = false;break;}
      }
    }
  }
}
