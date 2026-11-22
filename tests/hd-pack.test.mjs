import test from 'node:test';
import assert from 'node:assert/strict';
import {collectHdPack} from '../web/hd-pack.js';

const key='b'.repeat(64);
function raster(name=key+'.dkhd'){
  const bytes=new Uint8Array(12+4*4*4),view=new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('DKHDv001'));view.setUint16(8,4,true);view.setUint16(10,4,true);
  return new File([bytes],name);
}
test('material folders keep validated rasters and native-readable metadata',async()=>{
  const pack=await collectHdPack([raster(),new File(['DKHPv001 1\n'+key+'\n'],'preload.txt'),new File(['ignored'],'notes.txt')]);
  assert.equal(pack.count,1);assert.equal(pack.rasters,1);assert.deepEqual(pack.assets.map(x=>x.name),[key+'.dkhd','preload.txt']);
});
test('invalid material indices and truncated images fail before import can replace an existing pack',async()=>{
  await assert.rejects(()=>collectHdPack([raster(),new File(['DKHPv001 1\n'+'a'.repeat(64)+'\n'],'preload.txt')]),/missing/);
  await assert.rejects(()=>collectHdPack([new File([headerOnly()],key+'.dkhd')]),/dimensions|length/);
  await assert.rejects(()=>collectHdPack([raster(),raster()]),/Repeated/);
});
function headerOnly(){
  return new Uint8Array([...new TextEncoder().encode('DKHDv001'),4,0,4,0]);
}
