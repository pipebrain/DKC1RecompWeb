# DKC1RecompWeb

Phase 1 ports the pinned DKC1Recomp C core to standalone WebAssembly, presented
by a handwritten JavaScript host using WebGPU. Donkey Kong Land integration is
a later phase. Read [the project brief](docs/PROJECT.md) for decisions and
verified status.

Repository: [pipebrain/DKC1RecompWeb](https://github.com/pipebrain/DKC1RecompWeb)
(private). This standalone repository preserves the original
[DKC1Recomp](https://github.com/elliotttate/DKC1Recomp) Git history and adds the
browser port on top of the pinned revision. `origin` points here and `upstream`
points to the original project. [README.upstream.md](README.upstream.md) retains
the native project's original README; its license and third-party notices are
preserved at the repository root.

The upstream native tree remains available. Browser sources live in `web/`,
`runtime/`, and `cmake/native/` / `cmake/wasm/`; the tested browser build still
uses its separate pinned source checkout under ignored `.local/upstream/`.

## Local build

The current bootstrap targets Apple Silicon macOS. Build tools are allowed;
the browser application has no package-manager, framework, graphics-wrapper,
or generated JavaScript runtime dependency. The user approved statically
linked compiler-provided C support and small handwritten host imports.

```sh
brew install lld cmake ninja
python3 scripts/prepare.py --rom '/absolute/path/to/your/dkc1.smc' --generate
python3 scripts/build_wasm.py
python3 scripts/serve.py
```

Open [the local player](http://127.0.0.1:8000/) in Chrome. Choose **DKM → Load ROM**
(or **Menu → Load ROM**), select the same ROM, then use **DKM → Start Game**
or press **Space** with the game focused. Use **Config → Sound** to enable audio.
The ROM is read locally
and is not uploaded or embedded in the page.

The required ROM is headerless SNES Donkey Kong Country USA v1.0, 4,194,304
bytes, SHA-256
`fa8cacf5bbfc39ee6bbaa557adf89133d60d42f6cf9e1db30d5a36a469f74d15`.
Both the preparation script and browser validate it.

[upstream.lock.json](upstream.lock.json) records exact source/tool versions.
The bootstrap checks the LLVM/lld version and downloads checksum-verified
Node and Binaryen build tools into ignored `.local/`; it obtains the pinned
Emscripten source there. Node is used for compilation and test automation,
not by the deployed browser application. Build logs are in ignored
`build/logs/`; the Wasm output is `web/dkc.wasm` (excluded from Git).

The Python server serves only `web/` on localhost. The source folder, ROM,
private generated C, and native evidence are outside its document root.
Keep generated game code/binaries, extracted assets, ROMs, and saves out of Git.
The [public mobile test site](https://pipebrain.github.io/DKC1RecompWeb-Pages/)
is hosted through a separate deployment repository; this source repository
stays private. See [GitHub Pages and mobile testing](docs/PAGES.md).

## Controls and saves

Keyboard is the default input for a fresh browser profile. Click the game
screen to focus it. Arrows move, **Z** maps to B/jump, **X** to
Y/run/roll, **Enter** to Start, and **Shift** to Select. **A**, **S**, **Q**,
and **W** map to A, X, L, and R. Open **Config → Input** to change keyboard
bindings with **Set key** and **Clear**, then **Save**. **Discard** returns to
the saved mapping; **Restore defaults** prepares the original keys for saving.
The menu shows Keyboard (default), Keyboard (custom), or Gamepad as appropriate.
Choose **Gamepad** as the input device to activate controller mappings. Keep
the original standard mapping or create a custom button/axis/hat profile.
Controller profiles can be saved locally, exported, and loaded from JSON. See the
[controller guide](docs/CONTROLLERS.md) for setup and validation limits.
Switching tabs or losing focus pauses the game. A screen overlay shows
**Paused**, the active input source, and the saved Start binding to resume.

With the game screen focused, press the selected input's mapped **Start**
(Return by default on the keyboard) to quick start or resume a paused game.
That press is consumed until release; the next Start press during play goes
to DKC normally. Menus, dialogs, input editing, and background pages block
quick resume. A controller held through focus/source changes or reconnection
must be released before a fresh press can resume.

Wide viewports have an application menu bar. Narrow/short viewports use a
compact **Menu** in the same navigation element. The only content outside
navigation is the game screen; there are no headers, toolbars, status strips,
or empty-state controls. A static monochrome DK coin precedes the ZSNES-inspired
**DKM**, **Config**, **Cheat**, **NetPlay**, and **Misc** groups. **Config** hosts
Input, Devices, Options, Video, Sound, Saves, and Speed. The separate Input,
Devices, and Options menu items select three tabs in one shared settings page.
Paths, Cheat, and NetPlay
are visibly disabled until implemented. Opening Config pauses the game.
**Misc → Help** opens keyboard controls separately from Config. Menus also support keyboard navigation,
with **⌘O** for Load ROM and **⌘,** for Config on Mac.
The interface follows [the design brief](docs/UI_DESIGN.md) with automatic
light/dark appearance and no browser runtime dependencies.

About and Help load from editable [web/About.md](web/About.md) and
[web/Help.md](web/Help.md). Reload the page after editing them. Missing or empty
Help content disables its menu commands. About credits and links to the
original repositories and this private browser repository.

Normal cartridge SRAM is stored in IndexedDB. Save in-game at Candy's, then
use **DKM → Export Save** to keep a copy. **Load Save** accepts a 2,048-byte SRAM
file; choose **Reload Game** to let the game read the imported files. Storage is tied
to the browser profile and the exact local origin, including port number.

**DKM → Reload Game** returns the already selected ROM to a fresh, paused boot
without another file picker. It preserves cartridge SRAM and controller
profiles and keyboard settings; use **DKM → Start Game**, mapped Start, or Space
to begin again. The DKM command becomes **Pause Game** during play and
**Resume Game** after pausing. Resuming preserves the current game state.

## GitHub Pages and mobile testing

For a Pages artifact, build the Wasm locally, then package only the allowlisted
runtime files and notices:

```sh
python3 scripts/package_pages.py --out build/pages
python3 scripts/package_pages.py --out build/pages --verify
python3 scripts/pages_archive.py create --package build/pages \
  --out build/pages-transfer/pages-site.tar.gz
```

The archive is supplied as a release asset to a manual Pages workflow; ROMs,
saves, generated C, and compiled Wasm remain out of Git. Browser files and Wasm
are publicly served by Pages. A paired controller or hardware keyboard is
needed for mobile gameplay; physical Android/iOS testing remains outstanding.
The private repository's account plan does not support Pages for it. The user
chose [DKC1RecompWeb-Pages](https://github.com/pipebrain/DKC1RecompWeb-Pages)
as the separate public deployment repository, preserving source/history privacy.

To verify a published site (with a ROM still selected locally in Chrome):

```sh
node scripts/browser_check.mjs --url https://pipebrain.github.io/DKC1RecompWeb-Pages/ \
  --manifest build/pages/pages-manifest.json --rom '/absolute/game.smc'
```

This checks deployed asset identities, the native frame oracle, saves, sound,
and pause/resume. It does not replace physical phone/tablet testing.

## Reference checks

The unchanged native headless host can be rebuilt and replayed without SDL:

```sh
python3 scripts/native_reference.py --rom '/absolute/path/to/your/dkc1.smc' \
  --out build/native-reference/evidence/new-check
```

This defaults to three clean 600-frame, no-input runs and preserves each run's
frame/memory/audio fingerprints. Use a new evidence directory each time.
The C browser adapter has also been compared natively against that oracle.
These checks alone do not establish browser correctness or a full playthrough.

The browser's debug hooks are available through `window.dkcDebug` for controlled
stepping and integration checks. Browser validation status and limits belong
in [docs/PROJECT.md](docs/PROJECT.md).

The first browser title and Jungle gameplay checks pass against the native
framebuffer oracle. To repeat the controlled Jungle entry/movement check:

```sh
.local/tools/node-v22.16.0-darwin-arm64/bin/node scripts/browser_check.mjs \
  --rom '/absolute/path/to/your/dkc1.smc' --frames 7450 \
  --input tests/fixtures/jungle-entry.inputs \
  --expected-frame 506dbc580397d38d4fbd5331b18a732393da7467ae7455ffcf31193e11548d43
python3 scripts/check_runtime.py
```

The browser runner uses an isolated Chrome profile and temporary local port,
captures evidence under `build/browser-check/`, verifies SRAM persistence and
the audio pipeline, and restores its test SRAM before closing. The input
fixture contains only controller masks and frame counts. A full playthrough,
agent-operated physical controller test, long audio session, and a detailed
Candy save/load playtest remain outside the recorded automated coverage.
