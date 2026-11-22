# Keyboard and game controls

## Start a game

1. On your first visit, choose **DKM → Load ROM** and select your headerless Donkey Kong Country USA v1.0 ROM. On later visits, the player opens your remembered ROM at **Ready to Start**.
2. Choose **DKM → Start Game**, or focus the game screen and press your mapped **Start** input (Return with the default keyboard profile).

Sound is on by default. Use **Config → Sound** to mute or unmute the game.

The ROM is checked locally. The supported file is 4,194,304 bytes with SHA-256 `fa8cacf5bbfc39ee6bbaa557adf89133d60d42f6cf9e1db30d5a36a469f74d15`.

**Config → Paths → Remember ROM on this device** is on by default. Turning it off removes the local ROM copy and keeps your cartridge saves. You can still play the loaded game and choose the file again next time. If this browser cannot store the ROM, choose it through DKM on each visit.

## Game variant and soundtrack

**Config → Options → Game on next load** selects Donkey Kong Country or the Dixie variant. Choose **DKM → Reload Game** to switch. Both use your original ROM. Each keeps its own cartridge saves and state slots.

To use replacement music, choose an extracted PCM folder or a ZIP-format `.msu1` or `.zip` file under **Config → Paths**. The pack must include `track-1.pcm` or `dkc_msu-1.pcm`. The player reads stereo 44.1 kHz MSU1 PCM tracks numbered 1 through 32. The import limit is 256 MiB per track and 3 GiB total.

Select MSU-1 under **Config → Sound** and reload the game. The Music Gain control adjusts only the replacement tracks and keeps the original sound effects. Config files remember your soundtrack choice. Each device needs its own local copy of the pack.

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

1. Choose a player and select **Keyboard** or **Keyboard and gamepad**. Player 1 starts with the default keys. Player 2 starts disabled and has no keys assigned.
2. Choose **Set key** beside an action, then press the key you want to assign. Use **Add key** to keep an alternate (up to four per action) and **Clear** to remove the assignments. Escape cancels key capture.
3. Choose **Save** to keep your changes, **Discard** to return to the saved mapping, or **Restore defaults** to restore the original keys.
4. Choose **Done**, then **DKM → Resume Game** to continue, or **Start Game** before your first launch. Unsaved changes must be saved or discarded before leaving the editor.

Keyboard assignments use physical key positions. Tab and Escape are reserved during game-key capture. With Assist enabled and the game focused, Tab activates the default fast-forward shortcut. Shift+Tab still moves focus. Space and either Shift key can be assigned as game keys.

## Controllers

Input, Devices, and Options are three tabs in the same settings page. Their separate **Config** menu items select the matching tab.

Connect a controller and press one of its buttons to make it available to the browser. To play with it, select the controller input source and choose its device and profile in **Config → Input**. Each player can use a keyboard, a gamepad, or both. Automatic assigns available pads in order. To keep a particular assignment across sessions, select that controller by name. The player stick dead zone overrides the profile value. Clear it to use the profile setting.

The built-in standard controller profile can be duplicated. Custom profiles support reported buttons, sticks, triggers, and single-axis D-pad hats, with local saving and JSON import/export. For a D-pad encoded on one axis, use the eight-way hat capture option so diagonals are included.

In **Config → Devices**, turn **Stomp rumble** on or off and test a selected controller. The test is enabled when the browser exposes a vibration actuator. On a standard controller, use Guide or Start + Back with the game focused to open Input. The D-pad moves focus. The bottom face button activates the focused item and the right face button closes Settings.

Under **Config → Input → Assist shortcuts**, you can learn keyboard or controller inputs for rewind, fast-forward, Quick Save, Quick Load and advancing one frame. Shortcuts apply with Assist enabled and the game screen focused. The defaults are Backspace and the left trigger for rewind, and Tab and the right trigger for fast-forward. Quick Save, Quick Load and frame advance start unassigned.

## Pause, reload, and fullscreen

- The primary **DKM** command reads **Start Game** before first launch, **Pause Game** while playing, and **Resume Game** after pausing. Resuming preserves the current game.
- A **Paused** overlay shows the active input source and saved Start binding. A newly loaded game shows **Ready to Start** instead. This informational overlay stays visible in fullscreen and disappears during play. Clicking it focuses the game screen.
- With the game screen focused, press your selected keyboard or controller profile's **Start** to quick start or resume. The resume press is consumed until release. Press Start again during play for its normal in-game behavior, including DKC's own pause.
- Quick resume requires a foreground page and closed menus/dialogs. It is blocked during loading or input editing. After reconnecting a controller or returning focus, release a held Start before pressing again.
- Press **Space** while the game screen has focus to pause or resume with the default mapping. If you assign Space to a game action, it performs that action during play; use Config or leave the page to pause. Space still starts a paused game.
- Opening Config, About, or Help pauses the game. Leaving the page or switching tabs also pauses it. Close any open menu/dialog, focus the game screen and use the displayed input, or choose **DKM → Resume Game**.
- **DKM → Reload Game** starts a fresh paused boot of the selected ROM without another file picker. Cartridge saves and input profiles are preserved.
- **Config → Video** provides fullscreen. Escape returns to the normal view. Only the game screen becomes fullscreen; the complete 4:3 image remains visible.

If the browser asks for a click or tap when using a controller, choose **DKM → Start Game** (or **Resume Game**) to activate audio.

## HD materials

Choose the upstream pack’s **Materials** folder under **Config → Paths**. The player checks the raster headers and index and saves the artwork in this browser. Enable **Use HD textures** in **Config → Video**, then reload the game. Your config file carries the texture, cleanup and finish settings. Select the artwork separately on each device. The full upstream resident pack needs about 1.7 GB for its pixels alone.

## Cartridge saves

Jump into the barrel at Candy’s Save Point. The game shows your saved slot, play time, and completion percentage. The player writes the cartridge save to this browser automatically. You can check the save message in DKM before closing.

Reopen the same address in the same browser profile, choose **DKM → Start Game**, then select your saved file on the game’s file-selection screen. **DKM → Load Save** is for importing a separate save file.

- **DKM → Export Save** downloads a copy of the cartridge save.
- **DKM → Load Save** imports a 2,048-byte cartridge save. Choose **DKM → Reload Game**, then Start Game, to let the game read it.
- **Config → Saves** provides the same save import/export controls.

Saves, keyboard assignments, and controller profiles are separate. They belong to the browser profile and exact local address, including its port. Export saves and controller profiles before moving between browsers or local addresses.

## Mobile testing

Use an HTTPS site in a browser with WebGPU support: current Chrome on a supported Android device, or Safari 26 or later on iOS/iPadOS. The v1 mobile test site passed user testing. The enhanced Phase 2 build has separate device requirements, particularly for HD materials.

1. Make the verified ROM available in your device's Files picker, then choose **Menu → Load ROM**. The ROM is read locally, not uploaded.
2. Pair a controller or connect a hardware keyboard. Touch menus are available; touch game controls are not implemented.
3. For a controller, choose **Config → Input**, select **Gamepad**, and select/configure its profile. A new browser profile starts with Keyboard selected.
4. Close Config, tap the game screen to focus it, then use **DKM → Start Game** or the displayed Start binding.

Fullscreen is disabled when the browser does not support fullscreen for the game screen. With Pause when inactive enabled, returning from another app or tab leaves the game paused. The game fits the selected aspect when the device rotates.

A hosted site and localhost have separate browser storage. Use Save Config to move your settings and bindings between sites. Use DKM → Export Save to move cartridge progress.

## Save and load your configuration

Settings are remembered in this browser at this site address. Use **Config → Save Config…** to download your player preferences, both players’ bindings, controller profiles, and ROM-retention choice as a JSON file. On a narrow screen, open **Menu** and scroll to the Config commands.

Use **Config → Load Config…** to apply that file on another visit or device. Save or discard active input edits first. Importing a config with Remember ROM turned off also removes the locally remembered ROM. Pick your own ROM and any music or HD material pack on the destination device. Transfer cartridge progress separately with **DKM → Export Save**.

## Video, sound and playback

**Video** starts at the original 4:3 aspect with nearest scaling. Choose 16:10 or 16:9 for the native core’s extended views. Pixel shape, edge handling, smoothing, reconstruction, phosphor color and CRT controls are available on this page. Full screen on Start applies during an eligible Start gesture.

**Sound** controls volume, audio buffering and drift correction. Two blocks is the default prebuffer. More blocks give playback more time to absorb scheduling delays. **Speed** selects 1×, 2× or 3×. Fast playback mutes audio. Enable Assist here to use your rewind and fast-forward shortcuts.

**Saves** has five game-state slots for each game variant. Choose a slot, then Save State or Load State. A state restores that point in the game, including its cartridge memory. **Speed → Advance one frame** steps through paused gameplay. With Assist on, **Rewind** returns to an earlier frame in the current session.

**Options → Record diagnostics** keeps a recent game checkpoint, inputs and worker timings. Choose **Export Repro…** to download them. This file contains game state and can include your cartridge progress.

## Documentation source

The game's identity, original control foundation, and cartridge-save guidance come from the [DKC1Recomp README](https://github.com/elliotttate/DKC1Recomp/blob/559bab62596a97e91f389b39cdeb6cda981ab7c9/README.md) and [upstream save documentation](https://github.com/elliotttate/DKC1Recomp/blob/559bab62596a97e91f389b39cdeb6cda981ab7c9/docs/INGAME_SAVES.md). The menu paths, editable keyboard input, browser storage, and browser limitations above describe this edition.
