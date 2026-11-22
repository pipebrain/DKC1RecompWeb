# DKC1RecompWeb

Phase 1 ports the pinned DKC1Recomp C core to standalone WebAssembly, presented
by a handwritten JavaScript host using WebGPU. Donkey Kong Land integration is
a later phase. Read [the project brief](docs/PROJECT.md) for decisions and
verified status. The accepted browser baseline is tagged
[v1.0.0](https://github.com/pipebrain/DKC1RecompWeb/tree/v1.0.0).
The [private Phase 2 snapshot](https://github.com/pipebrain/DKC1RecompWeb/commit/41a969f4de1cc48a728873f77e22a86fdfdc465b) preserves the feature-parity build. This branch targets **v1.1.0**, a clean browser player using the stock DKC1Recomp v0.0.17 game, original soundtrack and 4:3 presentation.

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

## Play on Mac

With the local build ready, double-click **Play.command** in the project root
or run `./Play.command` in Terminal. It opens Chrome at `http://localhost:8000/`,
the same address as the original Mac launcher for access to saved games and input
profiles. The first time, choose **DKM → Load ROM** and select your USA v1.0
ROM. On subsequent visits it opens automatically. Choose **DKM → Start Game**. Keep Terminal open while playing. Press **Control-C** there
to stop the server.

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
Select **Player 1** or **Player 2** to assign a keyboard, a gamepad, or both
to that SNES port. Player 2 starts disabled. Keep
the original standard mapping or create a custom button/axis/hat profile.
Controller profiles can be saved locally, exported, and loaded from JSON. See the
[controller guide](docs/CONTROLLERS.md) for setup and validation limits.
Switching tabs or losing focus pauses the game by default. A screen overlay shows
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
Input, Devices, Options, Video, Sound, Paths, Saves, Speed, Load Config and Save Config. The separate Input,
Devices, and Options menu items select three tabs in one shared settings page.
Paths manages the remembered ROM. The [settings inventory](docs/SETTINGS.md) covers defaults, both input ports, stomp rumble and portable configurations. Cheat and NetPlay are visibly disabled. Opening Config pauses the game.
**Misc → Help** opens keyboard controls separately from Config. Menus also support keyboard navigation,
with **⌘O** for Load ROM and **⌘,** for Config on Mac.
The interface follows [the design brief](docs/UI_DESIGN.md) with automatic
light/dark appearance and no browser runtime dependencies.

About and Help load from editable [web/About.md](web/About.md) and
[web/Help.md](web/Help.md). Reload the page after editing them. Missing or empty
Help content disables its menu commands. About credits and links to the
original repositories and this private browser repository.

The browser remembers a verified ROM locally by default. Turning off
**Config → Paths → Remember ROM on this device** removes that copy and keeps
your cartridge saves. If local ROM storage is unavailable, use the file picker.

Jump into the barrel at Candy’s Save Point to save. To continue after closing Chrome,
open the same address in the same profile, choose **DKM → Start Game** and select
that file in the game. Use **DKM → Export Save** to keep a backup. **Load Save** accepts a 2,048-byte SRAM
file; choose **Reload Game** to let the game read the imported files. Storage is tied
to the browser profile and the exact local origin, including port number.

For a snapshot of the current frame, choose one of five slots under **Config → Saves**
and use **Save State** or **Load State**. Stock Phase 2 slots carry over on the
same origin. **Config → Input → Save-state shortcuts** lets you bind a key or
gamepad input to either command.

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
needed for mobile gameplay. The public test site serves the clean v1.1.0 preview.
The earlier v1 mobile build passed user testing. See [Pages testing instructions](docs/PAGES.md#test-on-a-phone-or-tablet) for the new controller and configuration checks.
The private repository's account plan does not support Pages for it. The user
chose [DKC1RecompWeb-Pages](https://github.com/pipebrain/DKC1RecompWeb-Pages)
as the separate public deployment repository, preserving source/history privacy.

To verify a deployment, use the checker and package manifest from the revision
that produced it. For the clean v1.1.0 preview:

```sh
node scripts/browser_check.mjs --url https://pipebrain.github.io/DKC1RecompWeb-Pages/ \
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
