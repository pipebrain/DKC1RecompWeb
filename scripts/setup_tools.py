#!/usr/bin/env python3
"""Prepare pinned local build tools for the current Apple Silicon milestone."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import tarfile
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / '.local/tools'
LOCK = json.loads((ROOT / 'upstream.lock.json').read_text())


def command(*args: str) -> str:
    return subprocess.check_output(args, text=True).strip()


def download(key: str, directory: str) -> Path:
    spec = LOCK[key]
    archive = TOOLS / spec['archive']
    if not archive.exists():
        temporary = archive.with_suffix('.download')
        with urlopen(spec['url'], timeout=120) as response, temporary.open('wb') as stream:
            while block := response.read(1024 * 1024):
                stream.write(block)
        temporary.replace(archive)
    with archive.open('rb') as stream:
        actual = hashlib.file_digest(stream, 'sha256').hexdigest()
    if actual != spec['sha256']:
        raise ValueError(f'Build-tool archive checksum mismatch: {archive}')
    destination = TOOLS / directory
    if not destination.is_dir():
        with tarfile.open(archive) as stream:
            stream.extractall(TOOLS, filter='data')
    return destination


def main() -> None:
    if platform.system() != 'Darwin' or platform.machine() != 'arm64':
        raise ValueError('This pinned bootstrap currently targets macOS arm64.')
    TOOLS.mkdir(parents=True, exist_ok=True)
    llvm = Path(command('brew', '--prefix', 'llvm')) / 'bin'
    lld = Path(command('brew', '--prefix', 'lld')) / 'bin/wasm-ld'
    if not (llvm / 'clang').is_file() or not lld.is_file():
        raise ValueError('LLVM/lld are missing. Install allowed build tools with: brew install lld cmake ninja')
    expected = LOCK['build_tools']['llvm']
    if f'clang version {expected}' not in command(str(llvm / 'clang'), '--version'):
        raise ValueError(f'This milestone pins LLVM {expected}; update and validate the lock explicitly for other versions.')
    if expected not in command(str(lld), '--version'):
        raise ValueError(f'This milestone pins lld {expected}.')
    combined = TOOLS / 'llvm/bin'
    combined.mkdir(parents=True, exist_ok=True)
    for source in [*llvm.iterdir(), lld]:
        destination = combined / source.name
        if destination.is_symlink():
            if destination.resolve() == source.resolve():
                continue
            destination.unlink()
        elif destination.exists():
            raise ValueError(f'Refusing to replace local tool: {destination}')
        destination.symlink_to(source)
    for name in ['lib', 'include']:
        destination = combined.parent / name
        if not destination.exists():
            destination.symlink_to(llvm.parent / name, target_is_directory=True)

    emscripten = TOOLS / 'emscripten'
    if not emscripten.exists():
        subprocess.run(['git', 'clone', '--depth', '1', '--branch', LOCK['emscripten']['tag'],
                        LOCK['emscripten']['url'], str(emscripten)], check=True)
    if command('git', '-C', str(emscripten), 'rev-parse', 'HEAD') != LOCK['emscripten']['revision']:
        raise ValueError('Emscripten checkout differs from the locked revision.')
    if command('git', '-C', str(emscripten), 'status', '--porcelain', '--untracked-files=no'):
        raise ValueError('Emscripten has tracked modifications; preserve and resolve them first.')
    node = download('node_build_tool', 'node-v22.16.0-darwin-arm64') / 'bin/node'
    binaryen = download('binaryen', 'binaryen-version_129')
    if command(str(node), '--version') != 'v' + LOCK['node_build_tool']['version']:
        raise ValueError('Unexpected Node build-tool version.')
    if command(str(binaryen / 'bin/wasm-opt'), '--version').split()[2] != LOCK['binaryen']['version']:
        raise ValueError('Unexpected Binaryen build-tool version.')
    cache = ROOT / '.local/cache/emscripten-6.0.2'
    cache.mkdir(parents=True, exist_ok=True)
    config = TOOLS / 'emscripten-config.py'
    config.write_text('\n'.join([
        f'LLVM_ROOT = {str(combined)!r}', f'BINARYEN_ROOT = {str(binaryen)!r}',
        f'NODE_JS = [{str(node)!r}]', f'CACHE = {str(cache)!r}', 'FROZEN_CACHE = False', '',
    ]))
    environment = dict(os.environ, EM_CONFIG=str(config),
                       PATH=str(node.parent) + os.pathsep + os.environ.get('PATH', ''))
    subprocess.run([sys.executable, str(emscripten / 'bootstrap.py')],
                   cwd=emscripten, env=environment, check=True)
    subprocess.run([sys.executable, str(emscripten / 'emcc.py'), '--version'], env=environment, check=True)
    print(f'Build configuration: {config}')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        sys.exit(str(error))
