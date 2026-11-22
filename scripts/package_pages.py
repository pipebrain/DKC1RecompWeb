#!/usr/bin/env python3
"""Prepare an allowlisted Pages artifact; never copy the whole web directory."""
from __future__ import annotations

import argparse
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import tempfile
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]
SCHEMA = 'dkc1recompweb.pages'
MANIFEST = 'pages-manifest.json'
WEB_FILES = (
    'index.html', 'style.css', 'main.js', 'graphics.js', 'storage.js',
    'controller-ui.js', 'ui-shell.js', 'keyboard-ui.js', 'content-pages.js',
    'start-shortcut.js', 'pause-presentation.js', 'gamepad-profiles.js',
    'keyboard-profiles.js', 'audio-worklet.js', 'worker.js', 'wasm-imports.js',
    'dk-coin.png', 'favicon.ico', 'favicon.png', 'About.md', 'Help.md',
)
PHASE2_FILES = ('settings.js', 'video-settings.js', 'video.wgsl', 'assist.js',
                'music-pack.js', 'msu-player.js', 'hd-pack.js', 'dkc-dixie.wasm')
NOTICE_FILES = (
    'LICENSE', 'THIRD_PARTY_NOTICES.md', 'licenses/README.md',
    'licenses/snesrecomp-LICENSE.txt', 'licenses/snesrecomp-THIRD_PARTY_ATTRIBUTION.md',
    'licenses/psxrecomp-color-lut-LICENSE-MIT.txt',
    'licenses/psxrecomp-color-lut-LICENSE-APACHE.txt',
    'licenses/psxrecomp-color-lut-LICENSE-POLYFORM-NONCOMMERCIAL.txt',
    'licenses/emscripten-LICENSE.txt', 'licenses/musl-COPYRIGHT.txt',
    'licenses/compiler-rt-LICENSE.txt',
)
BASELINE_FILES = frozenset((*WEB_FILES, *NOTICE_FILES, 'dkc.wasm', '.nojekyll'))
PACKAGE_FILES = BASELINE_FILES | frozenset(PHASE2_FILES)
PACKAGE_DIRS = frozenset(str(parent) for name in PACKAGE_FILES
                         for parent in PurePosixPath(name).parents if str(parent) != '.')
WASM_HEADER = b'\x00asm\x01\x00\x00\x00'
STATIC_IMPORT = re.compile(r'^\s*(?:import|export)\s+(?:[^;]*?\bfrom\s+)?[\'"]([^\'"]+)[\'"]', re.M)
MODULE_URL = re.compile(r'\bnew\s+URL\s*\(\s*([\'"`])(.*?)\1\s*,\s*import\.meta\.url', re.S)
DIRECT_LOAD = re.compile(r'(?:\bfetch|\bimport|\bnew\s+Worker|\.addModule)\s*\(\s*[\'"]([^\'"]+)[\'"]')
CSS_URL = re.compile(r'url\(\s*([\'"]?)(.*?)\1\s*\)', re.I)


class PackageError(ValueError):
    pass


def no_symlinks(path: Path) -> None:
    for item in (path, *path.parents):
        if item.is_symlink():
            raise PackageError(f'Symlink paths are not allowed: {item}')


def read_file(path: Path) -> bytes:
    no_symlinks(path)
    if not path.is_file():
        raise PackageError(f'Required file is missing: {path}')
    data = path.read_bytes()
    if not data:
        raise PackageError(f'Required file is empty: {path}')
    return data


def check_wasm(data: bytes, expected: str | None = None) -> str:
    if len(data) <= len(WASM_HEADER) or not data.startswith(WASM_HEADER):
        raise PackageError('Expected a nonempty WebAssembly version-1 module.')
    digest = hashlib.sha256(data).hexdigest()
    if expected is not None:
        if not re.fullmatch(r'[0-9a-fA-F]{64}', expected):
            raise PackageError('Expected Wasm SHA-256 must contain 64 hexadecimal characters.')
        if digest != expected.lower():
            raise PackageError('Wasm SHA-256 does not match the expected build.')
    return digest


def check_reference(value: str, source: str, resources, *, module: bool = False, data_url: bool = False) -> None:
    if not value or value.startswith('#'):
        return
    if value.startswith('data:') and data_url:
        return
    parsed = urlsplit(value)
    path = unquote(parsed.path)
    if parsed.scheme or parsed.netloc or path.startswith('/') or '\\' in path:
        raise PackageError(f'{source} uses a non-project-relative resource: {value}')
    if module and not path.startswith(('./', '../')):
        raise PackageError(f'{source} uses a bare module import: {value}')
    parts = list(PurePosixPath(source).parent.parts)
    for part in PurePosixPath(path).parts:
        if part == '..':
            if not parts:
                raise PackageError(f'{source} resource escapes the Pages project path: {value}')
            parts.pop()
        elif part != '.':
            parts.append(part)
    target = '/'.join(parts)
    if target not in resources:
        raise PackageError(f'{source} references a resource outside the artifact allowlist: {value}')


class HTMLResources(HTMLParser):
    def __init__(self, resources):
        super().__init__()
        self.resources = resources

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag == 'base':
            raise PackageError('A base element would change Pages project-relative URLs.')
        for key in ({'script': ('src',), 'link': ('href',), 'img': ('src',),
                     'source': ('src',), 'video': ('src', 'poster'), 'audio': ('src',),
                     'iframe': ('src',), 'image': ('href', 'xlink:href')}.get(tag, ())):
            if attributes.get(key):
                check_reference(attributes[key], 'index.html', self.resources)


def check_resources(files: dict[str, bytes]) -> None:
    HTMLResources(files).feed(files['index.html'].decode('utf-8'))
    for name in files:
        if name.endswith('.js'):
            source = files[name].decode('utf-8')
            for value in STATIC_IMPORT.findall(source):
                check_reference(value, name, files, module=True)
            for _, value in MODULE_URL.findall(source):
                if value == './${file}' and name == 'content-pages.js':
                    # This one bounded template selects the two bundled documents.
                    for document in ('About.md', 'Help.md'):
                        check_reference('./' + document, name, files)
                elif '${' in value:
                    raise PackageError(f'Unrecognized dynamic module resource in {name}: {value}')
                else:
                    check_reference(value, name, files)
            for value in DIRECT_LOAD.findall(source):
                check_reference(value, name, files)
        elif name.endswith('.css'):
            for _, value in CSS_URL.findall(files[name].decode('utf-8')):
                check_reference(value, name, files, data_url=True)


def verify_package(output: Path, expected_wasm_sha256: str | None = None) -> dict:
    no_symlinks(output)
    if not output.is_dir():
        raise PackageError(f'Pages output directory is missing: {output}')
    paths = list(output.rglob('*'))
    for path in paths:
        no_symlinks(path)
        if not path.is_file() and not path.is_dir():
            raise PackageError(f'Unsupported file type inside Pages artifact: {path.name}')
    directories = {path.relative_to(output).as_posix() for path in paths if path.is_dir()}
    if directories != PACKAGE_DIRS:
        raise PackageError('Pages artifact has missing or unexpected directories.')
    actual = {path.relative_to(output).as_posix() for path in paths if path.is_file()}
    allowed = actual - {MANIFEST}
    if MANIFEST not in actual or allowed not in (BASELINE_FILES, PACKAGE_FILES):
        raise PackageError('Pages artifact has missing or unexpected files; refusing to replace it.')
    try:
        manifest = json.loads((output / MANIFEST).read_text(encoding='utf-8'))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise PackageError('Pages artifact has no valid ownership manifest.') from error
    if not isinstance(manifest, dict) or set(manifest) != {'schema', 'version', 'wasm_sha256', 'files'}:
        raise PackageError('Pages artifact ownership manifest has unexpected fields.')
    if manifest['schema'] != SCHEMA or manifest['version'] != 1 or not isinstance(manifest['files'], dict):
        raise PackageError('Pages artifact ownership manifest is not supported.')
    if set(manifest['files']) != allowed:
        raise PackageError('Pages artifact manifest contains paths outside the allowlist.')
    files = {name: (output / name).read_bytes() for name in allowed}
    for name, data in files.items():
        expected = {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
        if manifest['files'][name] != expected:
            raise PackageError(f'Pages artifact hash mismatch: {name}')
    if files['.nojekyll']:
        raise PackageError('The Pages .nojekyll marker must be empty.')
    digest = check_wasm(files['dkc.wasm'], expected_wasm_sha256)
    if manifest['wasm_sha256'] != digest:
        raise PackageError('Pages artifact Wasm identity does not match its manifest.')
    if 'dkc-dixie.wasm' in files:
        check_wasm(files['dkc-dixie.wasm'])
    check_resources(files)
    return manifest


def package_pages(root: Path, output: Path, wasm: Path, expected_wasm_sha256: str | None = None) -> dict:
    root = root.resolve()
    output = output.absolute()
    no_symlinks(output)
    output = output.resolve()
    build = (root / 'build').resolve()
    if output == build or not output.is_relative_to(build):
        raise PackageError('Pages output must be a subdirectory of this project\'s ignored build/ directory.')
    if output.exists() and (not output.is_dir() or any(output.iterdir())):
        verify_package(output)  # Only replace an intact package owned by this tool.
    files = {name: read_file(root / 'web' / name) for name in (*WEB_FILES, *PHASE2_FILES)}
    files.update({name: read_file(root / name) for name in NOTICE_FILES})
    files['dkc.wasm'] = read_file(wasm)
    files['.nojekyll'] = b''
    digest = check_wasm(files['dkc.wasm'], expected_wasm_sha256)
    check_resources(files)
    manifest = {'schema': SCHEMA, 'version': 1, 'wasm_sha256': digest,
                'files': {name: {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
                          for name, data in sorted(files.items())}}
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=f'.{output.name}-', dir=output.parent) as directory:
        staging = Path(directory)
        for name, data in files.items():
            destination = staging / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
        (staging / MANIFEST).write_text(json.dumps(manifest, indent=2, sort_keys=True) + '\n', encoding='utf-8')
        verify_package(staging, expected_wasm_sha256)
        if output.exists():
            # Recheck after staging so edits made while building are preserved.
            if any(output.iterdir()):
                verify_package(output)
            backup = staging.with_name(staging.name + '-previous')
            output.rename(backup)
            try:
                staging.rename(output)
            except BaseException:
                backup.rename(output)
                raise
            shutil.rmtree(backup)
        else:
            staging.rename(output)
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--wasm', type=Path, default=Path('web/dkc.wasm'), help='Local compiled Wasm; relative paths use the project root.')
    parser.add_argument('--out', type=Path, default=Path('build/pages'), help='Artifact subdirectory under ignored build/.')
    parser.add_argument('--expected-wasm-sha256', help='Require this exact compiled Wasm SHA-256.')
    parser.add_argument('--verify', action='store_true', help='Verify an existing artifact without rebuilding it.')
    args = parser.parse_args()
    output = args.out if args.out.is_absolute() else ROOT / args.out
    wasm = args.wasm if args.wasm.is_absolute() else ROOT / args.wasm
    try:
        manifest = (verify_package(output, args.expected_wasm_sha256) if args.verify else
                    package_pages(ROOT, output, wasm, args.expected_wasm_sha256))
    except (PackageError, OSError, UnicodeError) as error:
        parser.exit(1, f'Pages packaging failed: {error}\n')
    print(json.dumps({'output': str(output), 'files': len(manifest['files']) + 1,
                      'bytes': sum(item['bytes'] for item in manifest['files'].values()) + (output / MANIFEST).stat().st_size,
                      'wasm_sha256': manifest['wasm_sha256']}, indent=2))


if __name__ == '__main__':
    main()
