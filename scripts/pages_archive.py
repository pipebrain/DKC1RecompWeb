#!/usr/bin/env python3
"""Create or extract a verified Pages transport without putting binaries in Git.

Create:  python3 scripts/pages_archive.py create --package build/pages \
           --out build/pages-transfer/pages-site.tar.gz
Extract: python3 scripts/pages_archive.py extract --archive build/pages-site.tar.gz \
           --expected-sha256 FULL_SHA256 --out build/pages

Archive and extraction outputs must be under this project's ignored build/.
Existing nonempty outputs are reused only when their contents match exactly.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import tarfile
import tempfile

from package_pages import BASELINE_FILES, MANIFEST, PACKAGE_FILES, PackageError, ROOT, no_symlinks, verify_package


ARCHIVE_FILES = PACKAGE_FILES | {MANIFEST}
MAX_TOTAL_BYTES = 128 * 1024 * 1024
MAX_TAR_BYTES = MAX_TOTAL_BYTES + len(ARCHIVE_FILES) * 1024 + tarfile.RECORDSIZE


def output_path(root: Path, path: Path) -> Path:
    """Require a real, non-symlink output below build/, never the build root."""
    root = root.resolve()
    path = path if path.is_absolute() else root / path
    no_symlinks(path)
    path = path.resolve()
    build = root / 'build'
    if path == build or not path.is_relative_to(build):
        raise PackageError('Pages archive outputs must be below the ignored build/ directory.')
    return path


def limited_file(path: Path, limit: int) -> bytes:
    no_symlinks(path)
    if not path.is_file() or path.stat().st_size > limit:
        raise PackageError(f'Archive file is missing or exceeds the size limit: {path}')
    with path.open('rb') as stream:
        data = stream.read(limit + 1)
    if not data or len(data) > limit:
        raise PackageError('Archive file is empty or exceeds the size limit.')
    return data


def same_package(left: Path, right: Path) -> bool:
    left_manifest = verify_package(left)
    return (left_manifest == verify_package(right) and
            (left / MANIFEST).read_bytes() == (right / MANIFEST).read_bytes())


def create_archive(package: Path, archive: Path, *, root: Path = ROOT) -> dict:
    package = package if package.is_absolute() else root / package
    no_symlinks(package)
    names = {path.relative_to(package).as_posix() for path in package.rglob('*') if path.is_file()}
    if names not in (BASELINE_FILES | {MANIFEST}, ARCHIVE_FILES):
        raise PackageError('Pages package has missing or unexpected files.')
    sizes = 0
    for name in names:
        source = package / name
        no_symlinks(source)
        if not source.is_file():
            raise PackageError(f'Required package file is missing: {name}')
        sizes += source.stat().st_size
        if sizes > MAX_TOTAL_BYTES:
            raise PackageError('Pages package exceeds the 128 MiB transport limit.')
    manifest = verify_package(package)
    destination = output_path(root, archive)
    if destination.is_relative_to(package.resolve()):
        raise PackageError('The transport archive cannot be created inside its package.')
    contents = {}
    total = 0
    for name in sorted(names):
        source = package / name
        no_symlinks(source)
        data = source.read_bytes()
        total += len(data)
        if total > MAX_TOTAL_BYTES:
            raise PackageError('Pages package exceeds the 128 MiB transport limit.')
        if name == MANIFEST:
            if json.loads(data) != manifest:
                raise PackageError('Pages manifest changed while reading the package.')
        elif manifest['files'][name] != {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}:
            raise PackageError(f'Pages package changed while reading: {name}')
        contents[name] = data
    tar_buffer = io.BytesIO()
    with tarfile.open(fileobj=tar_buffer, mode='w', format=tarfile.USTAR_FORMAT) as output:
        for name, data in contents.items():
            member = tarfile.TarInfo(name)
            member.size = len(data)
            member.mode = 0o644
            member.mtime = member.uid = member.gid = 0
            member.uname = member.gname = ''
            output.addfile(member, io.BytesIO(data))
    compressed = io.BytesIO()
    with gzip.GzipFile(fileobj=compressed, mode='wb', filename='', mtime=0, compresslevel=9) as output:
        output.write(tar_buffer.getvalue())
    payload = compressed.getvalue()
    if len(payload) > MAX_TOTAL_BYTES:
        raise PackageError('Compressed transport exceeds the 128 MiB limit.')
    if verify_package(package) != manifest:
        raise PackageError('Pages package changed while archiving it.')
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        if limited_file(destination, MAX_TOTAL_BYTES) != payload:
            raise PackageError('Refusing to replace a different existing archive; choose a new output path.')
    else:
        with destination.open('xb') as output:
            output.write(payload)
    return {'archive': str(destination), 'archive_sha256': hashlib.sha256(payload).hexdigest(),
            'archive_bytes': len(payload), 'files': len(contents), 'wasm_sha256': manifest['wasm_sha256']}


def archive_contents(payload: bytes) -> dict[str, bytes]:
    """Read only exact regular-file members; never use tarfile.extract()."""
    with gzip.GzipFile(fileobj=io.BytesIO(payload), mode='rb') as compressed:
        data = compressed.read(MAX_TAR_BYTES + 1)
    if len(data) > MAX_TAR_BYTES:
        raise PackageError('Decompressed transport exceeds its size limit.')
    contents = {}
    total = offset = 0
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:') as source:
        for member in source:
            if member.name not in ARCHIVE_FILES:
                raise PackageError(f'Archive member is outside the Pages allowlist: {member.name}')
            if member.name in contents:
                raise PackageError(f'Duplicate archive member: {member.name}')
            if member.type != tarfile.REGTYPE or member.pax_headers or member.sparse:
                raise PackageError('Only plain regular files are allowed in a Pages transport.')
            if member.offset != offset or member.offset_data != member.offset + tarfile.BLOCKSIZE:
                raise PackageError('Unexpected metadata or gaps in the Pages transport.')
            if member.size < 0 or member.size > MAX_TOTAL_BYTES or total + member.size > MAX_TOTAL_BYTES:
                raise PackageError('Archive members exceed the 128 MiB transport limit.')
            stream = source.extractfile(member)
            if stream is None:
                raise PackageError(f'Cannot read archive member: {member.name}')
            with stream:
                content = stream.read(member.size + 1)
            if len(content) != member.size:
                raise PackageError(f'Incomplete archive member: {member.name}')
            contents[member.name] = content
            total += member.size
            offset = member.offset_data + ((member.size + 511) // 512) * 512
            if any(data[member.offset_data + member.size:offset]):
                raise PackageError('Unexpected nonzero padding inside the Pages transport.')
    if set(contents) not in (BASELINE_FILES | {MANIFEST}, ARCHIVE_FILES):
        raise PackageError('Pages transport has missing files.')
    # Reject hidden second tar archives or payloads after the end marker.
    if len(data) - offset < 1024 or any(data[offset:]):
        raise PackageError('Unexpected content after the Pages transport end marker.')
    return contents


def extract_archive(archive: Path, output: Path, expected_sha256: str, *, root: Path = ROOT) -> dict:
    if not re.fullmatch(r'[0-9a-fA-F]{64}', expected_sha256):
        raise PackageError('Expected archive SHA-256 must contain 64 hexadecimal characters.')
    archive = archive if archive.is_absolute() else root / archive
    payload = limited_file(archive, MAX_TOTAL_BYTES)
    digest = hashlib.sha256(payload).hexdigest()
    if digest != expected_sha256.lower():
        raise PackageError('Pages archive SHA-256 does not match the approved transport.')
    destination = output_path(root, output)
    contents = archive_contents(payload)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=f'.{destination.name}-', dir=destination.parent) as directory:
        staging = Path(directory)
        for name, content in contents.items():
            path = staging / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
            path.chmod(0o644)
        manifest = verify_package(staging)
        if destination.exists():
            no_symlinks(destination)
            if not destination.is_dir():
                raise PackageError('Extraction output is not a directory.')
            if any(destination.iterdir()):
                verify_package(destination)
                if not same_package(staging, destination):
                    raise PackageError('Refusing to replace a different existing Pages package.')
                return {'output': str(destination), 'archive_sha256': digest, 'reused': True,
                        'files': len(contents), 'wasm_sha256': manifest['wasm_sha256']}
            destination.rmdir()  # Fails safely if a concurrent edit made it nonempty.
        staging.rename(destination)
    return {'output': str(destination), 'archive_sha256': digest, 'reused': False,
            'files': len(contents), 'wasm_sha256': manifest['wasm_sha256']}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest='command', required=True)
    create = commands.add_parser('create', help='Create a deterministic transport from an already verified package.')
    create.add_argument('--package', type=Path, default=Path('build/pages'))
    create.add_argument('--out', type=Path, default=Path('build/pages-transfer/pages-site.tar.gz'))
    extract = commands.add_parser('extract', help='Verify the approved digest and extract only the exact package allowlist.')
    extract.add_argument('--archive', type=Path, required=True)
    extract.add_argument('--expected-sha256', required=True)
    extract.add_argument('--out', type=Path, default=Path('build/pages'))
    args = parser.parse_args()
    try:
        result = (create_archive(args.package, args.out) if args.command == 'create' else
                  extract_archive(args.archive, args.out, args.expected_sha256))
    except (PackageError, OSError, UnicodeError, json.JSONDecodeError, tarfile.TarError, EOFError) as error:
        parser.exit(1, f'Pages archive failed: {error}\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
