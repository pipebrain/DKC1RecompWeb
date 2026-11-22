# Browser runtime notices

These files are copied unchanged from the pinned sources used by the browser
build. They accompany the compiled WebAssembly when a site artifact is made.
The root `LICENSE` and `THIRD_PARTY_NOTICES.md` are included separately.

| Files | Source revision and path |
| --- | --- |
| `snesrecomp-LICENSE.txt`, `snesrecomp-THIRD_PARTY_ATTRIBUTION.md` | snesrecomp `75223f35b16e4c904cea78453b9cd1fcefbcd7f2`, root license/attribution |
| `psxrecomp-color-lut-LICENSE-*.txt` | Same snesrecomp revision, `third_party/psxrecomp_color_lut/` |
| `emscripten-LICENSE.txt` | Emscripten `7a2d97d627ff4945eae28847ce0387ac52b92c09`, root `LICENSE` |
| `musl-COPYRIGHT.txt` | Same Emscripten revision, `system/lib/libc/musl/COPYRIGHT` |
| `compiler-rt-LICENSE.txt` | Same Emscripten revision, `system/lib/compiler-rt/LICENSE.TXT` |

See `upstream.lock.json`, `docs/THIRD_PARTY.md`, and
`docs/RUNTIME_DECISION.md` in the source repository for the build inventory.
The snesrecomp notice includes its PolyForm Noncommercial license; the browser
port does not replace third-party terms with the root MIT license.
