# Controller profiles

Choose **Config → Input** from the menu bar or compact Menu. Input, Devices,
and Options are tabs in the same settings page. The game pauses
while Config is open; input binding and live monitoring work outside the player.
Choose **Done**, then resume to play with the selected mapping.

Focus the game screen and press the selected profile's **Start** to quick
start/resume. The browser consumes that press until release; later Start
presses during play retain their normal in-game behavior. Quick resume is
blocked while menus, dialogs, or input editing are active and while the page
is unfocused. Release a held controller Start after reconnecting or changing
focus/input source before pressing again. Keyboard quick resume uses its saved
Start binding (Return by default) when Keyboard is selected.

Keyboard is the initial input source. Select **Gamepad** in **Input device** to
use the controller editor and activate its mapping. The source choice is saved
between visits. Selecting Keyboard activates its saved key mapping instead;
the game does not combine both sources.

Keyboard bindings are editable directly with **Set key** / **Clear**,
**Save**, **Discard**, and **Restore defaults**. Their separate storage key is
`dkc.keyboard-settings.v1`. Duplicate assignments and reserved host/navigation
keys are rejected. Existing gamepad profiles and SRAM are unchanged by keyboard
edits. Keyboard defaults and instructions are in [Help.md](../web/Help.md).

## Standard and raw controllers

The original host silently skipped every gamepad whose browser `mapping` was
not `standard`. The old page text, "Standard gamepads are supported," overstated
the validation and did not explain that restriction. An unmapped browser device
can expose buttons/axes without matching that standard layout. See the
[Gamepad mapping enum](https://www.w3.org/TR/gamepad/#gamepadmappingtype-enum).

The original button/axis assignments remain the immutable **Standard controller
(default)** profile. A raw controller is now shown in the selector and live
monitor, with a message to create a custom profile instead of being silently
discarded. A custom profile can use any reported button or axis index.

The user reported an **8BitDo SN30 Pro+**, vendor `2dc8`, product `6102`, with
buttons B0-B7/B10/B11 and axes 0/1/2/5/9 failing in the initial player. The
controller was tested over Bluetooth in Chrome and Safari; its startup mode,
browser mapping string, and complete physical button assignments were not
recorded. No guessed or agent hardware-verified SN30
preset is supplied. Browser tests use a representative injected device with
those index ranges, not a recording from the user's hardware.

## Create, save, and load

1. Connect the controller and press a button while the browser page is active.
   Browsers may withhold the device until it has been used. Select it in
   **Controller** and check the live button/axis readouts.
2. Choose **New profile** for a blank mapping, or **Duplicate** to start
   with the current assignments. Give the profile a name.
3. Release the controls, choose a capture type, click **Listen** beside a game
   action, then press or move the desired control. Alternatively use the manual
   binding controls and the indices shown by the live monitor.
4. Add alternatives if desired. Multiple bindings for an action are combined.
   Clear/remove an assignment to replace an unwanted capture.
5. Choose **Save**. The profile and its selection for this browser's device ID
   are stored locally. Select an existing profile to load it. **Discard**
   returns to the saved mapping; unsaved changes block closing/switching.
6. Choose **Done**, then resume. Settings suppresses controller output
   while open; the live mapped-action preview still shows what is being bound.

Profiles use a separate `dkc.controller-settings.v1` localStorage key. Cartridge
SRAM remains in its existing IndexedDB store. Profile changes do not overwrite
game saves. Storage belongs to the browser and exact origin (including port);
use export/import to move profiles between browsers or origins.

## Export and import

**Export profile** downloads the selected profile as versioned JSON. Exporting
the default produces a custom copy, preserving the immutable built-in profile.
Under **Profile files and options**, **Import profile** validates a JSON file and opens it as a new draft. Choose
**Save** to keep it locally. Existing profiles are not silently overwritten by
an import. Custom profiles can be renamed or deleted; the default cannot.

The importer accepts only the supported schema/version, finite input values,
bounded indices/binding counts, and files up to 64 KiB. Invalid files leave the
current mapping intact and show an error.

## Axes and D-pad hats

- **Button:** the reported B index, with an activation threshold.
- **Axis +/-:** movement away from a neutral position with a deadzone/threshold.
  A nonzero rest value supports controls such as triggers resting at -1.
- **Exact axis value:** match a particular value within a tolerance. This
  supports raw encodings without assuming vendor-specific directions.
- **Eight-way hat:** explicitly choose this only when live values use the
  supported eight-state encoding. It includes diagonal directions and ignores
  out-of-range neutral values. It matches the eight values the user reported
  for axis 9 (up at -1 through up-left at +1). Exact-value alternatives can
  cover another encoding.

The live monitor reports axis values, including axis 9, without silently
clamping them into ordinary stick input. Use that evidence when choosing a hat
or exact-value binding.

## Verification

Run the pure mapping/JSON tests:

```sh
.local/tools/node-v22.16.0-darwin-arm64/bin/node --test tests/gamepad-profiles.test.mjs
```

The controller browser regression uses an isolated Chrome profile and injected
gamepad fixtures; its result and physical-test limits are recorded in
[VALIDATION.md](VALIDATION.md). A successful synthetic test does not establish
that the actual SN30 Pro+ is mapped correctly.

The user withdrew the reported diagonal-input bug after correcting the binding
configuration, then reported "Everything tests OK" before requesting the GUI
overhaul. This feedback is separate from the synthetic regression evidence.
