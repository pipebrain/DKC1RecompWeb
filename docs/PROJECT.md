# DKC1RecompWeb / DKC and DKL browser project

Updated: 2026-11-22 (America/Toronto).

## Goal and scope

Phase 1 brings SNES Donkey Kong Country to the browser by porting
[elliotttate/DKC1Recomp](https://github.com/elliotttate/DKC1Recomp) to
WebAssembly with direct WebGPU presentation. Check existing browser derivatives
before implementing a new port.

The longer-term goal is to add the original Game Boy Donkey Kong Land levels
as another campaign, retaining SNES Country as the behavioral foundation.
Land extraction and level integration are outside Phase 1.
The user added GitHub Pages hosting for Android/iOS testing to version 1.

## Confirmed decisions

- Use WebAssembly and WebGPU.
- Only `.screen-wrap` is made fullscreen, with centered 4:3 output fitted to
  the whole viewport. Phase 2 offered optional native widescreen and square-pixel presentations. The clean v1.1.0 build uses the original 256×224 framebuffer and 4:3 presentation.
- Follow Apple's Human Interface Guidelines for the application shell. Wide
  viewports use an emulated application menu bar; narrow and short landscape
  viewports use compact iOS-style navigation. Config collects controller
  profiles and game saves; Misc > Help opens keyboard help separately.
  See [the design brief](UI_DESIGN.md).
- The user's revised composition requires one navigation element and the game
  screen, in both wide and narrow modes. All commands belong in menus.
  `.menubar-caption`, `.app-navigation`, `.toolbar`, `.app-status`, and the
  empty-state text/buttons are removed from the design, not hidden. Status
  information lives inside menus; Settings and About open through menus. The
  user's later request explicitly permits an informational paused-game overlay
  on the screen showing the active input and how to start/resume. It has no
  controls and remains inside screen-only fullscreen.
- The user then selected ZSNES-inspired command grouping: a static monochrome
  DK coin, DKM (Load ROM; separator; Start Game, Reload Game; separator;
  Load Save, Export Save), Config (Input,
  Devices, Options, Video, Sound, Paths, Saves, Speed), Cheat, NetPlay, and
  Misc (Help, About). Config/Input retains controller profiles. Config → Paths
  controls the remembered ROM on this device. Cheat and NetPlay remain
  visible but disabled, as confirmed by the user. Input, Devices, and Options
  are separate Config menu commands that select three tabs within one shared
  Input settings page.
- The primary DKM command reads Start Game before first launch, Pause Game
  while running, and Resume Game after pausing. It toggles host playback and
  is disabled while unloaded, loading, transitioning, or after fatal errors.
  Reload Game uses the existing reset behavior and preserves SRAM/profiles.
  Config has no eyebrow or Help tab; Misc > Help opens a separate modal with
  keyboard controls.
- About uses the existing monochrome DK coin and loads `web/About.md`.
  Help loads `web/Help.md`; missing/empty content leaves Help disabled. These
  files adapt upstream's description/credits and document this browser port.
  Upstream repository links are included. Our private repository is
  [pipebrain/DKC1RecompWeb](https://github.com/pipebrain/DKC1RecompWeb), now
  linked in About.
- The browser favicon uses a warm gold DK coin variant, with a transparent
  64-pixel PNG and a multi-size ICO (16/32/48 pixels). Menu/About artwork
  remains monochrome.
- A fresh browser profile uses Keyboard by default, shown in the Config Input
  menu. Physical-key bindings are editable and saved locally. Selecting
  Gamepad explicitly activates controller mappings instead; keyboard and
  gamepad input are not combined. The user's saved input-source choice is
  restored on later visits. Keyboard storage is separate from gamepad
  profiles and cartridge SRAM.
- The selected input's mapped Start quick starts/resumes while the foreground
  game screen has focus. Consume that press through release; subsequent Start
  presses during play go to DKC normally. Menus, dialogs, capture, dirty drafts,
  loading, and errors block quick resume. Held controllers require release
  after connection/focus/source changes. Cancel asynchronous resumes when
  pausing or leaving the game, including audio waits and posted worker commands.
- Start with desktop Chrome on the user's Mac; expand compatibility after a
  working baseline.
- Version 1 includes an HTTPS GitHub Pages test site. On 2026-11-22 the user
  reported that the mobile test site passes all checks; its baseline is
  user-accepted. Device/platform details were not supplied. The user chose a
  separate public deployment
  repository, [DKC1RecompWeb-Pages](https://github.com/pipebrain/DKC1RecompWeb-Pages),
  while this source repository stays private. The test site is
  https://pipebrain.github.io/DKC1RecompWeb-Pages/. It publicly serves the
  approved browser/Wasm package, with no ROM or saves. See [Pages](PAGES.md).
- The browser application must be dependency-free: handwritten HTML, CSS,
  JavaScript, WGSL, and standard browser APIs. No frontend framework, runtime
  JavaScript package, graphics wrapper, or generated JavaScript runtime is approved.
- Compiler and build tools are allowed, as explicitly clarified by the user
  on 2026-11-18. Emscripten's generated JavaScript runtime is excluded unless
  the user explicitly permits it.
- DKC1Recomp and its existing snesrecomp core are the source foundation. The
  user explicitly approved compiler-provided C support statically linked into
  Wasm, with a small inventoried set of handwritten host imports. Other added
  runtime libraries still require a decision. See [the decision](RUNTIME_DECISION.md).
- Ask the user about material uncertainties and proposed exceptions.
- The user supplied the project-root ROM; its exact size and hash were verified.

## Verified upstream references

Phase 2 uses DKC1Recomp v0.0.17 at `559bab62596a97e91f389b39cdeb6cda981ab7c9`
and snesrecomp at `75223f35b16e4c904cea78453b9cd1fcefbcd7f2`. The native
source tree, root submodule pin and isolated build checkout agree.
[Source and tool lock](../upstream.lock.json) · [Upstream release](https://github.com/elliotttate/DKC1Recomp/releases/tag/v0.0.17)

The tagged v1.0.0 browser baseline used these revisions on 2026-11-18.

| Component | Revision | Evidence |
| --- | --- | --- |
| DKC1Recomp default branch | `3eb9a10c49cb210df2bd63addafe2a78cf9f4e22` | [Commit](https://github.com/elliotttate/DKC1Recomp/commit/3eb9a10c49cb210df2bd63addafe2a78cf9f4e22) |
| Its snesrecomp submodule | `de94587464524ebac8dcd62e14618bf0d3953644` | [Pinned submodule](https://github.com/elliotttate/DKC1Recomp/tree/3eb9a10c49cb210df2bd63addafe2a78cf9f4e22/snesrecomp) |

The [upstream README at this revision](https://github.com/elliotttate/DKC1Recomp/blob/3eb9a10c49cb210df2bd63addafe2a78cf9f4e22/README.md)
specifies this input:

| Property | Required value |
| --- | --- |
| Game | Donkey Kong Country, SNES, USA v1.0 |
| Format | Headerless ROM |
| Size | 4,194,304 bytes |
| SHA-256 | `fa8cacf5bbfc39ee6bbaa557adf89133d60d42f6cf9e1db30d5a36a469f74d15` |

Upstream generates private C game sources from the ROM. No user-prepared asset
extraction or generated source is required. Generated game code and binaries
must remain outside Git, along with the ROM and extracted assets.

## Initial source audit

These are inspected source facts, not compiled or tested port behavior:

- The [iOS CMake host](https://github.com/elliotttate/DKC1Recomp/blob/3eb9a10c49cb210df2bd63addafe2a78cf9f4e22/cmake/ios.cmake)
  replaces the desktop host and removes launcher sources while retaining the
  C engine. This provides a useful host separation example.
- The pinned runtime's [frame wrapper](https://github.com/elliotttate/snesrecomp/blob/de94587464524ebac8dcd62e14618bf0d3953644/runner/src/common_rtl.c#L488)
  uses `setjmp`; its [watchdog](https://github.com/elliotttate/snesrecomp/blob/de94587464524ebac8dcd62e14618bf0d3953644/runner/src/common_cpu_infra.c#L649)
  can call `longjmp`. A standalone Wasm port must preserve this failure handling
  or establish an equivalent; removing the watchdog is not an acceptable shortcut.
- C allocation occurs in [normal SNES initialization](https://github.com/elliotttate/snesrecomp/blob/de94587464524ebac8dcd62e14618bf0d3953644/runner/src/snes/snes.c#L39).
  The runtime also has memory, environment, time, diagnostics, and filesystem
  calls. Determine which are reachable in the minimal browser build and how
  to provide them within the dependency constraint.
- The [top-level build](https://github.com/elliotttate/DKC1Recomp/blob/3eb9a10c49cb210df2bd63addafe2a78cf9f4e22/CMakeLists.txt#L65)
  requires private generated game C. A ROM-free compiler or browser probe
  would not verify a game build.

## Browser derivative audit

The earlier conversation's audit was refreshed. No browser port was identified
across all 22 public direct-fork default trees returned by GitHub, three extra
branches, recent-fork README/CMake checks, and supplementary searches. This is
a bounded source-discovery finding, not proof that none exists. See the
[audit and pinned heads](BROWSER_PORT_AUDIT.md).

## Implemented architecture

- The existing CPU renderer produces stock 256x224 BGRA frames; direct WebGPU
  texture uploads and WGSL present them with a 4:3 display aspect.
- A dedicated worker owns one standalone Wasm instance and uses fixed
  60.098811862 Hz game stepping, matching the pinned native headless reference.
  Display refresh does not advance the game. Hidden/blurred tabs pause.
- Game step, PPU drawing, and PCM consumption preserve the native order.
  Audio is stereo signed 16-bit at 32,040 Hz, resampled by an AudioWorklet.
  Sound defaults to on each time the player opens. Starting the game activates
  audio, and Config → Sound can mute or unmute it for the current session.
- Keyboard input and configurable Gamepad API profiles support standard
  layouts and raw button/axis/hat bindings. The standard mapping remains the
  built-in default. Custom profiles use separate local storage and JSON
  import/export; the configuration panel pauses gameplay and shows live input.
- The keyboard editor uses a separate versioned localStorage entry,
  `dkc.keyboard-settings.v1`, with committed mappings, draft Save/Discard,
  Restore defaults, conflict detection, and key capture. Modifier shortcuts,
  Tab, and Escape remain reserved for host/navigation controls. Space and
  either Shift key can be game inputs. Space pauses/resumes by default, but a
  saved Space binding takes priority during play. Held physical keys are tracked
  independently so releasing one alternative does not release another.
- A small handwritten Markdown reader fetches About/Help from the served web
  directory. It creates DOM text and validated HTTP(S) links without raw HTML
  execution or a third-party parser. Content availability drives menu state.
- Keyboard and controller Start share a small handwritten press/release gate.
  The host respects committed mappings and the selected source, consumes the
  resume press, and prevents held/repeating inputs from restarting the host.
  Resume requests are coalesced and canceled on pause/menu/focus transitions;
  stale worker acknowledgements cannot restore an invalidated running state.
- An explicit worker `hasStarted` field tracks the first successful resume even
  before a frame advances and resets for new loads/reloads. DKM and Speed use
  it for Start/Pause/Resume labels. An informational DOM overlay displays host
  pause and saved input bindings without changing the retained framebuffer.
  Focus/menu/dialog prerequisites, disconnected/unmapped controller fallbacks,
  and fatal-error recovery guidance update with the current host state.
- IndexedDB SRAM persistence and explicit 2,048-byte cartridge save import/
  export remain separate from controller profiles.
- A responsive handwritten application shell provides DKM/Config/Misc
  menus and a compact menu inside the same single navigation element. There
  is no title header, playback toolbar, status footer, or empty-state content.
  Menu commands call game host actions directly. Unsaved controller
  drafts guard Settings dismissal and section changes; modal settings pause
  gameplay and release input.
- Reload Game retains the verified ROM in memory, snapshots live cartridge
  SRAM, creates a fresh Wasm instance, restores SRAM, clears the retained GPU
  frame, and returns to frame zero paused. Controller profiles are unchanged.
  Config sections expose existing browser features; rewind, fast-forward,
  save states, cheats, and networking have not been added.
- Pooled transferable frame/audio buffers avoid a shared-memory requirement.
- A handwritten loader inventories actual Wasm imports and rejects unknown
  symbols. No generated JavaScript loader, SDL, browser framework, graphics
  wrapper, or third-party WASI adapter is used.

The earlier generated-loader proposal is superseded. Compiled C support was
separately approved and tested; its actual archives/imports are recorded in
[the runtime decision](RUNTIME_DECISION.md). Full save states and GPU generation
of SNES pixels are not implemented.

## Version 1 implementation and verification

- The ROM is verified; 2,176 private C units were generated using upstream's
  supported Python analyzer. Pinned upstream tracked sources remain unchanged.
- The native headless reference, native browser-adapter check, and standalone
  browser Wasm build pass. The private Wasm is 8,021,037 bytes, SHA-256
  `dcc015d75e943aac3eb179309426b0caa90321f88731effe85e8922b3de3a014`.
- A C allocation/setjmp/longjmp Wasm probe passed 20 repetitions with no imports.
- Three native clean-boot runs and three native adapter runs match all seven
  frame/memory/audio fingerprints at 600 frames. Native title reference at
  5,100 frames also matches across three runs.
- Actual Chrome 157 browser runs match the native framebuffer at 600 and
  5,100 frames (title screen), and after the exact 8,070-frame Jungle route.
  A live 7,450-frame Jungle entry/movement prefix also matches exactly; its
  fixed controller schedule is in `tests/fixtures/jungle-entry.inputs`.
  Each browser run also passed SRAM import/export/reload persistence and
  pause/resume checks. The AudioContext/AudioWorklet ran for 1.8 seconds with
  zero observed underruns/overruns; no listening-quality claim is made.
- Standard headless Chrome flags obtained the native Apple Metal 3 WebGPU
  adapter; no unsafe-WebGPU flag was required. Screenshots were inspected.
- The user initially reported Safari and Chrome passing sound on/off, keyboard
  input, and pause/resume. After controller profile work, the user reported
  "Everything tests OK" and requested the interface overhaul. The reported
  single-axis D-pad issue was a configuration mistake, withdrawn by the user.
  This accepts the previous functional baseline; no full-game playthrough or
  agent-operated physical controller capture is implied.
- Controller profiles pass nine pure mapping/JSON tests and actual Chrome
  integration with representative raw/standard input fixtures. Custom masks
  reach the worker; editing pauses/releases input, profile persistence and file
  round trips pass, and cartridge SRAM remains separate. A subsequent native
  frame/audio/save regression and all six fullscreen configurations also pass.
- Fullscreen targets only `.screen-wrap`; application navigation stays outside
  fullscreen. The canvas fills the viewport and WebGPU
  centers its 4:3 output without clipping. Resize redraws the retained frame
  without advancing a paused game; keyboard focus returns to the canvas on
  entry and Escape exit. All six Chrome size/DPR configurations pass the
  screen-only fullscreen check. The latest layout still needs a visible
  Safari retest.
- The Apple-style GUI overhaul passes actual Chrome checks for desktop menus,
  keyboard navigation, compact menu navigation, modal Settings focus and dirty
  profile guards, six viewport/theme/DPR configurations, and screen-only
  fullscreen. Screenshots were visually inspected. The existing 600-frame
  native oracle, save/audio/pause regression, controller profile integration,
  and all six fullscreen configurations also pass after integration. The
  browser host remains dependency-free; the private Wasm, user launcher, and
  supplied controller profile are unchanged. See [validation](VALIDATION.md).
- The subsequent menu-only revision removes the rejected interface regions
  from both HTML and CSS. Actual Chrome checks confirm one main navigation
  element, no main controls/text outside it, all eleven commands in desktop
  and compact menus, visible keyboard focus in scrolling menus, Settings
  guards, native file choosers, and errors inside menus. All six responsive
  layouts and the existing native-frame/save/audio/controller/fullscreen
  regressions pass. Desktop/compact screenshots were inspected; the private
  game binary and user's launcher/profile files are unchanged.
- The requested ZSNES-inspired structure is implemented with a static,
  generated monochrome DK coin; DKM, Config, Cheat, NetPlay, and Misc groups;
  and corresponding compact-menu sections. Reload Game uses the selected ROM
  in memory, starts a fresh paused Wasm instance, and preserves SRAM and
  controller profiles. Config exposes the existing Input, Devices, Options,
  Video, Sound, Saves, and Speed capabilities. In v1, Paths, Cheat, and NetPlay remained
  visibly disabled. No upstream enhancement or multiplayer port is implied.
- The confirmed Input/Devices/Options grouping now uses three horizontal tabs
  in one Input settings page. Separate Config commands select the matching
  tab; the sidebar shows Input once. Focused Chrome checks pass at four
  desktop/compact sizes, including keyboard navigation, disabled entries,
  paused gameplay, and unsaved-profile guards. Screenshots were inspected.
- The latest DKM order/separators, Start Game, Reload Game, and Config cleanup
  pass focused desktop/compact Chrome checks. Start advances without resetting;
  Reload preserves SRAM/profiles and repeats the native framebuffer oracle.
  Config has no eyebrow or Help tab; standalone Misc Help and profile guards
  pass. Source hashes matched and screenshots were inspected.
- About now uses the DK coin and editable `web/About.md`, with upstream
  repository/provenance links. Help renders `web/Help.md`; missing, empty, or
  HTML-fallback responses disable all Help commands. Our private
  DKC1RecompWeb repository is also linked from About.
- The new editable keyboard source passes eight pure validation/mapping
  tests and Chrome input/content integration. Actual key events reach the
  worker with the committed mapping; input-source choice and key edits persist
  independently of controller profiles and SRAM. Source exclusivity, both
  Shift alternatives, custom Space, conflict/reserved-key rejection, dirty
  guards, malformed-storage repair, Markdown safety, and unavailable Help are
  verified. The existing controller integration also passes after choosing
  Gamepad. Final desktop/compact visuals were inspected.
- The final browser regression after keyboard/content integration matches the
  600-frame native oracle and passes SRAM reload/restoration, real audio, and
  pause/resume checks. Its isolated Chrome target uses recorded foreground-
  focus emulation; source/Wasm hashes match, and no unsafe-WebGPU flag is used.
- Mapped Start quick start/resume passes five new press/release tests (22
  total input tests) and ten focused actual Chrome integration groups. Real
  keyboard events and injected standard/raw controllers verify consumption,
  normal in-game Start, remapping including Space, source/menu/editor guards,
  held-input recovery, and asynchronous worker/audio cancellation. The final
  native 600-frame oracle, SRAM persistence/restoration, real audio, and
  pause/resume regression also pass. The user's physical controller and Safari
  have not been retested for this shortcut. See [validation](VALIDATION.md).
- Dynamic Start/Pause/Resume DKM labels and the requested paused-screen overlay
  pass 29 pure input/presentation tests and six actual Chrome integration
  groups, including frame-zero pause, failed ROM validation, custom keyboard
  and raw/standard controller hints, menu/dialog/focus guards, reload state,
  and controlled error recovery. Four responsive and three fullscreen layouts
  fit and were visually inspected. The native 600-frame oracle still matches.
  The local server now uses HTTP/1.1 persistent connections after intermittent
  module-fetch startup failures; its pending accept queue accommodates 64
  parallel connection attempts. Six cache-disabled reloads and the final
  native-frame/SRAM/audio/pause regression pass. Source/Wasm identities and
  the exact tested server configurations are recorded in validation.
  The user launcher remains unchanged and uses Python's default server;
  startup reliability through that separate launch path was not retested.
- [README.md](../README.md) has local build/run commands. The server serves
  only `web/` on localhost; project/ROM/traversal requests were checked as 404.
- The user authorized private repository creation and selected a standalone
  private repository with upstream history because GitHub does not allow
  private forks of public repositories. The repository is
  [pipebrain/DKC1RecompWeb](https://github.com/pipebrain/DKC1RecompWeb).
  The browser commit descends directly from pinned DKC1Recomp `3eb9a10`;
  ROMs, generated game code/binaries, saves, and evidence remain excluded.
  Upstream licenses, notices, source, submodule pin, and Git history are
  retained. Pages hosting was subsequently added to version 1 through a
  separate public deployment repository; this source/history stays private.
- The gold favicon is linked from the document head. ICO image entries/sizes
  were verified, and actual Chrome fetched `/favicon.ico` with HTTP 200 during
  a passing WebGPU smoke check. The original `dk-coin.png` is unchanged.
- Pages preparation now uses a strict 35-file package: browser runtime,
  unchanged verified Wasm, checksum manifest, and full pinned notices. ROMs,
  saves, generated C, user launcher/profile exports, and local tools are not
  packaged. The manually dispatched workflow uses an approved release archive
  and keeps compiled game binaries out of Git. HTTPS/project-subpath checks
  match all asset identities and the native 600-frame oracle, and pass audio,
  SRAM reload/restoration, pause/resume, and unavailable-fullscreen fixtures.
  The canvas explicitly takes focus on a pointer tap. The live HTTPS Pages
  site passes the same asset/native-frame/save/audio/pause checks. The public
  deployment repository contains six tooling files with no private ancestry;
  its commits use a GitHub no-reply identity. On 2026-11-22 the user reported:
  "Mobile test site passes all checks." The mobile test-site baseline is
  user-accepted. Device models, OS/browser versions, input methods, duration,
  and individual case results were not supplied; no agent-operated mobile
  hardware test is implied.

Detailed evidence and limits: [VALIDATION.md](VALIDATION.md).

## Phase 2 stock core

The v0.0.17 release-native host, native browser adapter and production Wasm
worker agree on all seven framebuffer, memory and cumulative audio fingerprints
at 600-frame boot, 5,100-frame title, and the 8,070-frame Jungle route.
The 7,450-frame checkpoint also verifies visible Jungle gameplay. Chrome's
WebGPU output matched native at every source pixel center on all four frames.
The standalone core accepts the v1 SRAM and controller profile. See the
[route hashes and verification procedure](VALIDATION.md#phase-2-stock-v0017).

For manual Mac testing, the root [Play.command](../Play.command) launches the
built player through the project's loopback server. It opens Chrome at the
original Mac launcher's `http://localhost:8000/` origin. A Chrome run against
that launcher URL matched the release-native 600-frame boot on all seven
fingerprints and passed the audio, SRAM and pause/resume checks. The user
also reported that the Phase 2 local launcher test passed.

## Phase 2 remembered ROM and cartridge saves

DKM → Load ROM keeps the verified bytes in this origin’s IndexedDB by default.
On the next visit the player verifies them again and restores the existing
2,048-byte cartridge save before the first game frame. The game opens at Ready to Start.
Turning off Config → Paths → Remember ROM on this device removes the local ROM
and keeps SRAM and profiles. The picker also works when ROM storage is denied.

The save database retains its v1 key and format. The worker detects changes
after each successful frame. The host waits for existing writes before replacing
the cartridge and offers Export Save if a write fails. Normal writes check the
previously committed bytes so a stale tab cannot silently overwrite newer progress.

On Mac Chrome, slot 1 advanced from 00:12 / 09% to 00:14 / 09% at Candy’s
barrel. After a full Chrome quit, a fresh process reopened the ROM, showed
the updated slot in game and loaded Candy’s map. The 2,048 restored bytes and
the continued game’s video, memory and cumulative audio matched native.
The user also confirmed the remembered-ROM and Candy save milestone passed.
[Route and reproduction](VALIDATION.md#phase-2-cartridge-storage-and-candys-save-point)

Chrome verified that the first Return press and DKM → Start Game both start the
game and its audio output with sound enabled by default. When Chrome required
a gesture on a controller-only launch, clicking Start Game activated audio.
A test analyser measured game audio on first playback, silence while muted,
and game audio again after unmuting.

## Phase 2 player settings

The user expanded Phase 2 to include native-only player features. Config
gained local preference storage and versioned JSON import/export in
wide and compact layouts. The [Phase 2 settings inventory](https://github.com/pipebrain/DKC1RecompWeb/blob/41a969f4de1cc48a728873f77e22a86fdfdc465b/docs/SETTINGS.md) records
browser and native defaults, file boundaries and platform-specific facilities.
Stock 4:3, keyboard Player 1, original music, and sound on remain the defaults.

The archived Phase 2 branch includes two-player input, Assist and five state slots,
native widescreen and display settings, the Dixie build, a local MSU-1 music
pack reader, macOS HD preview materials and local diagnostics. Desktop Chrome retained the configuration and slot after a
complete quit and relaunch. The final stock build passed the 8,070-frame Jungle
comparison and the Candy save/continue route. The official HD pack matched the
native compositor at Jungle entry. The separate public site hosted this Phase 2
preview before the clean v1.1.0 deployment. V1 remains the last user-accepted
mobile baseline. [Deployment and device test steps](PAGES.md)
[Checks and current limits](VALIDATION.md#phase-2-player-settings)

## Remaining validation

- Full-game and long-duration timing/audio coverage.
- The mobile test-site baseline is user-accepted as of 2026-11-22. Detailed
  device/browser/input coverage remains unrecorded. Agent controller tests use
  injected fixtures; user acceptance is distinct from agent-operated hardware
  testing.
  See [CONTROLLERS.md](CONTROLLERS.md).
- Long-session sound/timing behavior. Visible keyboard, sound on/off, and
  pause/resume were accepted by the user in Safari and Chrome.
- The Candy save and cold-reopen route is verified on desktop Chrome.
  Phase 2 mobile storage and recovery still need device testing.
- Other browsers/OSes beyond the user's Safari/Chrome checks, lower-performance
  devices, and background recovery.
- Extended routes and an induced game-watchdog failure remain open beyond the
  four Phase 2 checkpoints recorded above.

## Next milestone

The private source tag [v1.0.0](https://github.com/pipebrain/DKC1RecompWeb/tree/v1.0.0)
marks the user-accepted browser/Pages baseline at `543fbe1`.

### Phase 3 · clean player

The approved scope for browser version **v1.1.0** uses the pinned stock DKC1Recomp
v0.0.17 core. The v1.0.0 player defines the experience. The private Phase 2
branch is preserved at [41a969f](https://github.com/pipebrain/DKC1RecompWeb/commit/41a969f4de1cc48a728873f77e22a86fdfdc465b).
The clean build starts from that commit on `codex/phase-3-clean-v1.1.0`.

1. Package one stock core, original graphics and soundtrack, original game
   timing, and a centered 4:3 image. Keep the v1 menus, fullscreen, pause
   overlay, mapped Start and raw controller profiles. Remove the Dixie, HD,
   MSU-1, widescreen, CRT, frame-generation, rewind and speed-modification
   features from the clean build and its settings. Retain replay and
   frame-stepping tools for development.
2. Expose every retained player setting through the wide and compact menus.
   Save preferences locally and support Config → Load Config / Save Config
   for portable JSON. Read existing v1 profiles and Phase 2 configs, carrying
   supported settings forward. Preserve remembered-ROM choice, stock SRAM
   and Candy save import/export. Keep stock save states in five separate
   slots and test loading a state created by the Phase 2 stock core.
3. Give each SNES port independent keyboard, gamepad, or combined input with
   assignable bindings. Preserve the original game's two-player rules. Test
   input from two devices at once, duplicate pad models, disconnection while
   holding a direction, reconnection, and the quick-resume button release.
4. Retain the Phase 2 port of upstream enemy-stomp rumble, its saved on/off
   preference, and the test pulse under Config → Devices. Verify a stomp and
   an ordinary jump on a physical controller. Input must also work on a
   controller whose browser exposes no rumble actuator.
5. Compare stock boot, title, Jungle and Candy against the recorded references.
   Verify both input ports in an actual two-player game, reload a save state
   after a browser restart, and check the retained settings on Android and iOS.

The clean candidate builds one stock Wasm and restores Phase 2 stock states.
Desktop Chrome reopened Candy's SRAM across a full quit and replayed a
two-player Contest handoff against native. Config import/export, combined
input on both ports and the simulated controller checks also passed.
The user reported every test they ran passed except rumble. On their Bluetooth
8BitDo SN30 Pro+ in Mac mode, Chrome completed the original 55 ms enemy-stomp
pulse, but the user felt nothing. Replaying the same enemy stomp with the
new Standard pulse (140 ms, 80% strong and 100% weak) produced vibration
the user could feel. Config → Devices retains the original pulse as Light.
The [public mobile preview](https://pipebrain.github.io/DKC1RecompWeb-Pages/)
now serves the clean build from private commit `d6adeae`, including the
rumble fix. The next check is physical Android and iOS gameplay, controller
reconnection, and stomp rumble on devices that expose it. [Deployment](PAGES.md)
[Clean candidate verification](VALIDATION.md#phase-3-clean-v110-candidate)

### Phase 4 · independent WebGPU renderer

Start with one Jungle scene. Keep collision, input, audio and enemy behavior
on the original simulation clock. Preserve the PPU work in
the game step that has hardware side effects. Capture the scene data needed
to draw the same frame, including tiles, sprite priority, palettes and
per-scanline changes. Render from that read-only data at the display's
resolution. The original renderer remains the comparison reference.

First reproduce the stock 256×224 frame pixel for pixel with the original
activation rules. Replay identical inputs and compare game memory, spawns,
SRAM and audio to the reference after each tick.

Then extend the view using authored level data. On each simulation tick,
use the visible world bounds to wake an ordinary enemy as soon as any part
of it enters the viewport, if it is still dormant. Run its original AI from
that tick. This intentionally lets a wider view change encounter timing.
At a fixed viewport, replay the same inputs at different display refresh
rates and verify the same activation tick and subsequent game state.
Include a camera pan and a save-state restore near the activation boundary.

Trap and ambush enemies are an open design decision. For each encounter,
record what the player can see, what cues the attack in the original game,
and what happens if it triggers at the viewport edge. Use that evidence to
decide separately when the trap becomes visible, wakes and attacks.
