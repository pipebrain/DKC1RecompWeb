# Application interface

The user accepted the existing functional behavior, then requested a macOS/iOS
style interface with an application menu bar and less visual clutter.

## Direction

The closed application contains exactly one navigation element and the game.
On wide screens, `.app-menubar` presents the user's ZSNES-inspired groups:
a static DK coin, DKM, Config, Cheat, NetPlay, and Misc. On narrow
screens, that same navigation element presents a compact menu. All application
commands are available through menus in both layouts. Use system typography,
neutral surfaces, a blue accent, and light/dark appearance.

The monochrome DK coin was generated from the two user-supplied visual
references and is stored in `web/dk-coin.png`. A CSS mask uses the current text
color in light/dark appearances. It has no action, focus, or submenu.
The browser tab favicon uses a separate warm gold derivative with transparent
background and a restrained bronze edge for contrast in light/dark tabs.
`web/favicon.png` is 64 pixels; `web/favicon.ico` includes 16/32/48-pixel images.

| Menu | Contents |
| --- | --- |
| DKM | Load ROM; separator; Start Game / Pause Game / Resume Game, Reload Game; separator; Load Save, Export Save |
| Config | Input, Devices, Options, Video, Sound, Paths, Saves, Speed |
| Cheat | Disabled; not implemented |
| NetPlay | Disabled; not implemented |
| Misc | Help, About |

Input, Devices, and Options have separate Config menu entries. Each opens the
same Input settings page with the matching tab selected; its tab strip reads
Input | Devices | Options. The settings sidebar has a single Input page entry.
Input defaults to Keyboard for a fresh browser profile and shows the active
source beside the menu command. The keyboard profile can be edited with Set
key/Clear and saved, discarded, or restored to defaults. Selecting Gamepad
activates the existing controller editor and its separate stored profiles.
Other settings pages do not display this tab strip. The user confirmed that
unavailable features should remain visible but disabled. Config → Paths has a single checkbox for remembering the verified ROM on this device.
Turning it off removes the local ROM copy and preserves SRAM. Config
panes describe current capabilities: Video is stock 4:3/nearest plus
fullscreen; Sound enables original stereo audio; Speed is normal 1x with
playback control. Upstream enhancement ports are a separate task.

The user explicitly rejected the first shell's title area, playback toolbar,
status footer, and duplicate menu caption. `.menubar-caption`, `.app-navigation`,
`.toolbar`, `.app-status`, and empty-state text/buttons must be absent from
both the DOM and the styling, rather than hidden at any breakpoint. The game
area contains the canvas and the user's subsequently requested informational
pause overlay. Other status/save information is available within menus;
errors reveal the relevant menu instead of adding a status strip.

The compact layout applies at 700 CSS pixels or narrower, and in landscape
viewports 520 CSS pixels high or shorter. Compact navigation/menu controls have
44-pixel targets. The Config sheet uses a sidebar on wide screens and scrolling
section navigation on narrow screens; its content scrolls independently
of the game. Short landscape retains a sidebar to preserve content height.

Controller profiles and game-save import/export belong in a modal Config
sheet. Its header contains the Config title and Done, with no eyebrow. Help
has no Config tab; Misc > Help opens a separate keyboard-help dialog.
About uses the same monochrome DK coin as the menu bar. About/Help content
comes from `web/About.md` and `web/Help.md`; missing or empty Help keeps its
commands disabled. About links to the original repositories. Our project link
will be added after the user creates a repository.
A sidebar provides section navigation on wide screens;
compact navigation fits narrow screens. Group related controls, collapse
advanced input configuration and diagnostics, and retain explicit save/discard
for controller drafts. All menu commands must invoke real application behavior.

Only `.screen-wrap` enters fullscreen,
with the original game centered at 4:3 and scaled to contain the entire image.
The new shell must not change the game simulation or its input/audio/save data.

Reload Game reuses the already selected, verified ROM from session memory and
returns it to a fresh paused boot. Cartridge SRAM and controller profiles are
preserved. The previous image is cleared immediately; starting again uses
DKM > Start Game, mapped Start, or the existing Space shortcut. The primary
DKM command reads Start Game before first launch, Pause Game while running,
and Resume Game after pausing. It changes host playback without resetting the
ROM. An explicit worker-owned `hasStarted` flag distinguishes first launch from
resume, including a pause before frame one. New loads and Reload Game reset it;
failed ROM validation leaves the existing game intact. Playback commands are
disabled during loading/transitions or after a fatal error.

The user explicitly added an informational overlay inside `.screen-wrap` as
an exception to the earlier restriction on game-area text. It reads Ready to
Start for a fresh loaded game and Paused after starting, with the current input
source and saved Start binding. It is absent while unloaded, loading, or running.
It dims the retained frame without modifying game pixels, has no buttons, and
passes pointer input through to focus the canvas. It remains visible in
screen-only fullscreen. Hints reflect menu/dialog/focus requirements and use
Space as a fallback when Start is unassigned or the controller is unavailable
or incompatible. Fatal errors show Game stopped with browser reload guidance.
This indicates host pause; DKC's internal Start pause leaves the host running.

The selected input's mapped Start is also a quick start/resume shortcut when
the foreground game screen has focus. Consume that press through release so
it cannot also activate SNES Start. During play, later Start presses go to DKC
normally. Menus, dialogs, capture, unsaved drafts, loading, and errors block
quick resume. Controller connections and focus/source changes require a
neutral sample before a fresh press. Cancel pending resumes on pause, focus
loss, or menu opening, including audio waits and already posted worker commands.

## Apple references

The interface is implemented with browser standards, using these Apple design
guidelines as references:

- [The menu bar](https://developer.apple.com/design/human-interface-guidelines/the-menu-bar)
  for familiar command organization and keyboard access.
- [Menus](https://developer.apple.com/design/human-interface-guidelines/menus)
  for grouped commands and predictable menu behavior.
- [Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets)
  for focused settings tasks and explicit completion.
- [Layout](https://developer.apple.com/design/human-interface-guidelines/layout)
  for visual hierarchy, progressive disclosure, adaptation, and safe areas.

This is an emulated browser interface using the user's command grouping with
Apple-style surfaces, disabled items, keyboard access, and adaptive layout. Apple
HIG also describes native system functions that a browser page cannot provide;
no claim of native platform certification is made. The menu-only composition
is the user's explicit requirement, not an Apple prohibition on toolbars.

No native framework, system menu integration, external font, icon library,
generated JavaScript runtime, or frontend dependency is introduced.

## Validation

Actual Chrome checks pass for desktop and compact layouts in light/dark
appearance, keyboard menus, outside-click/Escape dismissal, Settings focus and
unsaved-draft guards, menu playback commands, and 4:3 fullscreen containment.
Existing controller, save/audio, and native-frame regressions also pass after
shell integration. Evidence and browser/device limits are recorded in
[VALIDATION.md](VALIDATION.md). Visible Safari and user review remain pending.

Reproduce the interface checks with the existing local Node build tool:

```sh
.local/tools/node-v22.16.0-darwin-arm64/bin/node scripts/ui_check.mjs \
  --rom '/absolute/path/to/your/dkc1.smc'
```
