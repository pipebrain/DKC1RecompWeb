# DKC1R Web

Version 1.1.2

A browser home for Donkey Kong Country, built on DKC1Recomp and its pinned snesrecomp core.

## Source repositories

- [Browser project: DKC1RecompWeb](https://github.com/pipebrain/DKC1RecompWeb)
- [Play DKC1R Web](https://pipebrain.github.io/DKC1RecompWeb/)
- [Original project: DKC1Recomp](https://github.com/elliotttate/DKC1Recomp)
- [Original recompilation framework: snesrecomp](https://github.com/elliotttate/snesrecomp)

## Browser edition

This edition keeps the original game as its foundation and adds:

- Standalone WebAssembly with a handwritten JavaScript host.
- Direct WebGPU presentation of the complete 256 × 224 game frame, centered at 4:3 with nearest-neighbor scaling.
- A navigation rail for portrait and landscape, with Black, Light, Dark, and System appearance options.
- Two assignable input profiles with keyboard, mouse, and gamepad bindings and per-profile stomp rumble.
- Remembered ROMs, local cartridge saves, save import/export, and same-ROM reloading.
- Save-state cards with screenshots, Quick Save to an empty slot, and Quick Load for the latest state.
- Local settings and configuration files for transferring both players’ bindings and preferences.

The handwritten browser host uses WebAssembly, WebGPU and standard browser APIs. Open Settings to adjust settings or transfer them to another browser.

## Credits and provenance

DKC1Recomp provides the native recompilation foundation. Its structure draws on DKC2Recomp and the Yoshifanatic1 Donkey Kong Country disassembly. This browser edition uses stock DKC1Recomp v0.0.17 at revision `559bab62596a97e91f389b39cdeb6cda981ab7c9` and snesrecomp revision `75223f35b16e4c904cea78453b9cd1fcefbcd7f2`.

- [DKC1Recomp README used for this edition](https://github.com/elliotttate/DKC1Recomp/blob/559bab62596a97e91f389b39cdeb6cda981ab7c9/README.md)
- [DKC1Recomp license](https://github.com/elliotttate/DKC1Recomp/blob/559bab62596a97e91f389b39cdeb6cda981ab7c9/LICENSE)
- [DKC1Recomp third-party notices](https://github.com/elliotttate/DKC1Recomp/blob/559bab62596a97e91f389b39cdeb6cda981ab7c9/THIRD_PARTY_NOTICES.md)
- [snesrecomp license and attribution](https://github.com/elliotttate/snesrecomp/blob/75223f35b16e4c904cea78453b9cd1fcefbcd7f2/THIRD_PARTY_ATTRIBUTION.md)

Donkey Kong Country and the Nintendo and Rare names and artwork belong to their respective owners. This is an independent fan project. Supply your own verified, headerless SNES USA v1.0 ROM; ROM files and game assets are not included or uploaded.

This page adapts the original project's description and credits, then documents the browser edition's changes. Features described in the original native releases are not automatically available here.
