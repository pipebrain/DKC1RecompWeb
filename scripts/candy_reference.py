#!/usr/bin/env python3
"""Generate a native Candy save and cold-restart oracle from the private 09% slot."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

from native_reference import fingerprints, run_logged
from prepare import ROOT

sys.path.insert(0, str(ROOT / "tools"))
from verify_ingame_saves import snapshot_sram


STARTER_SHA = "1e5bd0511a7dceb6e0ab6bc38a4618accdc381cc4312c9892d06ea59aaf2c497"
SAVED_SHA = "2d61079badca173c26d21e81b32ac72c5cb800bcd4c49985e67cda2de87d7a7b"
FILE_SELECT = [(0, 5400), (8, 6), (0, 120)]
LOAD_SLOT = [(8, 6), (0, 1800)]
# Stock joypad masks: Start=08, Up=10, Down=20, Left=40, Right=80, B=01.
# Visit Coral Capers and accumulate play time. Swimming out from the start
# and contacting an enemy returns the player to the world map.
SAVE_ROUTE = [
    ("file-select", FILE_SELECT),
    ("loaded-map", LOAD_SLOT),
    ("coral-capers", [(0x40, 35), (0, 120), (0x40, 45), (0, 140),
                      (0x20, 45), (0, 140), (8, 8), (0, 4800)]),
    ("before-barrel", [(0x80, 1200), (0, 150)] + [(0x81, 8), (0x80, 4)] * 40
                      + [(0, 300), (0x10, 35), (0, 150), (0x80, 35), (0, 150),
                         (0x80, 35), (0, 150)]),
    # Enter Candy's room and jump into the barrel. Neutral input suffices
    # for the game to write the slot and show its new time.
    ("candy-save", [(8, 8), (0, 240), (0x80, 20), (0x81, 30), (0, 180)]),
]
REOPEN_ROUTE = [("file-select", FILE_SELECT), ("candy-map", LOAD_SLOT)]


def native_checkpoint(exe, rom, battery, directory, inputs):
    """Start a fresh native process with only controller inputs and cartridge SRAM."""
    directory.mkdir(parents=True)
    script = directory / "inputs.txt"
    script.write_text("".join(f"{mask:x} * {count}\n" for mask, count in inputs))
    env = {k: v for k, v in os.environ.items()
           if not k.startswith(("SNESRECOMP_", "SNES_COSIM", "DKC1_"))}
    env.update(SNESRECOMP_INPUT_PLAY=str(script), DKC1_SRAM_INPUT=str(battery),
               DKC1_WIDESCREEN="0", DKC1_RENDER_WIDTH="256",
               DKC1_FRAME_PPM=str(directory / "frame.ppm"),
               DKC1_WRAM_OUTPUT=str(directory / "wram.bin"),
               DKC1_SAVESTATE_OUTPUT=str(directory / "final.state"))
    frames = sum(count for _, count in inputs)
    log = directory / "headless.log"
    run_logged([str(exe), str(rom), str(frames)], log, cwd=directory, env=env, timeout=180)
    text = log.read_text()
    if f"input_play: loaded {frames} frames from {script}" not in text:
        raise ValueError(f"Controller playback length mismatch at {directory}")
    hashes = fingerprints(text, frames)
    entrance = int.from_bytes((directory / "wram.bin").read_bytes()[0x3e:0x40], "little")
    return hashes, entrance, snapshot_sram(directory / "final.state")


def run_route(exe, rom, battery, directory, route, expected_sram):
    checkpoints = []
    inputs = []
    for name, segment in route:
        inputs.extend(segment)
        hashes, entrance, sram = native_checkpoint(exe, rom, battery, directory / name, inputs)
        digest = hashlib.sha256(sram).hexdigest()
        if digest != expected_sram(name):
            raise ValueError(f"Unexpected SRAM at {directory / name}: {digest}")
        checkpoints.append(dict(name=name, runs=[dict(buttons=b, count=n) for b, n in segment],
                                frame_sha256=hashes["frame_sha256"], entrance=entrance,
                                sram_sha256=digest))

    # Verify the entire leg including cumulative PCM in three independent processes.
    for index in (2, 3):
        repeat = native_checkpoint(exe, rom, battery, directory / f"repeat-{index}", inputs)
        if repeat != (hashes, entrance, sram):
            raise ValueError(f"Native replay {index} diverged in {directory}")
    return dict(checkpoints=checkpoints, fingerprints=hashes, entrance=entrance), sram


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rom", required=True, type=Path)
    parser.add_argument("--starter-sram", required=True, type=Path,
                        help="Read-only private slot 1 at Candy's Save Point, 00:12 / 09%%")
    parser.add_argument("--out", required=True, type=Path, help="New directory under build/")
    args = parser.parse_args()
    rom = args.rom.resolve(strict=True)
    starter = args.starter_sram.read_bytes()
    if hashlib.sha256(starter).hexdigest() != STARTER_SHA:
        parser.error(f"Fixed controller route requires the private 09% starter, SHA-256 {STARTER_SHA}")
    out = args.out.resolve()
    if out.exists() or (ROOT / "build").resolve() not in out.parents:
        parser.error("--out must be a new directory inside the ignored build/ folder")

    # Reuse the normal reference build, including its source and ROM identity checks.
    build = ROOT / "build/phase2-native"
    baseline = out / "baseline"
    subprocess.run([sys.executable, str(ROOT / "scripts/native_reference.py"), "--rom", str(rom),
                    "--build-dir", str(build), "--frames", "1", "--repeats", "1",
                    "--out", str(baseline)], check=True)
    reference = json.loads((baseline / "comparison.json").read_text())
    oracle = {key: reference[key] for key in ("rom_sha256", "upstream_revision", "engine_revision",
                                              "executable_sha256")}
    exe = build / "dkc1_native_reference"
    starter_file = out / "starter.srm"
    starter_file.write_bytes(starter)
    save, battery = run_route(exe, rom, starter_file, out / "save", SAVE_ROUTE,
                              lambda name: SAVED_SHA if name == "candy-save" else STARTER_SHA)
    saved_file = out / "saved.srm"
    saved_file.write_bytes(battery)
    reopen, _ = run_route(exe, rom, saved_file, out / "reopen", REOPEN_ROUTE,
                          lambda name: SAVED_SHA)
    if (reopen["entrance"] != 0xfa or
            save["checkpoints"][0]["frame_sha256"] == reopen["checkpoints"][0]["frame_sha256"]):
        raise ValueError("Cold restart must show the updated slot and return to Candy's Save Point")
    oracle.update(starter_sha256=STARTER_SHA, saved_sha256=SAVED_SHA, repeats=3,
                  save=save, reopen=reopen)
    (out / "oracle.json").write_text(json.dumps(oracle, indent=2) + "\n")
    print(f"Matched three native save and restart runs. Browser reference: {out / 'oracle.json'}")


if __name__ == "__main__":
    main()
