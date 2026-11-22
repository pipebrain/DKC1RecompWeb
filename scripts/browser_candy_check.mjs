// End-to-end Candy regression for the local browser check harness.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';

const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');

export async function verifyCandyRestart({
  referencePath,rom,root,report,evaluate,poll,screenshot,chooseDkmFile,dkmCommand,restart,
}){
  const referenceBytes=await readFile(referencePath);
  const oracle=JSON.parse(referenceBytes);
  const starterPath=join(dirname(referencePath),'starter.srm');
  const starter=await readFile(starterPath);
  const lock=JSON.parse(await readFile(join(root,'upstream.lock.json'),'utf8'));
  assert.equal(oracle.rom_sha256,lock.rom.sha256,'The native oracle must use the locked ROM.');
  assert.equal(oracle.upstream_revision,lock.dkc1recomp.revision,'Wrong native DKC1Recomp revision.');
  assert.equal(oracle.engine_revision,lock.snesrecomp.revision,'Wrong native engine revision.');
  assert.equal(starter.length,2048,'The starter must be a complete cartridge save.');
  assert.equal(sha256(starter),oracle.starter_sha256,'Starter SRAM differs from the native fixture.');
  assert.match(oracle.saved_sha256,/^[0-9a-f]{64}$/);
  assert.notEqual(oracle.saved_sha256,oracle.starter_sha256,'Candy must produce a distinguishable save.');
  const evidence=report.candy={referenceSha256:sha256(referenceBytes),referencePath,
    scriptSha256:sha256(await readFile(new URL(import.meta.url))),
    starterSha256:oracle.starter_sha256,save:[],reopen:[]};

  const liveSaveHash=async()=>sha256(Buffer.from(await evaluate('window.dkcDebug.saveBytes()')));

  async function waitForCartridge(){
    return poll(async()=>{
      const value=await evaluate('window.dkcDebug.status()');
      if(value.loaded&&!value.loading)return value;
      return false;
    },'cartridge ready to play',60000);
  }
  async function reloadGame(){
    await dkmCommand('reset-game');
    await poll(()=>evaluate(`/Game reloaded/i.test(document.querySelector('#status').textContent) && !window.dkcDebug.status().loading`),'DKM Reload Game');
    assert.equal((await evaluate('window.dkcDebug.status()')).frameCount,0);
  }

  async function runRoute(leg){
    let frame=0;
    const checkpoints=oracle[leg].checkpoints;
    assert(checkpoints.length>=2,`Missing native ${leg} checkpoints.`);
    for(const checkpoint of checkpoints){
      const {name,runs,frame_sha256}=checkpoint;
      assert.match(name,/^[a-z0-9_-]+$/i);
      assert.match(frame_sha256,/^[0-9a-f]{64}$/);
      assert(runs.length>0,`Missing controller input at ${name}.`);
      for(const {count,buttons} of runs){
        assert(Number.isSafeInteger(count)&&count>=1&&count<=100000);
        assert(Number.isInteger(buttons)&&buttons>=0&&buttons<=4095);
        frame+=count;
        const state=await evaluate(`window.dkcDebug.runFrames(${count},${buttons})`);
        assert.equal(state.frameCount,frame,`Unexpected frame at ${name}.`);
      }
      const rendered=await evaluate('window.dkcDebug.frameHash()');
      assert.equal(rendered.frameCount,frame);
      evidence[leg].push({name,frame,sha256:rendered.sha256,expected:frame_sha256});
      await poll(()=>evaluate(`window.dkcDebug.status().presentedFrame===${frame}`),'WebGPU checkpoint presentation');
      // The debug replay pauses between exact frame counts. Uncover the game
      // for evidence without advancing a frame or changing cartridge state.
      const oldVisibility=await evaluate(`(()=>{
        const node=document.querySelector('#pause-overlay'),old=node.style.visibility;
        node.style.visibility='hidden';return old;
      })()`);
      try{await screenshot(`${leg}-${name}.png`);}
      finally{await evaluate(`document.querySelector('#pause-overlay').style.visibility=${JSON.stringify(oldVisibility)}`);}
      assert.equal(rendered.sha256,frame_sha256,`${leg}: ${name} differs from the native framebuffer.`);
    }
  }

  await chooseDkmFile('open-rom',rom,'rom-file');
  const first=await waitForCartridge();
  assert.equal(first.frameCount,0);
  assert.equal(first.running,false);
  await chooseDkmFile('import-save',starterPath,'save-file');
  await poll(async()=>await liveSaveHash()===oracle.starter_sha256,'starter SRAM imported through DKM');
  await reloadGame();
  assert.equal(await liveSaveHash(),oracle.starter_sha256);
  assert.equal(report.attempts.at(-1).fileChoosers.length,2,'Setup should open only the ROM and starter-save pickers.');
  await runRoute('save');
  evidence.savedSha256=await liveSaveHash();
  assert.equal(evidence.savedSha256,oracle.saved_sha256,'Fresh cartridge SRAM differs from the native Candy save.');
  // Read back the normal host's committed record. Do not force a save from
  // the test: the player must be able to close Chrome after the barrel writes.
  evidence.persistedSha256=await poll(async()=>{
    const bytes=await evaluate(`(async()=>{
      const {loadSave}=await import('./storage.js');
      const value=await loadSave();
      return value ? Array.from(new Uint8Array(value)) : null;
    })()`);
    if(!bytes)return false;
    const digest=sha256(Buffer.from(bytes));
    return digest===oracle.saved_sha256?digest:false;
  },'Candy SRAM committed by the host');
  report.checks.push('In-game controller inputs reached Candy and produced new SRAM matching the native save byte for byte.');

  evidence.restart=await restart();
  const cold=await waitForCartridge();
  assert.equal(cold.hasStarted,false);
  assert.equal(cold.running,false);
  assert.equal(cold.frameCount,0,'A cold boot must start at frame zero.');
  evidence.coldSramSha256=await liveSaveHash();
  assert.equal(evidence.coldSramSha256,oracle.saved_sha256,'Wrong SRAM restored before the first game frame.');
  await runRoute('reopen');
  const before=evidence.save.find(point=>point.name==='file-select');
  const after=evidence.reopen.find(point=>point.name==='file-select');
  assert(before&&after,'Both cold boots must capture the in-game file selection screen.');
  assert.equal(before.frame,after.frame,'Compare the file-selection screen at the same frame.');
  assert.notEqual(before.sha256,after.sha256,'The reopened game must display the updated slot.');
  assert.equal(report.attempts.at(-1).fileChoosers.length,0,'Restoring the cartridge or save opened a file picker.');
  report.checks.push('A new Chrome process restored the ROM and exact Candy SRAM without opening a file picker. In-game file selection and the continued game matched native framebuffers.');
  // One uninterrupted replay from the restored battery also exercises the
  // cumulative PCM and game-state oracle. It follows the cold-boot UI check.
  const fingerprints=oracle.reopen.fingerprints;
  assert(fingerprints?.audio_fnv1a,'Missing native PCM oracle for the restored game.');
  await reloadGame();
  const runs=oracle.reopen.checkpoints.flatMap(point=>point.runs);
  const replay=await evaluate(`window.dkcDebug.replayFingerprints(${JSON.stringify(runs)})`);
  assert.equal(replay.frameCount,evidence.reopen.at(-1).frame);
  assert.deepEqual(replay.fingerprints,fingerprints,'Restored game diverged from native memory, video or audio.');
  evidence.continuedFingerprints=replay.fingerprints;
  report.checks.push('Replaying the restored slot matched native WRAM, graphics memory, framebuffer and cumulative audio.');
}
