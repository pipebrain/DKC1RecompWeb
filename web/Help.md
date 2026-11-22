# Keyboard and game controls

## Start a game

1. On your first visit, choose **DKM → Load ROM** and select your headerless Donkey Kong Country USA v1.0 ROM. On later visits, the player opens your remembered ROM at **Ready to Start**.
2. Choose **DKM → Start Game**, or focus the game screen and press your mapped **Start** input (Return with the default keyboard profile).

Sound is on by default. Use **Config → Sound** to mute or unmute the game.

The ROM is checked locally. The supported file is 4,194,304 bytes with SHA-256 `fa8cacf5bbfc39ee6bbaa557adf89133d60d42f6cf9e1db30d5a36a469f74d15`.

**Config → Paths → Remember ROM on this device** is on by default. Turning it off removes the local ROM copy and keeps your cartridge saves. You can still play the loaded game and choose the file again next time. If this browser cannot store the ROM, choose it through DKM on each visit.

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

Keyboard assignments use physical key positions. Tab and Escape are reserved during game-key capture. Space and either Shift key can be assigned as game keys.

## Controllers

Input, Devices, and Options are three tabs in the same settings page. Their separate **Config** menu items select the matching tab.

Connect a controller and press one of its buttons to make it available to the browser. To play with it, select the controller input source and choose its device and profile in **Config → Input**. Each player can use a keyboard, a gamepad, or both. Automatic assigns available pads in order. To keep a particular assignment across sessions, select that controller by name. The player stick dead zone overrides the profile value. Clear it to use the profile setting.

The built-in standard controller profile can be duplicated. Custom profiles support reported buttons, sticks, triggers, and single-axis D-pad hats, with local saving and JSON import/export. For a D-pad encoded on one axis, use the eight-way hat capture option so diagonals are included.

In **Config → Devices**, turn on **Stomp rumble** and choose a **Stomp strength**. Standard gives enemy stomps a firm, 140 ms pulse. Light (original) uses the upstream 55 ms pulse. The first assigned gamepad receives the feedback. An ordinary jump has no rumble.

To check the motors, select the player and check the controller name. Hold the controller and choose **Test rumble** for a half-second pulse at full strength. The status shows how the browser handled the request.

On a standard controller, use Guide or Start + Back with the game focused to open Input. The D-pad moves focus. The bottom face button activates the focused item and the right face button closes Settings.

Under **Config → Input → Save-state shortcuts**, assign a key or controller input to Quick Save and Quick Load. Both start unassigned. With the game screen focused, these shortcuts use the slot selected in **Config → Saves**.

## Pause, reload, and fullscreen

- The primary **DKM** command reads **Start Game** before first launch, **Pause Game** while playing, and **Resume Game** after pausing. Resuming preserves the current game.
- A **Paused** overlay shows the active input source and saved Start binding. A newly loaded game shows **Ready to Start** instead. This informational overlay stays visible in fullscreen and disappears during play. Clicking it focuses the game screen.
- With the game screen focused, either player can press their assigned **Start** to quick start or resume. Release it before pressing Start again. During play each player's Start reaches their own SNES port.
- Quick resume requires a foreground page and closed menus/dialogs. It is blocked during loading or input editing. After reconnecting a controller or returning focus, release a held Start before pressing again.
- Press **Space** while the game screen has focus to pause or resume with the default mapping. If you assign Space to a game action, it performs that action during play; use Config or leave the page to pause. Space still starts a paused game.
- Opening Config, About, or Help pauses the game. Leaving the page or switching tabs also pauses it when **Config → Options → Pause when the window loses focus** is enabled. Close any open menu/dialog, focus the game screen and use the displayed input, or choose **DKM → Resume Game**.
- **DKM → Reload Game** starts a fresh paused boot of the selected ROM without another file picker. Cartridge saves and input profiles are preserved.
- **Config → Video** provides fullscreen. Escape returns to the normal view. Only the game screen becomes fullscreen; the complete 4:3 image remains visible.

If the browser asks for a click or tap when using a controller, choose **DKM → Start Game** (or **Resume Game**) to activate audio.

## Cartridge saves

Jump into the barrel at Candy’s Save Point. The game shows your saved slot, play time, and completion percentage. The player writes the cartridge save to this browser automatically. You can check the save message in DKM before closing.

Reopen the same address in the same browser profile, choose **DKM → Start Game**, then select your saved file on the game’s file-selection screen. **DKM → Load Save** is for importing a separate save file.

- **DKM → Export Save** downloads a copy of the cartridge save.
- **DKM → Load Save** imports a 2,048-byte cartridge save. Choose **DKM → Reload Game**, then Start Game, to let the game read it.
- **Config → Saves** provides the same save import/export controls.

Saves, keyboard assignments, and controller profiles are separate. They belong to the browser profile and exact local address, including its port. Export saves and controller profiles before moving between browsers or local addresses.

## Mobile testing

Use an HTTPS site in a browser with WebGPU support: current Chrome on a supported Android device, or Safari 26 or later on iOS/iPadOS. The v1 mobile test site passed user testing.

1. Make the verified ROM available in your device's Files picker, then choose **Menu → Load ROM**. The ROM is read locally, not uploaded.
2. Pair a controller or connect a hardware keyboard. Touch menus are available; touch game controls are not implemented.
3. For a controller, choose **Config → Input**, select **Gamepad**, and select/configure its profile. A new browser profile starts with Keyboard selected.
4. Close Config, tap the game screen to focus it, then use **DKM → Start Game** or the displayed Start binding.

Fullscreen is disabled when the browser does not support fullscreen for the game screen. With Pause when inactive enabled, returning from another app or tab leaves the game paused. The game keeps the complete 4:3 image visible when the device rotates.

A hosted site and localhost have separate browser storage. Use Save Config to move your settings and bindings between sites. Use DKM → Export Save to move cartridge progress.

## Save and load your configuration

Settings are remembered in this browser at this site address. Use **Config → Save Config…** to download your player preferences, both players’ bindings, controller profiles, and ROM-retention choice as a JSON file. On a narrow screen, open **Menu** and scroll to the Config commands.

Use **Config → Load Config…** to apply that file on another visit or device. Save or discard active input edits first. Importing a config with Remember ROM turned off also removes the locally remembered ROM. Choose your own ROM on the destination device. Transfer cartridge progress separately with **DKM → Export Save**.

## Video, sound and playback

**Video** fits the 256 × 224 game image inside your window at 4:3. Use Enter Full Screen to enlarge it. Full screen on Start requests fullscreen when you first start a game with a supported browser gesture.

**Sound** controls volume, audio buffering and drift correction. Two blocks is the default prebuffer. More blocks give playback more time to absorb scheduling delays. **Speed** shows the normal playback rate and provides the Start, Pause or Resume command.

## Save states

In **Config → Saves**, choose one of five slots, then **Save State** to capture the current game. **Load State** restores that point and its cartridge memory. Use the resume binding shown on the game screen or choose **DKM → Resume Game**. Each slot stays in this browser at this address, including after you close the game. Saving again to the same slot replaces its contents.

## Documentation source

The game's identity, original control foundation, and cartridge-save guidance come from the [DKC1Recomp README](https://github.com/elliotttate/DKC1Recomp/blob/559bab62596a97e91f389b39cdeb6cda981ab7c9/README.md) and [upstream save documentation](https://github.com/elliotttate/DKC1Recomp/blob/559bab62596a97e91f389b39cdeb6cda981ab7c9/docs/INGAME_SAVES.md). The menu paths, editable keyboard input, browser storage, and browser limitations above describe this edition.
