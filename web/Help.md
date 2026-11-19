# Keyboard and game controls

## Start a game

1. Choose **DKM → Load ROM** and select your headerless Donkey Kong Country USA v1.0 ROM.
2. Choose **DKM → Start Game**, or focus the game screen and press your mapped **Start** input (Return with the default keyboard profile).
3. Choose **Config → Sound** to enable the original stereo soundtrack and sound effects.

The ROM is checked locally. The supported file is 4,194,304 bytes with SHA-256 `fa8cacf5bbfc39ee6bbaa557adf89133d60d42f6cf9e1db30d5a36a469f74d15`.

## Keyboard is the default input

Choose **Config → Input** to edit the keyboard profile. The default assignments are:

| Game action | Default keys |
| --- | --- |
| Move | Arrow keys |
| Jump · B | Z |
| Run and roll · Y | X |
| Start | Return |
| Select | Either Shift key |
| A | A |
| X | S |
| L | Q |
| R | W |

These are the defaults, not a live list of custom assignments. The Input page shows your current mapping.

1. Select **Keyboard (default)** as the input source.
2. Choose **Set key** beside an action, then press the key you want to assign. Use **Clear** to remove an assignment. Escape cancels key capture.
3. Choose **Save** to keep your changes, **Discard** to return to the saved mapping, or **Restore defaults** to restore the original keys.
4. Choose **Done**, then **DKM → Resume Game** to continue, or **Start Game** before your first launch. Unsaved changes must be saved or discarded before leaving the editor.

Keyboard assignments use physical key positions. Tab, Escape, and modifier shortcuts remain available to the browser and application controls. Space and either Shift key can be assigned as game keys.

## Controllers

Input, Devices, and Options are three tabs in the same settings page. Their separate **Config** menu items select the matching tab.

Connect a controller and press one of its buttons to make it available to the browser. To play with it, select the controller input source and choose its device and profile in **Config → Input**. Keyboard input is selected by default; choosing a controller activates its mapping instead.

The built-in standard controller profile can be duplicated. Custom profiles support reported buttons, sticks, triggers, and single-axis D-pad hats, with local saving and JSON import/export. For a D-pad encoded on one axis, use the eight-way hat capture option so diagonals are included.

## Pause, reload, and fullscreen

- The primary **DKM** command reads **Start Game** before first launch, **Pause Game** while playing, and **Resume Game** after pausing. Resuming preserves the current game.
- A **Paused** overlay shows the active input source and saved Start binding. A newly loaded game shows **Ready to Start** instead. This informational overlay stays visible in fullscreen and disappears during play. Clicking it focuses the game screen.
- With the game screen focused, press your selected keyboard or controller profile's **Start** to quick start or resume. The resume press is consumed until release. Press Start again during play for its normal in-game behavior, including DKC's own pause.
- Quick resume requires a foreground page and closed menus/dialogs. It is blocked during loading or input editing. After reconnecting a controller or returning focus, release a held Start before pressing again.
- Press **Space** while the game screen has focus to pause or resume with the default mapping. If you assign Space to a game action, it performs that action during play; use Config or leave the page to pause. Space still starts a paused game.
- Opening Config, About, or Help pauses the game. Leaving the page or switching tabs also pauses it. Close any open menu/dialog, focus the game screen and use the displayed input, or choose **DKM → Resume Game**.
- **DKM → Reload Game** starts a fresh paused boot of the selected ROM without another file picker. Cartridge saves and input profiles are preserved.
- **Config → Video** provides fullscreen. Escape returns to the normal view. Only the game screen becomes fullscreen; the complete 4:3 image remains visible.

Enable Sound through Config first. If the browser requires audio interaction again, use a click or keyboard press to enable Sound before resuming with a controller.

## Cartridge saves

Save normally at Candy's in the game. Cartridge SRAM is stored in this browser automatically.

- **DKM → Export Save** downloads a copy of the cartridge save.
- **DKM → Load Save** imports a 2,048-byte cartridge save. Choose **DKM → Reload Game**, then Start Game, to let the game read it.
- **Config → Saves** provides the same save import/export controls.

Saves, keyboard assignments, and controller profiles are separate. They belong to the browser profile and exact local address, including its port. Export saves and controller profiles before moving between browsers or local addresses.

## Available features

Video currently uses the original 4:3 presentation and nearest scaling. Speed uses normal game timing with pause/resume. Paths, Cheat, and NetPlay remain visible but disabled. Native-release enhancements such as widescreen, CRT filters, rewind, save states, replacement music, and mods are not enabled in this browser edition.

## Documentation source

The game's identity, original control foundation, and cartridge-save guidance come from the [DKC1Recomp README](https://github.com/elliotttate/DKC1Recomp/blob/3eb9a10c49cb210df2bd63addafe2a78cf9f4e22/README.md) and [upstream save documentation](https://github.com/elliotttate/DKC1Recomp/blob/3eb9a10c49cb210df2bd63addafe2a78cf9f4e22/docs/INGAME_SAVES.md). The menu paths, editable keyboard input, browser storage, and browser limitations above describe this edition.
