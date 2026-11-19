#!/usr/bin/env python3
"""Build and replay the unchanged upstream headless host as a native oracle.

This uses only Python's standard library. Evidence remains under ignored build/.
Frame, memory, and audio fingerprints come from upstream headless_main.c.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
UPSTREAM_REVISION = "3eb9a10c49cb210df2bd63addafe2a78cf9f4e22"
ENGINE_REVISION = "de94587464524ebac8dcd62e14618bf0d3953644"
ROM_SHA256 = "fa8cacf5bbfc39ee6bbaa557adf89133d60d42f6cf9e1db30d5a36a469f74d15"
FINGERPRINTS = (
    "frame_sha256", "wram_sha256", "vram_sha256", "cgram_sha256",
    "oam_sha256", "oam_source_sha256", "audio_fnv1a",
)


def run_logged(command: list[str], log: Path, **kwargs) -> None:
    print("Running:", " ".join(repr(str(part)) for part in command), flush=True)
    with log.open("w", encoding="utf-8") as stream:
        result = subprocess.run(command, stdout=stream, stderr=subprocess.STDOUT,
                                text=True, **kwargs)
    if result.returncode:
        tail = "\n".join(log.read_text(errors="replace").splitlines()[-35:])
        raise RuntimeError(f"Command failed ({result.returncode}); see {log}\n{tail}")


def revision(directory: Path) -> str:
    value = subprocess.check_output(
        ["git", "-C", str(directory), "rev-parse", "HEAD"], text=True
    ).strip()
    dirty = subprocess.check_output(
        ["git", "-C", str(directory), "status", "--porcelain", "--untracked-files=no"], text=True
    ).strip()
    if dirty:
        raise RuntimeError(f"Native reference requires clean tracked upstream sources: {directory}\n{dirty}")
    return value


def fingerprints(text: str, frames: int) -> dict[str, str]:
    found = dict(re.findall(r"\b(\w+_sha256|audio_fnv1a)=([0-9a-f]+)\b", text))
    if set(found) != set(FINGERPRINTS):
        raise RuntimeError(f"Incomplete or unexpected headless fingerprints: {sorted(found)}")
    for key, value in found.items():
        if len(value) != (16 if key == "audio_fnv1a" else 64):
            raise RuntimeError(f"Invalid {key} fingerprint length")
    if not re.search(rf"\bresult=completed frames={frames}\b", text):
        raise RuntimeError("Headless runner did not report the requested completed frame count")
    return found


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rom", type=Path, required=True)
    parser.add_argument("--upstream", type=Path, default=ROOT / ".local/upstream/DKC1Recomp")
    parser.add_argument("--generated", type=Path,
                        help="Defaults to generated/snesrecomp within the pinned upstream checkout")
    parser.add_argument("--build-dir", type=Path, default=ROOT / "build/native-reference")
    parser.add_argument("--out", type=Path, required=True,
                        help="New evidence directory beneath this project's build/")
    parser.add_argument("--frames", type=int, default=600)
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--jobs", type=int, default=min(os.cpu_count() or 1, 8))
    parser.add_argument("--timeout", type=int, default=180,
                        help="Maximum seconds per headless run")
    parser.add_argument("--skip-build", action="store_true")
    args = parser.parse_args()
    if not 1 <= args.frames <= 1_000_000 or args.repeats < 1 or args.jobs < 1 or args.timeout < 1:
        parser.error("frames must be 1..1000000; repeats, jobs, and timeout must be positive")

    rom = args.rom.resolve(strict=True)
    upstream = args.upstream.resolve(strict=True)
    generated = (args.generated or upstream / "generated/snesrecomp").resolve(strict=True)
    build_dir = args.build_dir.resolve()
    output = args.out.resolve()
    private_root = (ROOT / "build").resolve()
    if not output.is_relative_to(private_root) or output == private_root:
        parser.error("--out must be a new directory beneath this project's ignored build/")
    if not build_dir.is_relative_to(private_root) or build_dir == private_root:
        parser.error("--build-dir must be beneath this project's ignored build/")
    if output.exists():
        parser.error(f"Refusing to overwrite existing evidence: {output}")
    with rom.open("rb") as stream:
        rom_hash = hashlib.file_digest(stream, "sha256").hexdigest()
    if rom.stat().st_size != 4_194_304 or rom_hash != ROM_SHA256:
        parser.error("ROM does not match headerless Donkey Kong Country USA v1.0")
    if revision(upstream) != UPSTREAM_REVISION or revision(upstream / "snesrecomp") != ENGINE_REVISION:
        parser.error("Upstream checkout or snesrecomp revision differs from the pinned reference")
    if not any(generated.glob("*.c")):
        parser.error("Private generated game sources are missing")

    cmake = shutil.which("cmake")
    if not args.skip_build and (not cmake or not shutil.which("ninja")):
        parser.error("CMake and Ninja build tools must be available on PATH")
    output.mkdir(parents=True)
    commands: list[list[str]] = []
    if not args.skip_build:
        configure = [str(cmake), "-S", str(ROOT / "cmake/native"), "-B", str(build_dir),
                     "-G", "Ninja", "-DCMAKE_BUILD_TYPE=Release",
                     f"-DDKC1_UPSTREAM_DIR={upstream}", f"-DDKC1_GENERATED_DIR={generated}"]
        commands.append(configure)
        run_logged(configure, output / "configure.log", cwd=ROOT)
        build = [str(cmake), "--build", str(build_dir), "--target", "dkc1_native_reference",
                 "--parallel", str(args.jobs)]
        commands.append(build)
        run_logged(build, output / "build.log", cwd=ROOT)

    executable = build_dir / "dkc1_native_reference"
    if not executable.is_file():
        raise RuntimeError(f"Native reference executable is missing: {executable}")
    tool_versions = {}
    for name in ("cmake", "ninja"):
        tool = shutil.which(name)
        if tool:
            tool_versions[name] = subprocess.check_output([tool, "--version"], text=True).strip()
    cache = (build_dir / "CMakeCache.txt").read_text()
    compiler = re.search(r"^CMAKE_C_COMPILER:(?:FILEPATH|STRING)=(.+)$", cache, re.MULTILINE)
    if compiler:
        tool_versions["c_compiler"] = subprocess.check_output(
            [compiler[1], "--version"], text=True
        ).strip()
    with executable.open("rb") as stream:
        executable_hash = hashlib.file_digest(stream, "sha256").hexdigest()
    reports = []
    for repeat in range(1, args.repeats + 1):
        run_dir = output / f"run-{repeat}"
        run_dir.mkdir()
        # Prevent inherited diagnostic/mod/save/input settings from changing
        # the clean-boot oracle, and isolate upstream's default output paths.
        environment = {key: value for key, value in os.environ.items()
                       if not key.startswith(("DKC1_", "SNESRECOMP_", "SNES_COSIM"))}
        environment.update({
            "DKC1_WIDESCREEN": "0",
            "DKC1_RENDER_WIDTH": "256",
            "DKC1_FRAME_PPM": str(run_dir / "final.ppm"),
            "DKC1_WRAM_OUTPUT": str(run_dir / "final.wram.bin"),
            "DKC1_VRAM_OUTPUT": str(run_dir / "final.vram.bin"),
            "SNESRECOMP_TIER2_DIR": str(run_dir / "tier2"),
        })
        (run_dir / "tier2").mkdir()
        command = [str(executable), str(rom), str(args.frames)]
        commands.append(command)
        run_logged(command, run_dir / "headless.log", cwd=run_dir,
                   env=environment, timeout=args.timeout)
        report = fingerprints((run_dir / "headless.log").read_text(errors="replace"), args.frames)
        report["repeat"] = repeat
        reports.append(report)
        print(f"Run {repeat}: frame_sha256={report['frame_sha256']}", flush=True)

    expected = {key: reports[0][key] for key in FINGERPRINTS}
    passed = all({key: report[key] for key in FINGERPRINTS} == expected for report in reports)
    result = {
        "schema_version": 1,
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "passed": passed,
        "scope": "native headless clean boot; no input; 256x224; not browser execution",
        "upstream_revision": UPSTREAM_REVISION,
        "engine_revision": ENGINE_REVISION,
        "rom_sha256": rom_hash,
        "executable_sha256": executable_hash,
        "tool_versions": tool_versions,
        "frames": args.frames,
        "repeats": args.repeats,
        "commands": commands,
        "runs": reports,
    }
    (output / "comparison.json").write_text(json.dumps(result, indent=2) + "\n")
    if not passed:
        raise RuntimeError(f"Native replay fingerprints differ; inspect {output / 'comparison.json'}")
    print(f"PASS: {args.repeats} native replays match all seven fingerprints; evidence: {output}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        print(f"native reference: {error}", file=sys.stderr)
        raise SystemExit(1)
