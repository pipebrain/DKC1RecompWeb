# DKM

A browser home for Donkey Kong Country, built on DKC1Recomp and its pinned snesrecomp core.

## Source repositories

- [Browser project: DKC1RecompWeb](https://github.com/pipebrain/DKC1RecompWeb) (private repository; GitHub access required)
- [Public test deployment: DKC1RecompWeb-Pages](https://github.com/pipebrain/DKC1RecompWeb-Pages)
- [Original project: DKC1Recomp](https://github.com/elliotttate/DKC1Recomp)
- [Original recompilation framework: snesrecomp](https://github.com/elliotttate/snesrecomp)

## Browser edition

This edition keeps the original game as its foundation and adds:

- Standalone WebAssembly with a handwritten JavaScript host.
- Direct WebGPU presentation with stock 4:3 and optional widescreen, CRT filters, and frame smoothing.
- A single application menu, a compact layout, and system light/dark appearance.
- Two configurable input ports, editable keyboard and controller profiles, and portable player settings.
- Remembered ROMs, local cartridge saves, save import/export, and same-ROM reloading.
- Five save-state slots per variant, rewind, and frame advance.
- Optional Dixie gameplay, user-supplied MSU-1 music, and materials for the macOS HD preview.

The handwritten browser host uses WebAssembly, WebGPU and standard browser APIs. Open Config to adjust settings or transfer them to another browser.

## Credits and provenance

DKC1Recomp provides the native recompilation foundation. Its structure draws on DKC2Recomp and the Yoshifanatic1 Donkey Kong Country disassembly. This browser edition uses stock DKC1Recomp v0.0.17 at revision `559bab62596a97e91f389b39cdeb6cda981ab7c9` and snesrecomp revision `75223f35b16e4c904cea78453b9cd1fcefbcd7f2`.

- [DKC1Recomp README used for this edition](https://github.com/elliotttate/DKC1Recomp/blob/559bab62596a97e91f389b39cdeb6cda981ab7c9/README.md)
- [DKC1Recomp license](https://github.com/elliotttate/DKC1Recomp/blob/559bab62596a97e91f389b39cdeb6cda981ab7c9/LICENSE)
- [DKC1Recomp third-party notices](https://github.com/elliotttate/DKC1Recomp/blob/559bab62596a97e91f389b39cdeb6cda981ab7c9/THIRD_PARTY_NOTICES.md)
- [snesrecomp license and attribution](https://github.com/elliotttate/snesrecomp/blob/75223f35b16e4c904cea78453b9cd1fcefbcd7f2/THIRD_PARTY_ATTRIBUTION.md)

Donkey Kong Country and the Nintendo and Rare names and artwork belong to their respective owners. This is an independent fan project. Supply your own verified, headerless SNES USA v1.0 ROM; ROM files and game assets are not included or uploaded.

This page adapts the original project's description and credits, then documents the browser edition's changes. Features described in the original native releases are not automatically available here.
