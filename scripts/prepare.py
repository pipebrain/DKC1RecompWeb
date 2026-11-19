#!/usr/bin/env python3
"""Verify the private ROM and obtain/generate the pinned upstream C sources."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
LOCK = json.loads((ROOT / 'upstream.lock.json').read_text())
UPSTREAM = ROOT / '.local/upstream/DKC1Recomp'


def git(*args: str, cwd: Path = ROOT) -> str:
    return subprocess.check_output(['git', *args], cwd=cwd, text=True).strip()


def verify_rom(path: Path) -> dict:
    path = path.expanduser().resolve(strict=True)
    if path.stat().st_size != LOCK['rom']['size']:
        raise ValueError('Unsupported ROM size; expected a headerless 4,194,304-byte image.')
    with path.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    if digest != LOCK['rom']['sha256']:
        raise ValueError(f'Unsupported ROM SHA-256: {digest}')
    return {'path': str(path), 'size': path.stat().st_size, 'sha256': digest}


def verify_sources() -> None:
    for path, key in [(UPSTREAM, 'dkc1recomp'),
                      (UPSTREAM / 'snesrecomp', 'snesrecomp'),
                      (UPSTREAM / 'snesrecomp/lib/recomp-net', 'recomp_net')]:
        actual = git('rev-parse', 'HEAD', cwd=path)
        if actual != LOCK[key]['revision']:
            raise ValueError(f'{key} revision mismatch: {actual}')
        if git('status', '--porcelain', '--untracked-files=no', cwd=path):
            raise ValueError(f'{key} has tracked modifications; preserve them and resolve before building.')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rom', type=Path, required=True)
    parser.add_argument('--generate', action='store_true', help='Generate private C sources after verification.')
    parser.add_argument('--verify-only', action='store_true', help='Verify ROM only; do not fetch source.')
    args = parser.parse_args()
    if args.verify_only and args.generate:
        parser.error('--verify-only and --generate are mutually exclusive')
    rom = verify_rom(args.rom)
    if not args.verify_only:
        if not UPSTREAM.exists():
            UPSTREAM.parent.mkdir(parents=True, exist_ok=True)
            subprocess.run(['git', 'clone', '--no-checkout', LOCK['dkc1recomp']['url'], str(UPSTREAM)], check=True)
            subprocess.run(['git', '-C', str(UPSTREAM), 'checkout', '--detach', LOCK['dkc1recomp']['revision']], check=True)
        subprocess.run(['git', '-C', str(UPSTREAM), 'submodule', 'update', '--init', '--recursive'], check=True)
        verify_sources()
        if args.generate:
            logs = ROOT / 'build/logs'
            logs.mkdir(parents=True, exist_ok=True)
            with (logs / 'generation.log').open('w') as log:
                subprocess.run([sys.executable, str(UPSTREAM / 'scripts/generate_snesrecomp.py'),
                                '--rom', rom['path'], '--analysis-backend', 'python'],
                               cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, check=True)
            verify_sources()
    output = ROOT / 'build/preparation.json'
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({'rom': rom, 'source_lock': LOCK,
                                 'analysis_backend': 'python' if args.generate else None}, indent=2) + '\n')
    print(json.dumps({'rom_verified': True, 'sources_verified': not args.verify_only,
                      'generated': args.generate, 'report': str(output)}))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error)) from error
