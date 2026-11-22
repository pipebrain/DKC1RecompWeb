// Verify supplied artwork reaches the native compositor and WebGPU upload.
// The fixture contains a solid test color and an upstream material identifier.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

export async function verifyHd({inPage,command,closeSettings,click,poll,reopen,report}){
  const material='b393096ae80aeec09bdf039cdeded5a724c8775831e2f75b3d1047edbf31abbf';
  const color=0xff6137bb;
  const saved=await inPage(()=>dkcDebug.saveBytes());
  async function pref(pane,key,value){
    await command('config',pane);
    await inPage((key,value)=>{const input=document.querySelector('[data-pref="'+key+'"]');input.checked=value;input.dispatchEvent(new Event('change',{bubbles:true}));},key,value);
    await closeSettings();
  }
  try{
    await pref('speed','assist',false);
    await command('config','paths');
    await inPage((key,color)=>{
      const data=new Uint8Array(12+128*128*4),header=new DataView(data.buffer);
      data.set(new TextEncoder().encode('DKHDv001'));header.setUint16(8,128,true);header.setUint16(10,128,true);
      new Uint32Array(data.buffer,12).fill(color);
      const upload=new DataTransfer();
      upload.items.add(new File([data],key+'.dkhd'));upload.items.add(new File(['DKHPv001 1\n'+key+'\n'],'preload.txt'));
      const folder=document.querySelector('#hd-folder');folder.files=upload.files;folder.dispatchEvent(new Event('change',{bubbles:true}));
    },material,color);
    await poll(()=>inPage(()=>document.querySelector('#hd-pack-status').textContent.includes('1 materials')),'import local HD material');
    await closeSettings();
    await inPage(async()=>{await dkcDebug.importSave(new Uint8Array(2048));await dkcDebug.flushSaves();});
    await pref('video','hdTextures',true);await reopen();
    await poll(()=>inPage(()=>dkcDebug.status().loaded&&dkcDebug.status().hdMaterials===1),'mount persisted HD material pack');
    await inPage(color=>{
      const original=GPUQueue.prototype.writeTexture;
      GPUQueue.prototype.writeTexture=function(destination,source,layout,size){
        if(size.width===1024&&size.height===896){
          const bytes=ArrayBuffer.isView(source)?source.buffer:source;
          const pixels=new Uint32Array(bytes,source.byteOffset||0,1024*896);
          let matching=0;
          for(const value of pixels)if((value&0xffffff)===(color&0xffffff))matching++;
          window.__hdFixturePixels=matching;
        }
        return original.call(this,destination,source,layout,size);
      };
    },color);
    const input=await readFile(new URL('../tests/fixtures/jungle-entry.inputs',import.meta.url),'utf8');
    const runs=input.split('\n').map(line=>/^([0-9a-f]+) \* (\d+)$/i.exec(line)).filter(Boolean)
      .map(([,mask,count])=>({buttons:parseInt(mask,16),count:Number(count)}));
    const result=await inPage(runs=>dkcDebug.replayFingerprints(runs),runs);
    assert.equal(result.fingerprints.frame_sha256,'506dbc580397d38d4fbd5331b18a732393da7467ae7455ffcf31193e11548d43');
    const changed=await poll(()=>inPage(()=>window.__hdFixturePixels>0&&window.__hdFixturePixels),'replacement pixels uploaded to WebGPU');
    report.hdFixturePixels=changed;
    report.checks.push('A local indexed HD material survived reopening Chrome. Jungle entry retained its native framebuffer hash while the 4× WebGPU upload contained the synthetic replacement color.');
  }finally{
    await command('config','paths');await click('#forget-hd');
    await poll(()=>inPage(()=>document.querySelector('#hd-pack-status').textContent.includes('No HD materials')),'clear HD material storage');
    await closeSettings();await pref('video','hdTextures',false);
    await inPage(async bytes=>{await dkcDebug.importSave(bytes);await dkcDebug.flushSaves();},saved);
  }
}
