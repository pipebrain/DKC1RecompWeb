// Run with the pinned Node build tool. The imports are the browser's own code.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {importsFor} from '../web/wasm-imports.js';

const module = await WebAssembly.compile(await readFile(new URL('../build/probes/runtime-probe.wasm', import.meta.url)));
let instance;
const {imports, inventory} = importsFor(module, () => instance);
instance = await WebAssembly.instantiate(module, imports);
instance.exports._initialize?.();
for (let i = 0; i < 20; i++) assert.equal(instance.exports.runtime_probe(), 0);
console.log(JSON.stringify({passed:true, allocationAndUnwindRuns:20, imports:inventory}));
