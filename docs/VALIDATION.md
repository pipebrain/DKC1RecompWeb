# Browser verification

## Phase 3 clean v1.1.0 candidate

Desktop checks use the locally built stock Wasm, the verified USA v1.0 ROM
and a temporary Chrome profile. The public Pages preview is a separate
Phase 2 artifact.

- Chrome matched all seven native fingerprints at frame 600 (boot), 5,100
  (title), 7,450 (Jungle entry) and 8,070 (Jungle gameplay). At Candy's,
  the clean build produced byte-identical SRAM. After a full Chrome restart,
  the remembered ROM reopened and continuing the saved file matched native.
- Chrome loaded Phase 2 settings and exported a clean config with both player
  assignments, supported bindings, volume, rumble and slot selection.
  Config recovery tests exercised a partial write and an interrupted import.
- Saving to slot 4 at frame 600, quitting Chrome, and launching a second
  process restored the remembered ROM, preferences and snapshot. The immediate
  frame hash was `a7366146a96b47e75d48d3814bfe0859c71f68bcc3fac3d7429befb9b50430dd`.
  Both continuations reached `07e1af55727403d49be41056356242fffe1af477a72494648f6aedb292fcc492`
  at frame 645.
- The clean core restored stock states written by the Phase 2 module at
  frames 600, 5,100 and 7,450. All seven native fingerprints matched both
  immediately and 60 game ticks later. States saved at 308- and 342-pixel
  widths restored their center 256 pixels and then matched the stock
  continuation. Invalid snapshot lengths were rejected before applying the
  saved game.
- Chrome exercised simultaneous keyboard/gamepad input on two ports, two
  controllers reporting the same ID, disconnect/reconnect with a direction
  held, and raw eight-way hat diagonals. Those tests inject Gamepad API
  fixtures. Android and iOS Bluetooth reconnection and rumble remain device
  acceptance checks.
- With Player 1 disabled and Player 2 assigned keyboard and gamepad, both
  Player 2's mapped Space and controller Start resumed the game. The resume
  press was consumed until release. The next press delivered Start on port 2
  alone (`0x8000`).
- A Bluetooth 8BitDo SN30 Pro+ in Mac mode identified as DUALSHOCK 4
  Wireless Controller (`054c:05c4`). Chrome 158.0.8127.36 on macOS 27.0.1
  exposed a `dual-rumble` actuator. The user felt a full-strength 750 ms
  diagnostic pulse. On the actual Jungle enemy rebound at frame 7,579,
  they felt no vibration with the original 55 ms effect (16% strong,
  31% weak). They felt the new Standard effect (140 ms, 80% strong,
  100% weak) on the same gameplay route. Chrome reported `complete`
  for all three requests. With the same physical controller active, a
  stationary jump from grounded frame 7,650 through landing produced
  zero stomp events and zero motor requests.
- Separate Chrome regression checks replayed the same rebound with
  Standard, Light (original), and rumble off. The assigned actuator
  received each preset's specified pulse or no request when off. The
  Devices test requested 500 ms at full strength. Config import, export
  and reload retained Light. Older settings adopted Standard.
- The 9,376-frame [Two Player Contest route](../tests/fixtures/two-player-contest.inputs)
  selects the mode, plays until Player 1 loses a life, then enters Jungle
  Hijinxs using Player 2's Start. Player 2's Right moves DK from world X
  156 to 192. Replaying that final input on port 1 leaves him at 156.
  Chrome matched the native route across all seven fingerprints.

To repeat the config checks or restore a snapshot written by the archived
Phase 2 stock core, use the pinned Node executable. For the cross-build
check, point the final argument at an extracted Phase 2 runtime package.

```sh
node=.local/tools/node-v22.16.0-darwin-arm64/bin/node
"$node" --test tests/*.test.mjs
"$node" scripts/ui_check.mjs --config --rom '/absolute/path/to/your/dkc1.smc'
"$node" scripts/check_state.mjs '/absolute/path/to/your/dkc1.smc' --phase2-package /absolute/path/to/phase2-package
```

## Phase 2 live Pages preview

The [public Phase 2 test site](https://pipebrain.github.io/DKC1RecompWeb-Pages/)
passed desktop Chrome verification after [deployment](https://github.com/pipebrain/DKC1RecompWeb-Pages/actions/runs/45024302063)
on November 22, 2026. The hosted manifest and all 42 listed file hashes matched
the approved package before and after the game test. A local ROM reached the
600-frame boot checkpoint and matched all seven native fingerprints.
Audio playback, pause/resume and cartridge-save persistence also passed.
Game evidence is in `build/browser-check/2026-11-22T12-50-34-809Z-55697/evidence.json`.

At 390 × 844, Chrome recognized a simulated SN30 Pro+ button and diagonal
hat input. The Devices command requested a 55 ms rumble pulse. Config
export/import restored the settings and controller routing through a page
reload. Compact-menu evidence is in
`build/phase2-pages-live-compact/2026-11-22T12-50-34-391Z-55684/evidence.json`.
Android and iOS Bluetooth input and physical rumble still need device testing.

## Phase 2 player settings

Use the [Phase 2 checkout](https://github.com/pipebrain/DKC1RecompWeb/tree/41a969f4de1cc48a728873f77e22a86fdfdc465b)
to reproduce the historical settings and optional-feature checks below.

The config suite runs the production app in a fresh Chrome profile. Supply the
same verified ROM used for the build.

```sh
node scripts/ui_check.mjs --config --rom '/path/to/game.smc'
node scripts/check_state.mjs '/path/to/game.smc'
```

Chrome 158.0.8127.36 on the Mac downloaded and reimported a configuration
through the wide and compact menus. A fresh page restored the edited sound,
volume, theme, timing, keyboard and controller choices. An unsupported
format, an out-of-range value and a pending keyboard edit preserved the
previous settings. A simulated quota error after the first localStorage write
rolled back the import and retained the ROM. Reopening recovered a deliberately
interrupted configuration transaction. The Options diagnostics export contained
a local checkpoint, 12 frames of input and the matching end-frame hash. ROM retention, cartridge SRAM, state slots and external
music and artwork remained independent of the config file.

The menu-selected Dixie core verified the synthesized cartridge identity and
retained its own SRAM through a page reopen and a switch back to stock.
Each native route ran three times. These Chrome checkpoints matched the pinned native Dixie executable
on all seven framebuffer, memory and cumulative audio fingerprints.

| Dixie checkpoint | Framebuffer SHA-256 | Cumulative stereo PCM FNV-1a |
| --- | --- | --- |
| Title at 5,100 frames, 4:3 | `67cb48a8b13c3a2891e1e6b1c16ec5c72c7a7ac52a80933347b23757c3fdc1df` | `d035ba629bc04d2c` |
| Jungle at 7,450 frames, 4:3 | `723ba727ae9c141e8b0ba0b900867467e72b0efab1d4bf8256fa574ec15faa90` | `9468a57229ee4103` |
| Jungle at 7,450 frames, 16:9 | `8b67ced9246569b6afa21aa7ee2364b01d29bb87277773383a84ca425428db09` | `9468a57229ee4103` |

A deflated ZIP-format MSU-1 pack with 32 synthetic tracks survived reopening.
At the 5,100-frame title the muted replacement produced `d5723fbc63514e57`
and the same pack at unit gain produced `705314b7b2844c8f`. Forgetting the
pack restored the original soundtrack. A separate sample-by-sample comparison
against the C mixer reproduced looping, non-looping tracks, a missing track,
restart, interpolation and saturation across 280 frame batches with gain
2.53. Both PCM files had SHA-256
`cf71e3726d4cbfb8624eaa782d9089fc9b49b1b2cdf92e252f3b82febccd28e1`.

Chrome saved a state, reopened the page and reproduced the saved frame and its
continuation. A separate run quit Chrome completely and reopened the same local
origin and browser profile. Both config exports were identical, including
16:10, Reconstruct, 37% volume and slot 4. The state and its 45-frame
continuation matched. See `build/cold-restart-check/evidence.json`.
Rewind and single-frame advance worked through the menus. The
direct Wasm state check matched all seven fingerprints immediately on restore
and 60 frames later at frames 600, 5,100 and 7,450 for stock and Dixie.
A synthetic HD material uploaded from the Paths sheet survived reopening.
At Jungle entry the 4× WebGPU upload contained its test color while the source
frame retained the native hash.

Chrome also imported the official macOS HD Preview attached to the v0.0.17 release.
The archive filename retains its v0.0.15 label. Its SHA-256 matched the release
checksum, `01c00aa8b410bacce08c08574ed6a41f649bb9e121dcef5e0447171a8953be0f`.
Only the Materials subtree was extracted. The native CPU compositor and the
browser both loaded the 24,263 indexed rasters. At frame 600 Chrome presented
the stock 256×224 framebuffer byte for byte. At Jungle frame 7,450 the entire
1024×896 WebGPU upload matched native SHA-256
`24b45574214295c02d28373b50d186f20782905eaa22ecd3a2dfd64c00855161`.
The HD frame changed 909,859 RGB pixels relative to nearest-neighbor stock.
The archive, extracted materials and native oracle remain under ignored
`build/phase2-evidence/official-hd/`. The Chrome evidence from a fixed local
snapshot is `build/official-hd-check/2026-11-22T12-28-29-369Z-54109/evidence.json`. [Upstream release](https://github.com/elliotttate/DKC1Recomp/releases/tag/v0.0.17)

The source-locked Chrome evidence is under
`build/config-check/2026-11-22T12-29-13-204Z-54356/evidence.json`. These runs
use local test packs and a fresh browser profile. Physical Android/iOS
devices and a full user-supplied soundtrack were outside this run.

## Phase 2 stock v0.0.17

On November 22, 2026 the stock game ran through the normal ROM picker, worker, standalone Wasm
and WebGPU presenter on desktop Chrome 158.0.8127.36 using Apple Metal 3.
The clean release checkout and its engine match the revisions in the
[source lock](../upstream.lock.json). The verified USA v1.0 ROM generated
2,176 private C files. The linked module is 8,067,100 bytes, SHA-256
`70908a6d7a5b088c92087ab8f2c0e2fb62ea86ad56c2354ad35da083e57732c3`.
Its nine imports resolve through the existing handwritten host.

For each row, three fresh runs of the upstream headless executable and three
of the C browser adapter produced identical results. Chrome replayed the
same schedule in the browser worker at stock 256×224. At each checkpoint all
seven fingerprints matched native and the archived v1 reference. These cover
the framebuffer, WRAM, VRAM, CGRAM, PPU OAM, source OAM and cumulative
stereo PCM. The audio hash covers every generated sample from boot through
the checkpoint, before resampling.

| Checkpoint | Frames | Framebuffer SHA-256 | PCM FNV-1a (64-bit) | Evidence directory under `build/browser-check/` |
| --- | ---: | --- | --- | --- |
| Boot, no input | 600 | `a7366146a96b47e75d48d3814bfe0859c71f68bcc3fac3d7429befb9b50430dd` | `5c226d2c8297cb8e` | `2026-11-22T10-04-56-755Z-19146` |
| Title, no input | 5,100 | `60878dca94a5a87f77729991bdd301e211e94738ec1fb1556812aa4b5f63ff70` | `aee00a1c3f2b2831` | `2026-11-22T10-05-22-031Z-19344` |
| Live Jungle gameplay, five lives | 7,450 | `506dbc580397d38d4fbd5331b18a732393da7467ae7455ffcf31193e11548d43` | `ee60837a362b30da` | `2026-11-22T10-05-55-603Z-19714` |
| Full recorded Jungle route, after losing a life | 8,070 | `9e8c67590fe4b11ca5886f5dd4884e685ab195cea07d174f6902c952a7579ea5` | `fc07ebba6af7974a` | `2026-11-22T10-05-38-279Z-19499` |

The unobscured WebGPU screenshots matched the corresponding native RGB
captures at all 57,344 source pixel centers in each case. The title and Jungle
captures were visually inspected. Each Chrome run also passed SRAM
import/export, reload and restoration, pause/resume, and 1.8 seconds of
AudioWorklet playback with zero reported underruns or overruns.

The native reports are under `build/phase2-evidence/{boot,title,jungle-entry,jungle}/`.
Each browser directory contains `evidence.json`, `display-comparison.json`
and `unobscured-game.png`. The [replay commands](../README.md#reference-checks)
regenerate the game and audio comparisons from source. The [full input
recording](../tests/fixtures/jungle-route.inputs) and [gameplay
prefix](../tests/fixtures/jungle-entry.inputs) contain controller inputs.

An isolated same-origin upgrade check imported the existing 2,048-byte
save and saved the supplied 8BitDo SN30 Pro+ profile through the v1 host.
The Phase 2 host reopened the same browser storage, loaded the exact SRAM
bytes, restored the selected profile and delivered its mapped B press and
release to the worker. Evidence is in
`build/phase2-upgrade-check/2026-11-22T10-05-45-877Z-19579/evidence.json`.
Controller signals were injected. The earlier mobile acceptance applies to
the deployed v1 build. A full playthrough and long-duration audio test remain
open for Phase 2.

All 29 input and pause-presentation unit tests passed. Desktop Chrome also
passed six fullscreen configurations, the pause overlay checks and all ten
Start shortcut checks. Their evidence directories under `build/` are
`fullscreen-check/2026-11-22T10-05-04-761Z-19201`,
`pause-overlay-check/2026-11-22T10-06-06-557Z-20014` and
`start-shortcut-check/2026-11-22T10-06-06-557Z-20013`.

The keyboard and controller drivers now use DKM playback and check canvas
focus before testing live input. Earlier runs sent keys while Config held
focus, or expected gameplay input after a page reload with no ROM loaded.
Keyboard remapping, saved source selection and content checks passed in
`keyboard-content-check/2026-11-22T10-09-50-550Z-21824`. Standard/raw
controller mapping and release of a held button on disconnect passed with a
running game in `controller-check/2026-11-22T10-11-04-432Z-22554`.
The unloaded controller preview and input guard passed in
`controller-check/2026-11-22T10-11-04-432Z-22556`.

## First browser build · November 18, 2026

Date: 2026-11-18. [Source and tool pins for browser v1.0.0](https://github.com/pipebrain/DKC1RecompWeb/blob/v1.0.0/upstream.lock.json).
The supplied USA v1.0 ROM passed the expected size and SHA-256 checks.
Upstream and generated game sources were not edited.

## Build identity

- Private `web/dkc.wasm`: 8,021,037 bytes.
- SHA-256: `dcc015d75e943aac3eb179309426b0caa90321f88731effe85e8922b3de3a014`.
- Emscripten 6.0.2, LLVM/lld 23.1.6, Binaryen 129, CMake 4.5.0,
  Ninja 1.13.2; Node 22.16.0 is a build/test executable only.
- Browser: Chrome 157.0.8103.79, native Apple Metal 3 WebGPU adapter,
  standard headless flags. No unsafe-WebGPU flag was required.
- Static C archives and all nine actual imports are inventoried in
  [RUNTIME_DECISION.md](RUNTIME_DECISION.md).

## Reference comparisons

The unchanged native headless host and the new browser C adapter each passed
three independent 600-frame runs, matching framebuffer, WRAM, VRAM, CGRAM,
PPU OAM, source OAM, and cumulative audio fingerprints. The browser comparisons
below verify the raw four-byte framebuffer; they do not imply complete Wasm
memory/audio fingerprint comparisons.

| Browser case | Frames | Framebuffer SHA-256 | Evidence directory beneath `build/browser-check/` |
| --- | --- | --- | --- |
| No-input intro | 600 | `a7366146a96b47e75d48d3814bfe0859c71f68bcc3fac3d7429befb9b50430dd` | `2026-11-18T20-08-44-997Z-27072` |
| No-input title screen | 5100 | `60878dca94a5a87f77729991bdd301e211e94738ec1fb1556812aa4b5f63ff70` | `2026-11-18T20-09-11-116Z-27143` |
| Exact Jungle route | 8070 | `9e8c67590fe4b11ca5886f5dd4884e685ab195cea07d174f6902c952a7579ea5` | `2026-11-18T20-12-08-669Z-27594` |
| Live Jungle entry/movement prefix | 7450 | `506dbc580397d38d4fbd5331b18a732393da7467ae7455ffcf31193e11548d43` | `2026-11-18T20-13-33-032Z-27664` |

Every listed browser frame matches its native oracle exactly. Each browser
evidence directory contains `evidence.json`, `game.png`, ready-state capture,
and process logs. Title and live Jungle screenshots were visually inspected.
The fixed live-gameplay schedule is in
[`tests/fixtures/jungle-entry.inputs`](../tests/fixtures/jungle-entry.inputs).

Native evidence is under `build/native-reference/evidence/`: `boot-600`,
`adapter-600`, `boot-5100`, `jungle-route`, and `jungle-prefix-7450`.
The full inherited Jungle route loses a life before its later camera predicate;
its successful replay is not a completed level. The earlier 7,450-frame prefix
shows live DK movement with five lives remaining and avoids that ambiguity.

## Host and toolchain checks

- Local picker and C core independently verify the ROM; wrong size/hash are
  rejected. The C adapter retains ROM ownership after the upload is freed.
- Real WebGPU presentation occurs through the handwritten host.
- 2,048-byte SRAM import/export, invalid-size rejection, IndexedDB persistence
  across page reloads, and restoration of original test bytes pass.
- Real AudioContext/AudioWorklet execution passes a 1.8-second run. Observed
  underruns and overruns were both zero. The queue report is retained; this is
  a short pipeline check, not a listening-quality or long-duration result.
- Resume advances game frames and pause holds the count stable.
- The standalone C allocation/setjmp/longjmp probe passes 20 repetitions with
  no imports; repeat with `python3 scripts/check_runtime.py`.
- JavaScript/Python syntax checks and `git diff --check` pass.
- The local server exposes `web/` only. ROM, project-root, and traversal
  requests return 404; Wasm is served as `application/wasm`.
- Private inputs, generated sources/binaries, and captures remain excluded
  from Git. No remote publication or deployment was performed.

## User playtest feedback

The user reported on 2026-11-18 that Safari and Chrome both passed sound on/off,
keyboard input, and pause/resume. Saving/loading were initially untested.
After the controller work below, the user reported "Everything tests OK" and
requested the GUI overhaul. This accepts the prior functional baseline without
adding detailed full-game or hardware test evidence.
This visible playtest is separate from the automated IndexedDB/SRAM checks.

The user found fullscreen expanding horizontally while clipping vertically,
then clarified that `.toolbar` must remain separate from `.player` and only
`.screen-wrap` should enter fullscreen. The toolbar is now a sibling of the
player. The canvas fills the entire fullscreen viewport; WebGPU centers the
4:3 game image with bars as needed and no space reserved for controls. Canvas
resize/fullscreen events redraw the retained GPU texture without advancing a
paused game. Entry and exit return keyboard focus to the canvas.

Actual Chrome fullscreen checks passed at 1280x720, 1920x1080, 1024x768,
800x1000, and 480x320, plus 1280x720 at DPR 2. The test clicks the real
fullscreen button and checks `.screen-wrap` is the fullscreen root, the toolbar
is outside both `.player` and the fullscreen tree, and the canvas fills the
whole viewport with centered 4:3 output. Escape exit restores canvas focus;
the paused 600-frame source hash remains unchanged. Wide and compact captures
confirm no controls or clipping.

Evidence: `build/fullscreen-check/2026-11-18T20-54-48-890Z-29456/evidence.json`.
Reproduce with:

```sh
.local/tools/node-v22.16.0-darwin-arm64/bin/node scripts/fullscreen_check.mjs \
  --rom '/absolute/path/to/your/dkc1.smc'
```

The fullscreen fix was Chrome-verified before the user's subsequent general
acceptance. The redesigned interface needs a fresh visible Safari review. No
Safari automation settings were changed.

## Controller profiles and raw input

The user reported an 8BitDo SN30 Pro+, vendor/product `2dc8:6102`, whose
B0-B7/B10/B11 and axes 0/1/2/5/9 did not register in the player. Source inspection
confirmed the old host skipped any pad whose browser mapping was not
`standard`. The device's actual mapping string, startup mode, and complete
physical assignments were not recorded; the user confirmed Bluetooth in both
Chrome and Safari. No vendor-specific mapping is claimed agent-verified.

The default remains immutable, while custom profiles accept raw buttons,
signed/rest-offset axes, exact axis values, and explicit eight-way hats. The
live monitor works while settings have focus. Settings pause the game and
suppress controller output; saved profile selection, JSON import/export,
save/discard, and deletion are available. Storage is separate from SRAM.
Setup is described in [CONTROLLERS.md](CONTROLLERS.md).

Nine pure mapping/serialization tests passed, including all reported button
ranges and axis indices, hat diagonals/neutral, deadzones, trigger rest values,
capture, malformed files, default protection, and JSON round trips.

Actual Chrome integration with the supplied ROM and representative injected
gamepads passed:

- Raw and standard device discovery, with mapped button/axis/hat masks observed
  at the actual worker input boundary while the player canvas has focus.
- Live monitoring, binding capture, and input release/pause during settings.
- Default protection and export as an editable custom copy.
- New/edit/save/discard, real JSON download/import, invalid-file rejection,
  saved-profile loading, and per-controller selection after reload.
- Isolation from existing cartridge SRAM and restoration of test save bytes.

Evidence: `build/controller-check/2026-11-18T21-12-10-002Z-31107/evidence.json`.
Focused desktop/compact visual checks also passed; evidence:
`build/controller-check/2026-11-18T21-16-15-871Z-31443/evidence.json`.
These values are synthetic fixtures matching the user's reported index ranges,
not a physical-controller capture. The user later withdrew a diagonal-input
bug after correcting the binding setup and reported "Everything tests OK".
That user feedback is separate from the injected-device checks.

Focused visual checks at 1280x1000 and 480x900 verify all 12 binding rows use
the intended grid and controls fit without horizontal overflow. Evidence:
`build/controller-check/2026-11-18T21-15-20-674Z-31381/evidence.json`. Opening
Controllers previously scrolled the editor into view; the redesigned Settings
sheet scrolls its own content instead. Subsequent standard-game and
six-case fullscreen regressions also passed after controller integration:
`build/browser-check/2026-11-18T21-13-46-940Z-31218/evidence.json` and
`build/fullscreen-check/2026-11-18T21-13-45-824Z-31195/evidence.json`.

After integration, the unchanged 600-frame native browser framebuffer oracle,
audio/save/pause tests, and all six screen-only fullscreen configurations pass:
`build/browser-check/2026-11-18T21-13-46-940Z-31218/evidence.json` and
`build/fullscreen-check/2026-11-18T21-13-45-824Z-31195/evidence.json`.

## Apple-style interface overhaul

The browser shell now adapts between an emulated macOS application menu bar
and compact iOS-style navigation. It uses handwritten HTML/CSS/JavaScript and
SVG, system typography, light/dark appearance, and a modal Settings sheet.
The design references are in [UI_DESIGN.md](UI_DESIGN.md).

The final actual Chrome UI run passed:

- Menu keyboard traversal, including Game's initially disabled commands;
  Escape focus restoration; outside-click dismissal; and Open ROM dispatch.
- The unchanged 600-frame native framebuffer oracle, real menu playback/audio
  commands, Settings section navigation, modal focus isolation, unsaved-profile
  guards, discard, and game-save export.
- Layout at 1440x900 light, 1280x720 dark, 390x844 light, 844x390 dark,
  320x568 light, and 390x844 dark at DPR 2. No page scrolling, horizontal
  overflow, clipped stage/toolbar, or clipped Settings bounds was observed.
- Compact More navigation and Settings; 44px compact playback/More targets;
  screen-only fullscreen and Escape exit. No JavaScript or console errors.

Desktop/compact, light/dark, and Settings screenshots were visually inspected.
Final evidence and captures:
`build/ui-check/2026-11-18T23-49-14-263Z-35887/`.

Independent host regressions after integration also passed:

| Check | Evidence beneath `build/` |
| --- | --- |
| Native 600-frame hash, SRAM/import/export/reload, real AudioWorklet (zero observed underruns/overruns), pause/resume | `browser-check/2026-11-18T23-47-28-846Z-35355/evidence.json` |
| Controller raw/standard inputs, capture, save/discard, JSON round trips, profile persistence and SRAM separation | `controller-check/2026-11-18T23-47-58-739Z-35441/evidence.json` |
| All six screen-only fullscreen size/DPR configurations | `fullscreen-check/2026-11-18T23-47-58-739Z-35442/evidence.json` |
| Native save-file chooser from File and compact More while Settings is closed | `ui-check/2026-11-18T23-48-18-598Z-35819/evidence.json` |

All nine pure gamepad profile tests and whitespace checks pass. The private
Wasm SHA-256 remains `dcc015d75e943aac3eb179309426b0caa90321f88731effe85e8922b3de3a014`.
The user's `web/start-app.command` and `web/8bitdo-sn30-pro.json` are unchanged.
The new interface still needs a visible Safari/user review; mobile sizes here
are Chrome emulation, not physical iPhone/iPad testing.

## Menu-only composition revision

The user rejected the first shell's extra interface regions and required menus
as the only main interface controls in both wide and narrow modes. The HTML
and CSS now remove `.menubar-caption`, `.app-navigation`, `.toolbar`,
`.app-status`, and the empty-state text/buttons. The closed main page contains
one `.app-menubar` navigation element and the game canvas. Compact mode uses
that same navigation element, with all application commands in its menu.
Settings/About remain menu-opened tasks. Status/errors appear within menus.

The host now dispatches playback, audio, fullscreen, and save commands
directly instead of clicking removed toolbar controls. Menus preserve familiar
ordering, state-dependent labels, disabled commands, keyboard shortcuts, focus
restoration, and 44px compact targets. Keyboard navigation scrolls long menus
to keep the active item visible. Pointer menu opening explicitly moves focus
from the canvas to the trigger.

Post-revision host checks pass:

| Check | Evidence beneath `build/` |
| --- | --- |
| Native 600-frame framebuffer, SRAM/import/export/reload, audio (zero observed underruns/overruns), pause/resume | `browser-check/2026-11-19T00-11-42-945Z-37513/evidence.json` |
| Controller mapping/profile integration, JSON round trips, persistence and SRAM separation | `controller-check/2026-11-19T00-12-07-661Z-37560/evidence.json` |
| Six screen-only fullscreen configurations | `fullscreen-check/2026-11-19T00-12-07-661Z-37561/evidence.json` |

The final UI run passes across all six viewport/theme/DPR cases, with unchanged
source hashes recorded in its report. It verifies the removed regions are
absent, there is one main navigation element, and no main text/controls appear
outside it. All eleven application commands are accessible from desktop and
compact menus. Tests cover keyboard traversal/long-menu scrolling, Settings
draft guards, real file chooser events, compact playback/audio, screen-only
fullscreen, and invalid-ROM errors revealed within menus. No JavaScript or
console errors were observed. Desktop and compact screenshots were visually
inspected, including portrait/landscape, open menus, and light/dark appearance.

Final UI evidence and captures:
`build/ui-check/2026-11-19T00-13-22-514Z-38039/`.
The private Wasm, launcher, and supplied controller profile remain unchanged.
This revision still requires a visible Safari/user review.

## ZSNES-inspired menu structure and Reset Game

The main menu now follows the user's requested grouping: a static monochrome
DK coin with no action/submenu; DKM; Config; Cheat; NetPlay; Misc. DKM contains
Load ROM, Reset Game, Load Save, and Export Save. Config contains Input,
Devices, Options, Video, Sound, Paths, Saves, and Speed; Misc contains Help
and About. The compact menu exposes the same working commands. Paths, Cheat,
and NetPlay remain visibly disabled because they are not implemented.

The generated logo is a transparent monochrome PNG based on the user's
reference images; no source photographs were copied into the project. It
renders through a theme-aware CSS mask. Its alpha, monochrome pixels, and
20px/28px light/dark appearance were checked.

Reset retains the verified ROM in session memory, snapshots current cartridge
SRAM, recreates the Wasm instance, restores SRAM, and clears the retained GPU
frame. It returns to frame zero paused without another ROM picker or a change
to controller profiles. It does not implement emulator save states.

Final Chrome UI evidence:
`build/ui-check/2026-11-19T00-45-45-749Z-40845/evidence.json`.
Source hashes matched at completion. Checks cover desktop/compact Reset with
distinctive SRAM bytes, unchanged profiles, a repeat of the native 600-frame
oracle after reset, exact menu grouping, static coin semantics, actual Devices
readouts, Options help, Config guards, native file choosers, sound/playback,
screen-only fullscreen, and all six layout/theme/DPR cases. Screenshot review
included desktop/compact menus and Config sheets. No JavaScript or console
errors were observed.

Independent regression evidence:

| Check | Evidence beneath `build/` |
| --- | --- |
| Native framebuffer, save/reload, real audio pipeline, pause/resume | `browser-check/2026-11-19T00-46-22-401Z-41188/evidence.json` |
| Controller mapping/profile integration and SRAM separation | `controller-check/2026-11-19T00-42-52-338Z-40004/evidence.json` |
| All six screen-only fullscreen configurations | `fullscreen-check/2026-11-19T00-42-53-488Z-40024/evidence.json` |

After these runs, a small menu-opening adjustment resets long compact menus
to the first section on reopening. Three controller messages were also renamed
from Controllers to Input/Config; mapping and persistence logic were unchanged.
The final focused check passes with unchanged source hashes, including the
controller module and PNG: `build/menu-scroll-check/2026-11-19T00-48-23-836Z-41372/evidence.json`.
It checks reopening at the top and keeping End/ArrowUp items visible at
390x844 and 844x390. A settled Devices screenshot was also visually verified:
`build/ui-visual/2026-11-19T00-47-26-229Z-41275/devices-settled.png`.
The game binary, user launcher, and supplied controller profile are unchanged.
Visible Safari and physical-device testing were not repeated in this run.

## Shared Input settings tabs

The user confirmed separate Config menu entries for Input, Devices, and
Options that open three tabs in one settings page, and visible disabled
entries for unavailable features. The settings sidebar now shows Input once;
the shared page has a horizontal Input | Devices | Options tab strip. Video,
Sound, Paths, Saves, Speed, and Help remain separate pages.

Focused Chrome verification passes with unchanged source hashes and no
JavaScript/console errors:
`build/input-tabs-check/2026-11-19T00-56-44-793Z-41872/evidence.json`.
Checks include all three menu commands, matching selected tabs, shared/sidebar
visibility, keyboard navigation within each tab group, skipping disabled
Paths, and dirty-profile protection for tab changes, leaving the page, Done,
and Escape. Discard permits navigation again. Opening Config pauses the
loaded ROM. Desktop/compact screenshots were inspected at 1440x900 light,
390x844 light, 844x390 dark, and 320x568 dark without clipping.

Reproduce with the existing runner's `--input-tabs` mode and the local ROM.
The game runtime, audio, saves, and mapping behavior were not changed in this
layout correction; earlier host regressions remain recorded above.

## DKM Start/Reload and Config cleanup

The DKM menu now reads Load ROM; separator; Start Game, Reload Game;
separator; Load Save, Export Save in both layouts. Start Game starts/resumes
the selected ROM and is disabled while unloaded, loading, or already running.
Reload Game retains the existing fresh paused boot behavior and preserves
SRAM/profiles. Config no longer contains `.sheet-eyebrow` or
`#settings-tab-keyboard`. Misc > Help opens a standalone modal; its input,
focus, and error handling participate in the existing modal guards.

Focused actual Chrome checks pass with unchanged source hashes and no
JavaScript/console errors:
`build/dkm-menu-check/2026-11-19T01-13-00-812Z-42647/evidence.json`.
Coverage includes desktop/compact DKM labels and separators, native ROM picker,
Start enablement and actual frame advance without resetting, repeated Start
without pausing/restarting, Reload preservation and native 600-frame replay,
the required DOM removals, standalone Help and Escape/focus behavior, and
shared Input tabs/draft guards. Desktop menu and compact Help screenshots were
visually inspected. No broad audio or controller reruns were needed for this
menu change; earlier host evidence remains above.

## Markdown content and editable default keyboard

About now uses `.dk-coin` and loads `web/About.md`. Help loads `web/Help.md`.
The new documents adapt the pinned original project's description, credits,
controls, and save guidance while identifying the browser modifications and
unimplemented native enhancements. About links to DKC1Recomp and snesrecomp;
our repository link is omitted at the user's request until a repository exists.
The handwritten Markdown reader uses DOM text and validated HTTP(S) links;
raw HTML and executable links remain inert. Missing, empty, or HTML-fallback
Help responses leave every Help command disabled.

A fresh profile selects Keyboard and shows Keyboard (default) in the menu.
Config > Input provides key capture, Clear, Save, Discard, and Restore defaults.
Keyboard settings and the selected source use `dkc.keyboard-settings.v1`,
separate from gamepad profiles and SRAM. Gamepad mappings activate only after
selecting Gamepad; keyboard gameplay is inactive in that mode. Source changes,
pause, and focus loss release held input. Space is bindable: its game mapping
takes priority during play, while the default unbound key pauses/resumes and
Space can still start a paused game.

Eight pure keyboard validation/mapping tests pass. Actual Chrome integration
passes with unchanged source hashes:
`build/keyboard-content-check/2026-11-19T01-39-27-042Z-45605/evidence.json`.
It covers real keyboard events at the worker input boundary, both Shift keys,
inactive-source suppression, custom Space, saved remapping, Save/Discard/
Restore defaults, duplicate/reserved rejection, draft guards, page-reload
persistence, corrupt-storage repair, and isolation from controller profiles
and cartridge SRAM. About links/coin, safe rendering, and all unavailable-Help
cases also pass. Foreground-focus emulation is recorded for the isolated
headless input target; these are browser events and injected gamepad fixtures,
not physical-controller testing.

The existing controller regression passes with explicit Gamepad selection:
`build/controller-check/2026-11-19T01-42-43-864Z-46429/evidence.json`.
After the functional run, a scoped CSS rule fixed the keyboard capture-cancel
button appearing while hidden. Final visual/focused checks pass with unchanged
source hashes at 1440x900, 390x844, and 844x390:
`build/keyboard-content-visual/2026-11-19T01-43-31-999Z-46475/evidence.json`.
Cancel is visible only during capture; About, Help, and keyboard layouts fit.

The final native-frame/save/audio/pacing browser regression also passes with
unchanged source hashes and the native Apple Metal 3 WebGPU adapter:
`build/browser-check/2026-11-19T01-47-00-539Z-46762/evidence.json`.
The 600-frame hash is unchanged; SRAM import/export/reload/restoration passes;
the real AudioWorklet ran for 1.8 seconds with zero observed underruns/overruns;
pause/resume pacing passes. No JavaScript or network failures were observed.
The runner now records foreground-focus emulation, startup network/lifecycle
diagnostics, and source/Wasm hashes. Earlier isolated startup attempts stalled
before the module graph finished; the precise cause was not independently
established. No application workaround or unsafe-WebGPU flag was introduced.

The standalone Wasm, user launcher, and supplied controller profile remain
unchanged. Safari and physical hardware were not retested in this run.

## Mapped Start quick start/resume

The selected keyboard/controller profile's logical Start quick starts or
resumes only with the game screen focused in the foreground. That press is
consumed until release. Later Start presses during play still reach SNES Start.
Menus, dialogs, loading, input capture, unsaved drafts, and error states block
the shortcut. Connection, source, and focus transitions require a fresh press.
Pending resumes are canceled during audio waits or after worker dispatch;
stale resume responses cannot restore running state.

Five new pure press/release tests pass, along with the existing seventeen
keyboard/controller tests. The focused Chrome runner is
`scripts/start_shortcut_check.mjs`. All ten integration groups pass in
`build/start-shortcut-check/2026-11-19T02-22-41-402Z-49572/evidence.json`:

- Actual CDP Return/custom keyboard input, repeats, normal in-game Start, and
  Space remapped as Start without the host Space toggle stealing it.
- Injected standard B9 and custom raw B11 profiles, selected-source exclusion,
  menu/dialog/editor guards, held inputs, connection and focus transitions.
- A real second browser target hides the player; returning requires release
  and another press. Foreground-focus emulation is recorded in the evidence.
- Controlled delayed audio completion and a delayed actual worker resume
  response verify cancellation. The worker-response race uses an injected
  blur event; both host and worker remain paused after the stale reply.

No JavaScript or console errors were observed; tested implementation/Wasm
hashes match. Help text was then updated to document the shortcut. The final
broader regression passes in
`build/browser-check/2026-11-19T02-24-10-881Z-51087/evidence.json`: native
600-frame framebuffer equality, SRAM import/export/reload and original-byte
restoration, real AudioContext/AudioWorklet processing, and pause/resume pacing.
Source hashes match and no unsafe-WebGPU flag is needed. An earlier isolated
attempt failed before main execution with connection resets fetching modules;
its diagnostics remain in
`build/browser-check/2026-11-19T02-22-56-526Z-49919/evidence.json`. The cause was
not established and the subsequent run passed without an application workaround.

Physical controller operation and Safari were not retested for this feature.
The private Wasm, user launcher, and supplied controller profile are unchanged.

## Playback menu states and paused-screen overlay

The primary DKM command now switches between Start Game, Pause Game, and
Resume Game in desktop and compact menus. The worker owns an explicit
`hasStarted` state: a successful resume sets it before frame one, diagnostic
advancement sets it, and a new successful initialization resets it. Invalid ROM
validation before replacing the current instance preserves the existing state.

An informational overlay inside `.screen-wrap` shows Ready to Start for a
fresh loaded game or Paused after starting, plus the active input and saved
Start binding. It is absent while unloaded/loading/running, remains in
fullscreen, does not modify framebuffer pixels, and lets pointer events reach
the canvas. Keyboard hints use committed bindings; controller hints filter
unavailable mappings and offer Space when no usable Start is available. Menu,
dialog, and focus prerequisites are stated. Fatal errors disable playback and
show browser-page recovery guidance, including Escape before leaving fullscreen.
The overlay represents browser host pause rather than DKC's internal pause.

Seven new pure presentation tests pass alongside the existing twenty-two input
tests (29 total). They cover first-start versus frame-zero pause, saved mappings,
controller availability, contextual prerequisites, and busy/error presentation.

Six focused Chrome integration groups pass in
`build/pause-overlay-check/2026-11-19T02-50-34-723Z-52777/evidence.json`:
unloaded/loading/fresh-ready states, an immediate frame-zero start/pause,
rejected ROM validation preserving started state, Config before first start,
desktop/compact DKM transitions, reload reset, committed key remaps and Space
fallback, standard B9/custom raw B11 input, disconnected/unmapped controllers,
menu/dialog/focus guidance, and controlled worker-error presentation/recovery.
The error fixture is a message injection, not an induced watchdog fault.
There were no unexpected console, JavaScript, or network errors.

Four paused layouts (1440×900 light, 390×844 light, 844×390 dark, 320×568 dark)
and three screen-only fullscreen layouts (1440×900, 390×844, 844×390) fit without
clipping. Screenshots were inspected. Overlay pointer events reach the canvas,
there are no game-area buttons, and the single navigation element is preserved.
The browser framebuffer at frame 600 still exactly matches the native oracle.

Earlier isolated attempts failed before app execution with module socket
errors. The local server was changed from HTTP/1.0 to HTTP/1.1 persistent
connections; a direct check reused one connection for five resources and
verified four source/hidden/ROM/traversal exclusions remain 404. Six subsequent
cache-disabled browser reloads pass with zero network/JavaScript/console errors
in `build/pause-overlay-check/2026-11-19T02-51-47-245Z-52842/evidence.json`.
The evidence pins `scripts/serve.py` as well as served browser sources. This
verifies those six reloads; it is not a guarantee about all browser networking.

Help was updated after the focused runs. Safari and the physical controller
were not retested. The private Wasm, user launcher, and supplied controller
profile remain unchanged.

The broader regression initially still saw a pre-execution module socket
failure with HTTP/1.1 alone in
`build/browser-check/2026-11-19T02-53-05-052Z-52892/evidence.json`.
The server's pending accept queue was then raised from Python's default 5 to
64 for parallel browser connections. The final broader regression passes in
`build/browser-check/2026-11-19T02-54-06-692Z-52989/evidence.json`: native
600-frame oracle, SRAM import/export/page reload/restoration, real stereo
AudioWorklet processing (1.8 seconds, zero observed underruns/overruns), and
pause/resume pacing. All source/Wasm hashes match, no unsafe-WebGPU flag was
needed, and no JavaScript or console errors were observed. This run includes
the updated Help text and the final server configuration.

Six further cache-disabled reloads also pass with the final HTTP/1.1/64-accept
configuration in
`build/pause-overlay-check/2026-11-19T02-54-44-668Z-53041/evidence.json`.
The user's unchanged `web/start-app.command` invokes Python's default server,
so these server changes apply to the documented `scripts/serve.py` launch
path. That separate launcher path was not retested for startup reliability.

## Favicon

A gold transparent favicon was generated from the existing DK coin and
exported with native image tools to PNG64 and ICO16/32/48. Both sizes and all
ICO PNG payload entries were checked, and the small artwork was inspected.
Chrome fetched `/favicon.ico` with HTTP 200 in the passing WebGPU smoke run
`build/browser-check/2026-11-19T03-28-59-192Z-53948/evidence.json`, with no
JavaScript/console errors and no unsafe-WebGPU flag. The menu/About PNG was
preserved. No game regression was rerun for this document-head/asset change.

## Initial private repository baseline

The private standalone repository is `pipebrain/DKC1RecompWeb`, with the
browser snapshot committed directly above pinned upstream `3eb9a10`. Its
74-commit ancestry, original MIT license/notices, native source tree, and
`snesrecomp` gitlink are preserved. The browser and upstream ignore rules are
combined. The original upstream README is retained as `README.upstream.md`.
The root project's `origin` points to the private repository and `upstream`
points to `elliotttate/DKC1Recomp`; the tested build still uses `.local/upstream`.

Before the initial push, independent audits checked the browser allowlist
and final index: no ROM/save/Wasm/generated-game paths or detected credentials
were included. The 454-entry index retains upstream license/notices exactly.
All 29 pure input/presentation tests pass. After naming the repository and
adding its About link, Chrome's WebGPU smoke check passes without an unsafe
flag or JavaScript/console errors in
`build/browser-check/2026-11-19T04-56-30-969Z-55878/evidence.json`.
This packaging/link change did not rerun the full game regression; the earlier
recorded frame/save/audio evidence remains applicable to unchanged game code.

## Pages package and project-subpath testing

The Pages package is an explicit 35-file allowlist: runtime files, the known
Wasm, manifest, `.nojekyll`, and exact pinned runtime/compiler licenses. The
existing ignored ROM/SRAM in `web/` are excluded, as are the launcher/profile
JSON and all generated C/local tools. Twenty-one packaging fixtures covered
missing/hash-invalid Wasm, symlinks, output traversal, resource references,
license availability, deterministic replacement, and preservation of unrelated
or altered output. Twenty archive fixtures covered deterministic gzip/tar,
approved SHA-256, strict member names, links/duplicates/traversal, extra ROM
files, size limits, and preservation of differing outputs.

`scripts/browser_check.mjs --url ... --manifest ...` now verifies deployed
asset bytes/SHA-256 before and after browser execution. The final local Pages
simulation serves only `build/pages` under `/DKC1RecompWeb/`:
`build/browser-check/2026-11-19T11-23-29-466Z-60479/evidence.json`.
All 35 assets match, the 600-frame native oracle matches, and real audio,
SRAM import/export/reload/restoration and pause/resume pass. A mocked lack of
the Fullscreen API disables its command/shortcut without an app error. That
fixture is not a physical iPhone test. The final source explicitly focuses
the canvas on a pointer tap for mobile controller/keyboard input.

`build/pages-final-check/server-evidence.json` records 125 HTTP GET requests,
all 200, with no ROM/save paths or uploads. Additional checks cover default
local mode, remote mode without local build assets, unsafe manifests, and
tampered remote assets in `build/pages-url-cases/20261119T111243Z/evidence.json`.
The existing 29 pure input/presentation tests pass. The compiled Wasm remains
unchanged at `dcc015d75e943aac3eb179309426b0caa90321f88731effe85e8922b3de3a014`.

The current account's private-repository Pages enablement was rejected by
GitHub with HTTP 422 (plan ineligible). The user then explicitly chose a
separate public Pages repository while keeping the source private.

## Live GitHub Pages deployment

The live URL is https://pipebrain.github.io/DKC1RecompWeb-Pages/.
GitHub's Pages API confirms workflow publishing, public site visibility, and
HTTPS enforcement. The source repository remains private. The deployment
repository has one independent commit (`5579ae9`), six tooling files, no
private ancestry/game inputs/binaries in Git, and a GitHub no-reply author.

Preview release `pages-v1-ac77be235c22` supplies only the approved static
archive. Its SHA-256 is
`ac77be235c22f3d55945287c37a4560779d6be09740d8c283f29bce79d934e0b`.
The manual workflow completed successfully at
https://github.com/pipebrain/DKC1RecompWeb-Pages/actions/runs/44516231581.

The actual HTTPS site passes
`build/browser-check/2026-11-19T11-37-14-699Z-61013/evidence.json`:
all 35 file identities and manifest match before/after, the native 600-frame
oracle matches, SRAM transport/reload/restoration and actual AudioWorklet
processing pass, and pause/resume pacing holds. Unsupported fullscreen is
checked using a capability mock; native capabilities are restored afterward.
No unsafe-WebGPU flag was needed. That automated run did not operate mobile
hardware; the later user acceptance is recorded below.

## User-reported mobile acceptance — 2026-11-22

The user reported: "Mobile test site passes all checks."
The mobile test-site functional baseline is recorded as user-accepted. This
updates the previously outstanding mobile acceptance milestone; it is separate
from the agent-operated desktop Chrome and capability-fixture checks above.

Device models, Android/iOS coverage, OS/browser versions, input methods,
test duration, and individual case results were not supplied. The report does
not establish a specific platform support matrix, full-game playthrough,
long-duration run, or agent-operated mobile hardware test.

## Phase 2 cartridge storage and Candy’s Save Point

The fixture starts from a read-only copy of the local 2,048-byte cartridge
save, with slot 1 at 00:12 / 09%. The stock v0.0.17 native reference starts
at frame zero on each leg. The controller inputs select the slot, visit
Coral Capers, return to Candy’s Save Point and jump into the barrel. The game
writes the new slot during the following neutral inputs. The native cold boot
uses those new SRAM bytes and selects the slot through the game’s file screen.

| Checkpoint | Frame | Visible result |
| --- | ---: | --- |
| Initial file selection | 5,526 | Slot 1, 00:12 / 09% |
| Initial world map | 7,332 | Candy’s Save Point |
| Coral Capers | 12,665 | Level entered |
| Return to Candy | 15,350 | World map, original SRAM |
| Candy’s Game Save | 15,828 | Slot 1, 00:14 / 09% |
| File selection after restarting | 5,526 | Slot 1, 00:14 / 09% |
| Loaded game after restarting | 7,332 | Candy’s Save Point, map entrance 0x00FA |

Three independent native runs of each leg matched all seven memory, video and audio
fingerprints. The new SRAM first appears at frame 15,699.

Chrome 158.0.8127.36 on Apple Metal 3 reproduced all seven visual checkpoints
using controller input replay. Between the two legs it exited cleanly and
launched with a different process ID, the same profile and the same URL.
The second process opened zero file pickers, restored the saved SRAM before
frame one, and matched all seven native memory, graphics and cumulative audio
fingerprints on a replay of the continued slot. Both sessions requested only
the application’s files over HTTP GET. The ROM and starter came through the
local pickers. Three independent runs of the final browser harness passed.
Their reports and screenshots are in these subdirectories of `build/browser-check/`.

- `2026-11-22T10-36-38-669Z-27916/`
- `2026-11-22T10-36-52-765Z-27964/`
- `2026-11-22T10-36-52-766Z-27965/`

The starter SHA-256 is
`1e5bd0511a7dceb6e0ab6bc38a4618accdc381cc4312c9892d06ea59aaf2c497`.
The saved cartridge SHA-256 is
`2d61079badca173c26d21e81b32ac72c5cb800bcd4c49985e67cda2de87d7a7b`.
The route uses the existing local save to reach Candy. It uses ordinary
controller masks from there, with no memory edits, loaded snapshots, or writes
to the source ROM or save.

To repeat with the same private starter, choose a fresh output directory under
`build/` and run the following from the project root. Generated evidence stays
under the ignored build tree.

```sh
rom='Donkey Kong Country (U) (V1.0) [!].smc'
out="build/candy-$(date +%Y%m%d-%H%M%S)"
python3 scripts/candy_reference.py --rom "$rom" --starter-sram 'web/Donkey Kong Country.srm' --out "$out"
.local/tools/node-v22.16.0-darwin-arm64/bin/node scripts/browser_check.mjs --rom "$rom" --candy-reference "$out/oracle.json"
.local/tools/node-v22.16.0-darwin-arm64/bin/node scripts/ui_check.mjs --rom "$rom" --rom-storage
```

The separate ROM settings test exercises desktop and compact Paths, picker
cancellation, opt-out across visits, removal with SRAM preserved, wrong-digest
replacements, corrupt cached bytes and a denied ROM database.
A Chrome fault-injection run also exercised SRAM read/write denial, a damaged
legacy save, conflicting tabs, live export, and failed Wasm initialization.
Reports are under `build/rom-storage-check/2026-11-22T10-34-30-493Z-27295/`
and `build/browser-check/2026-11-22T10-33-24-985Z-27166/`.

## Limits

No full playthrough, completed-level gate, agent-operated physical controller
test, long-duration timing/audio run, device-specific support matrix,
or induced game-watchdog failure test is
recorded. The user reported Safari/Chrome functional acceptance before the
interface overhaul; browser
versions were not supplied. Agent controller checks use injected inputs.
The user accepted the mobile test-site baseline on 2026-11-22; its device and
browser details remain unrecorded. This acceptance does not replace the more
specific coverage evidence listed above.
