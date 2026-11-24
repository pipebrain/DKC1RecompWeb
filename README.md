# DKC1R Web

Phase 1 ports the pinned DKC1Recomp C core to standalone WebAssembly, presented
by a handwritten JavaScript host using WebGPU. Donkey Kong Land integration is
a later phase. Read [the project brief](docs/PROJECT.md) for decisions and
verified status. The accepted browser baseline is tagged
[v1.0.0](https://github.com/pipebrain/DKC1RecompWeb/tree/v1.0.0).
The [Phase 2 snapshot](https://github.com/pipebrain/DKC1RecompWeb/commit/41a969f4de1cc48a728873f77e22a86fdfdc465b) preserves the feature-parity build. The current browser release is **v1.1.2**. The phone-first interface runs on the tagged v1.1.0 stock DKC1Recomp v0.0.17 player.

The [pipebrain/DKC1RecompWeb repository](https://github.com/pipebrain/DKC1RecompWeb)
preserves the original [DKC1Recomp](https://github.com/elliotttate/DKC1Recomp)
Git history and adds the
browser port on top of the pinned revision. `origin` points here and `upstream`
points to the original project. [README.upstream.md](README.upstream.md) retains
the native project's original README; its license and third-party notices are
preserved at the repository root.

The upstream native tree remains available. Browser sources live in `web/`,
`runtime/`, and `cmake/native/` / `cmake/wasm/`; the tested browser build still
uses its separate pinned source checkout under ignored `.local/upstream/`.

## Play on Mac

With the local build ready, double-click **Play.command** in the project root
or run `./Play.command` in Terminal. It opens Chrome at `http://localhost:8000/`,
the same address as the original Mac launcher for access to saved games and input
profiles. Choose **Load ROM** on the game screen and select your USA v1.0
ROM. With ROM remembering enabled, it opens automatically on subsequent visits.
Choose **Start Game** to play. The navigation rail contains Settings, Save
States, and the game controls. Keep Terminal open while playing. Press
**Control-C** there to stop the server.

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

Open [the local player](http://localhost:8000/) in Chrome. Choose **DKM → Load ROM**
(or **Menu → Load ROM**), select the same ROM, then use **DKM → Start Game**
or press **Space** with the game focused. Sound starts on. Use **Config → Sound** to mute or unmute.
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
not by the deployed browser application. Generation logs are under
`build/DKC1Recomp-v0.0.17/logs/` and Wasm build logs are under
`build/phase2-wasm/logs/`. The build installs one stock module at `web/dkc.wasm`.

The Python server serves only `web/` on localhost. The source folder, ROM,
private generated C, and native evidence are outside its document root.
Keep generated game code/binaries, extracted assets, ROMs, and saves out of Git.
Play the shipped version at [DKC1R Web](https://pipebrain.github.io/DKC1RecompWeb/). See [GitHub Pages and mobile testing](docs/PAGES.md).

## Controls and saves

Keyboard is the default Player 1 profile. Arrows move, **Z** jumps, **X** runs
or rolls, **Enter** maps to Start, and **Shift** maps to Select. **A**, **S**,
**Q**, and **W** map to A, X, L, and R.

Open **Settings → Manage input profiles** to create, rename, or delete a
profile. Use **Set** or **Clear** beside any SNES action. One profile can
combine keyboard, mouse, and gamepad bindings. Choose a profile for each
player from the Input section in Settings. Test and tune rumble in the
profile editor. **Save Settings** and **Load Settings** transfer settings and
profile assignments.

The game screen shows the **Start Game** or **Resume Game** overlay when
appropriate. With the screen focused, the mapped Start input also starts or
resumes play. The navigation rail offers **Pause Game** during playback and
**Reload Game** to boot the selected ROM again. The game pauses by default
when the page loses focus.

**Settings → Files → Remember ROM** keeps a verified ROM in this browser.
Turning it off removes the saved ROM copy and keeps cartridge saves. To keep
progress, save at Candy’s Save Point. **Save Game** exports cartridge progress,
and **Load Game** imports a 2,048-byte SRAM file. Reload the game after import
to read the imported progress.

**Quick Save** creates a save state in an empty slot. **Quick Load** restores
the newest state. **Save States** shows saved snapshots and lets you load or
delete an individual state. Browser data belongs to the current browser
profile and site origin.

## GitHub Pages and mobile testing

For a Pages artifact, build the Wasm locally, then package only the allowlisted
runtime files and notices:

```sh
python3 scripts/package_pages.py --out build/pages
python3 scripts/package_pages.py --out build/pages --verify
python3 scripts/pages_archive.py create --package build/pages \
  --out build/pages-transfer/pages-site.tar.gz
```

The manual Pages workflow downloads the archive from a GitHub Release.
GitHub Pages serves the browser files and compiled Wasm from the allowlisted
artifact. ROMs, saves, generated C, and compiled Wasm stay out of Git. See
[Pages testing instructions](docs/PAGES.md#test-on-a-phone-or-tablet).

To verify a deployment, use the checker and package manifest from the revision
that produced it. For the v1.1.2 release, run the following.

```sh
node scripts/browser_check.mjs --url https://pipebrain.github.io/DKC1RecompWeb/ \
  --manifest build/pages/pages-manifest.json --rom '/absolute/game.smc'
```

This checks deployed asset identities, the native frame oracle, saves, sound,
and pause/resume. It does not replace physical phone/tablet testing.

## Reference checks

To rebuild the stock release headless host and native browser adapter, then
replay the same inputs in desktop Chrome, use a fresh evidence directory for
each case. Run the local build above first.

```sh
rom='/absolute/path/to/your/dkc1.smc'
replay() {
  evidence="build/stock-replay/$1"
  frames="$2"
  shift 2
  python3 scripts/native_reference.py --rom "$rom" --check-adapter \
    --frames "$frames" "$@" --out "$evidence" || return 1
  .local/tools/node-v22.16.0-darwin-arm64/bin/node scripts/browser_check.mjs \
    --rom "$rom" --frames "$frames" "$@" --native-reference "$evidence/comparison.json"
}
replay boot 600 && replay title 5100 && \
  replay jungle 8070 --input tests/fixtures/jungle-route.inputs && \
  replay two-player 9376 --input tests/fixtures/two-player-contest.inputs
```

The native runner defaults to three independent replays. The browser runner
compares the framebuffer, WRAM, VRAM, CGRAM, hardware OAM, source OAM and
cumulative audio against that route's native report.

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
fixture contains only controller masks and frame counts. A separate Chrome test
saves at Candy’s, quits Chrome, reopens the remembered ROM and selects the
updated game file. [Candy verification and reproduction](docs/VALIDATION.md#phase-2-cartridge-storage-and-candys-save-point).
Full-game, long-session audio and physical-controller coverage remain open.
