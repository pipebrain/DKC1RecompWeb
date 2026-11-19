# Source and notice inventory

Pinned upstream sources and build tools are retained locally under ignored
`.local/`. Their original license/provenance files remain intact; no upstream
source was edited. Exact revisions are in `upstream.lock.json`.

- [DKC1Recomp license](https://github.com/elliotttate/DKC1Recomp/blob/3eb9a10c49cb210df2bd63addafe2a78cf9f4e22/LICENSE)
  and [third-party notices](https://github.com/elliotttate/DKC1Recomp/blob/3eb9a10c49cb210df2bd63addafe2a78cf9f4e22/THIRD_PARTY_NOTICES.md).
- [snesrecomp license](https://github.com/elliotttate/snesrecomp/blob/de94587464524ebac8dcd62e14618bf0d3953644/LICENSE)
  and [third-party attribution](https://github.com/elliotttate/snesrecomp/blob/de94587464524ebac8dcd62e14618bf0d3953644/THIRD_PARTY_ATTRIBUTION.md).
- [Emscripten license](https://github.com/emscripten-core/emscripten/blob/7a2d97d627ff4945eae28847ce0387ac52b92c09/LICENSE),
  [musl C-library notices](https://github.com/emscripten-core/emscripten/blob/7a2d97d627ff4945eae28847ce0387ac52b92c09/system/lib/libc/musl/COPYRIGHT),
  and [compiler-rt license](https://github.com/emscripten-core/emscripten/blob/7a2d97d627ff4945eae28847ce0387ac52b92c09/system/lib/compiler-rt/LICENSE.TXT).

The browser host adds no third-party JavaScript package. The statically linked
C support archives are enumerated in [RUNTIME_DECISION.md](RUNTIME_DECISION.md).
Exact pinned snesrecomp, color-LUT, Emscripten, musl, and compiler-rt license
texts are preserved in [licenses/](../licenses/README.md) for inclusion with
the compiled Wasm in a Pages artifact. The root MIT license does not replace
those third-party notices.
ROMs, extracted assets, generated game C, saves, and evidence remain local and
excluded from Git. The compiled Wasm is excluded from Git but is included in
the approved public Pages deployment/archive with these notices.
