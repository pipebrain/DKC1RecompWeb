# Clean v1.1.0 player settings

The wide menu bar and compact Menu expose the same Config commands. Input,
Devices and Options open different tabs of one settings page.

| Config command | Controls and fresh-profile defaults |
| --- | --- |
| Input | Select either SNES port. Player 1 starts on Keyboard with the original bindings. Player 2 starts disabled with empty keyboard bindings. Each port accepts a keyboard, an assigned gamepad, both together, or neither. Edit keyboard bindings, choose a gamepad and profile, and set an optional stick dead zone per player. |
| Input · controller profiles | Keep the built-in Standard mapping or duplicate it. Custom profiles support buttons, sticks, triggers and single-axis eight-way hats. The default profile dead zone is 0.35. Profile editing includes capture mode, import and export. |
| Input · save-state shortcuts | Assign Quick Save and Quick Load to keys or pad controls. Both start unassigned and operate on the selected slot. |
| Devices | Stomp rumble starts on. Test a connected controller when its browser exposes a supported actuator. |
| Options | Pause on loss of focus starts on. Appearance follows the system and also supports Light and Dark. |
| Video | Full screen on Start defaults off. The fullscreen command fits the complete 256×224 game frame to the available space at 4:3. |
| Sound | Original game audio starts on at 100% volume. Audio clock drift correction defaults on. Audio prebuffer defaults to two blocks and supports one through four. |
| Paths | Remember ROM on this device starts on. Turning it off removes the stored ROM copy while preserving cartridge saves. |
| Saves | Choose one of five stock state slots. Slot 1 is the default. Save State captures a running game and Load State restores it. Export Save and Load Save transfer the 2,048-byte cartridge SRAM used by Candy’s Save Point. |
| Speed | Playback runs at original speed. This page also offers Start, Pause or Resume. |

## Transfer and upgrade

**Config → Save Config** downloads version 2 JSON with the player settings,
both ports' bindings and assignments, custom controller profiles, rumble,
save-state shortcuts, selected slot and the remembered-ROM preference.
**Config → Load Config** validates the file before applying it. ROM contents,
cartridge SRAM and the five snapshot files live separately in IndexedDB.

On the same browser origin the player reads existing keyboard, controller and
player preferences. New edits use version 2 storage keys. Importing a Phase 2
configuration carries the supported choices forward, including custom bindings
and the selected slot. Old video, music, game variant and speed overrides are
discarded during conversion. Stock cartridge saves and state slots keep their
previous database keys. A ROM needs to be selected separately on a new device.

The historical inventory documents the additional settings in the Phase 2
preview. [Phase 2 settings](https://github.com/pipebrain/DKC1RecompWeb/blob/41a969f4de1cc48a728873f77e22a86fdfdc465b/docs/SETTINGS.md)
