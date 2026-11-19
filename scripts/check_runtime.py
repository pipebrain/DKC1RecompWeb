#!/usr/bin/env python3
"""Compile and exercise the allowed C allocator and Wasm non-local unwind."""
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
subprocess.run([sys.executable, str(ROOT / 'scripts/setup_tools.py')], check=True)
environment = dict(os.environ, EM_CONFIG=str(ROOT / '.local/tools/emscripten-config.py'))
output = ROOT / 'build/probes/runtime-probe.wasm'
output.parent.mkdir(parents=True, exist_ok=True)
subprocess.run([sys.executable, str(ROOT / '.local/tools/emscripten/emcc.py'),
                str(ROOT / 'tests/wasm_runtime_probe.c'), '-O2', '--no-entry',
                '-sSTANDALONE_WASM=1', '-sSUPPORT_LONGJMP=wasm', '-fwasm-exceptions',
                '-sFILESYSTEM=0', '-o', str(output)], env=environment, check=True)
subprocess.run([str(ROOT / '.local/tools/node-v22.16.0-darwin-arm64/bin/node'),
                str(ROOT / 'scripts/check_runtime.mjs')], cwd=ROOT, check=True)
