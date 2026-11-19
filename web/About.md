# DKM

A browser home for Donkey Kong Country, built on DKC1Recomp and its pinned snesrecomp core.

## Source repositories

- [Browser project: DKC1RecompWeb](https://github.com/pipebrain/DKC1RecompWeb) (private repository; GitHub access required)
- [Original project: DKC1Recomp](https://github.com/elliotttate/DKC1Recomp)
- [Original recompilation framework: snesrecomp](https://github.com/elliotttate/snesrecomp)

## Browser edition

This edition keeps the original game as its foundation and adds:

- Standalone WebAssembly with a handwritten JavaScript host.
- Direct WebGPU presentation, with the original game centered at 4:3.
- A single application menu, a compact layout, and system light/dark appearance.
- An editable keyboard profile selected by default, plus configurable controller profiles.
- Local cartridge-save persistence, save import/export, and same-ROM reloading.
- About and Help content loaded from editable Markdown files.

The browser host has no frontend framework or third-party JavaScript runtime dependency. Its graphics currently use the original 256 × 224 framebuffer with nearest scaling. Widescreen, enhanced graphics, rewind, save states, cheats, and NetPlay are not implemented in this edition.

## Credits and provenance

DKC1Recomp provides the native recompilation foundation. Its structure draws on DKC2Recomp and the Yoshifanatic1 Donkey Kong Country disassembly. This browser edition uses DKC1Recomp revision `3eb9a10c49cb210df2bd63addafe2a78cf9f4e22` and snesrecomp revision `de94587464524ebac8dcd62e14618bf0d3953644`.

- [DKC1Recomp README used for this edition](https://github.com/elliotttate/DKC1Recomp/blob/3eb9a10c49cb210df2bd63addafe2a78cf9f4e22/README.md)
- [DKC1Recomp license](https://github.com/elliotttate/DKC1Recomp/blob/3eb9a10c49cb210df2bd63addafe2a78cf9f4e22/LICENSE)
- [DKC1Recomp third-party notices](https://github.com/elliotttate/DKC1Recomp/blob/3eb9a10c49cb210df2bd63addafe2a78cf9f4e22/THIRD_PARTY_NOTICES.md)
- [snesrecomp license and attribution](https://github.com/elliotttate/snesrecomp/blob/de94587464524ebac8dcd62e14618bf0d3953644/THIRD_PARTY_ATTRIBUTION.md)

Donkey Kong Country and the Nintendo and Rare names and artwork belong to their respective owners. This is an independent fan project. Supply your own verified, headerless SNES USA v1.0 ROM; ROM files and game assets are not included or uploaded.

This page adapts the original project's description and credits, then documents the browser edition's changes. Features described in the original native releases are not automatically available here.
