# Project instructions

Read `docs/PROJECT.md` before working on this project. Keep its decisions,
verified status, unresolved questions, and next milestone current when work
changes them.

## Scope and requirements

- Phase 1 ports DKC1Recomp to the browser using WebAssembly and direct WebGPU.
- The first target is desktop Chrome on the user's Mac. Broader browser support
  follows a working baseline.
- The main interface contains exactly one `.app-menubar` navigation element
  and the game screen. All application commands are accessed through menus in
  both wide and compact layouts. Remove, rather than hide, `.menubar-caption`,
  `.app-navigation`, `.toolbar`, `.app-status`, and empty-state text/buttons.
  Settings/About content is shown only when opened through a menu command.
  Only `.screen-wrap` enters fullscreen; center the game at 4:3 and scale it
  to fit the complete viewport.
- Follow Apple's Human Interface Guidelines for the browser interface: an
  emulated application menu bar on wide viewports, compact iOS-style navigation
  on narrow/short viewports, and focused Settings sheets. See `docs/UI_DESIGN.md`.
- Use the user's ZSNES-inspired menu structure: a non-interactive monochrome
  DK coin, DKM, Config, Cheat, NetPlay, and Misc. Unimplemented commands remain
  visibly disabled; menu structure does not imply their implementation.
- Input, Devices, and Options are separate Config menu commands that select
  three tabs within one Input settings page. Keep their shared page distinct
  from the Video, Sound, Paths, Saves, and Speed settings pages.
- Keep `.sheet-eyebrow` and `#settings-tab-keyboard` out of `#app-settings`.
  Misc > Help opens its own dialog. DKM commands are Load ROM; separator;
  Start Game, Reload Game; separator; Load Save, Export Save.
- The playback command changes between Start Game, Pause Game, and Resume
  Game. Show an informational pause overlay inside the game screen, including
  fullscreen, with the active input and saved binding needed to resume.
  Keep the overlay noninteractive and all application controls in menus.
- About uses the monochrome `.dk-coin`. Its content comes from `web/About.md`;
  Help comes from `web/Help.md` and stays disabled when its content is missing
  or empty. Keep upstream credits/links accurate. Our repository link is
  https://github.com/pipebrain/DKC1RecompWeb (private).
- Keyboard is the default input source for a fresh browser profile. Expose
  saved, editable keyboard bindings under Config > Input and show the active
  source in menus. Preserve keyboard settings separately from controller
  profiles and SRAM; guard unsaved edits when switching source/page or closing.
- Keep the browser host dependency-free: handwritten HTML, CSS, JavaScript,
  WGSL, and standard browser APIs. Do not add frontend frameworks, npm runtime
  packages, graphics wrappers, Emscripten-generated JavaScript runtime glue, or
  a WASI browser adapter without the user's explicit agreement.
- Compiler and build tools are allowed. Pin the tools and upstream revisions
  used for reproducible builds. The existing DKC1Recomp/snesrecomp core is the
  foundation. The user explicitly approved compiler-provided C runtime support
  statically linked into Wasm, with inventoried handwritten imports for host
  services. Other new runtime libraries still need a decision.
- Ask the user when uncertainty affects a requirement or would require an
  exception. Continue independent work while a clarification is pending.
- Donkey Kong Land level integration is a later phase.

## Working boundaries

- The supplied project-root ROM has been verified against upstream's USA v1.0
  size and hash. Do not search unrelated folders for ROMs or obtain one elsewhere.
- Keep ROMs, saves, extracted assets, generated game code, and generated game
  binaries out of Git. Preserve upstream license and provenance notices.
- Distinguish research, proposals, compiled results, and actual browser/game
  testing. Never describe a source audit or stub as a working game port.
- Preserve game stepping, rendering, and audio behavior when replacing the
  native host. Choose changes based on a pinned reference implementation.
- Do not publish, deploy, or create remote repositories unless requested.
