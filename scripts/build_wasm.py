#!/usr/bin/env python3
"""Build private standalone Wasm; no generated JavaScript loader is emitted."""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

from prepare import UPSTREAM, verify_sources

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--jobs', type=int, default=min(os.cpu_count() or 1, 6))
    args = parser.parse_args()
    if args.jobs < 1:
        parser.error('--jobs must be positive')
    verify_sources()
    subprocess.run([sys.executable, str(ROOT / 'scripts/setup_tools.py')], check=True)
    emscripten = ROOT / '.local/tools/emscripten'
    environment = dict(os.environ, EM_CONFIG=str(ROOT / '.local/tools/emscripten-config.py'))
    cmake = shutil.which('cmake')
    if not cmake or not shutil.which('ninja'):
        parser.error('CMake and Ninja must be on PATH.')
    build = ROOT / 'build/phase2-wasm'
    generated = UPSTREAM / 'generated/snesrecomp'
    logs = build / 'logs'
    logs.mkdir(parents=True, exist_ok=True)
    steps = [
        [cmake, '-S', str(ROOT / 'cmake/wasm'), '-B', str(build), '-G', 'Ninja',
         '-DCMAKE_BUILD_TYPE=Release',
         f'-DDKC1_UPSTREAM_DIR={UPSTREAM}',
         f'-DDKC1_GENERATED_DIR={generated}',
         f'-DCMAKE_TOOLCHAIN_FILE={emscripten / "cmake/Modules/Platform/Emscripten.cmake"}'],
        [cmake, '--build', str(build), '--target', 'dkc1_core', '--parallel', str(args.jobs)],
    ]
    for name, command in zip(['wasm-configure', 'wasm-build'], steps):
        print(f'{name}: {logs / (name + ".log")}', flush=True)
        with (logs / (name + '.log')).open('w') as log:
            result = subprocess.run(command, cwd=ROOT, env=environment,
                                    stdout=log, stderr=subprocess.STDOUT)
        if result.returncode:
            print('\n'.join((logs / (name + '.log')).read_text(errors='replace').splitlines()[-35:]))
            raise RuntimeError(f'{name} failed ({result.returncode}).')
    wasm = ROOT / 'web/dkc.wasm'
    # Install only the completed link output. A failed rebuild leaves the
    # previous module available to a browser served from this checkout.
    with tempfile.TemporaryDirectory(dir=wasm.parent, prefix='.wasm-') as staging:
        staged = Path(staging) / wasm.name
        shutil.copyfile(build / wasm.name, staged)
        staged.replace(wasm)
    print(f'Built {wasm} ({wasm.stat().st_size:,} bytes).')


if __name__ == '__main__':
    try:
        main()
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        sys.exit(str(error))
