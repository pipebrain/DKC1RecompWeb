# GitHub Pages and mobile testing

GitHub Pages hosting is part of the version-1 scope. On 2026-11-22 the user
reported: "Mobile test site passes all checks." The mobile test-site baseline
is user-accepted; specific devices, OS/browser versions, input methods, and
test duration were not supplied.

## Hosting status

The canonical source repository is private:
https://github.com/pipebrain/DKC1RecompWeb.

The user chose a separate public deployment repository:
[pipebrain/DKC1RecompWeb-Pages](https://github.com/pipebrain/DKC1RecompWeb-Pages).
It contains six deployment/tooling files and no imported private Git history.
Its commits use the GitHub no-reply identity. The private source repository's
visibility was not changed.

The [mobile test site](https://pipebrain.github.io/DKC1RecompWeb-Pages/) serves the
**Phase 2 preview** as of November 22, 2026, at the same address as v1.
[Preview release](https://github.com/pipebrain/DKC1RecompWeb-Pages/releases/tag/pages-phase2-1a3d6518c669) ·
[Deployment run](https://github.com/pipebrain/DKC1RecompWeb-Pages/actions/runs/45024302063)

The release archive contains 43 files and has SHA-256
`1a3d6518c669539d5dc52bcdf98a685f246e43385c15d6e44ac49c264446ae4a`.
The deployed manifest has SHA-256
`56860a4dd6f7f1f98e7b0c768990bfbd07c56ba89d4c79c2510c239d16703cc0`.
Physical Android and iOS results for this preview are pending.

GitHub initially rejected Pages for the private source repository on the
account plan (HTTP 422). Public-repository Pages is available on that account,
so the separate deployment repository resolves this without a plan upgrade.

Ordinary GitHub Pages publishes the site's HTML, JavaScript, images, and
compiled Wasm publicly, even when its source repository is private. ROMs and
saves are never included in the deployment.

## Local artifact

Build the Wasm locally using the pinned workflow in the main README, then run:

```sh
python3 scripts/package_pages.py --out build/pages
python3 scripts/package_pages.py --out build/pages --verify
```

For an exact tested build, also provide `--expected-wasm-sha256 HASH`.
Phase 2 packages use an explicit runtime allowlist. It includes the stock and
Dixie modules, WebGPU shaders, browser code, icons, license notices, a checksum
manifest and `.nojekyll`. The local packager and archive verifier also recognize
the exact v1.0.0 file list. The public deployment repository uses the
matching verifier for both archive versions. Soundtracks, replacement
artwork, ROMs and cartridge saves stay on the player's device.
The launcher, controller-profile JSON, generated C, tools, and test evidence
are excluded. The output stays under ignored `build/`; the Wasm stays out of Git.

The previous v1.0.0 baseline's Wasm SHA-256 is
`dcc015d75e943aac3eb179309426b0caa90321f88731effe85e8922b3de3a014`.

Create the transport and record the printed archive SHA-256:

```sh
python3 scripts/pages_archive.py create --package build/pages \
  --out build/pages-transfer/pages-site.tar.gz
```

The archive is deterministic. Creating it does not upload or deploy anything.
Archive extraction checks the approved SHA-256 before unpacking and accepts
only the exact package manifest/allowlist, with no links or traversal paths.

## Deployment approach

Deployment is manual. A checked archive of the local static package is used as
a release asset in the chosen deployment repository. A manually dispatched
workflow verifies its SHA-256 and manifest, extracts only allowed files, and
uses GitHub's Pages actions to publish it. This avoids committing compiled game
binaries or sending a ROM/generated game C to a hosted runner.

The public deployment repository contains only the deployment workflow/tools,
with the browser package supplied as a release asset. The source repository
and upstream Git history remain private.
The release asset is a transport artifact for the publicly served site.

The workflow template is `deployment/pages/workflow.yml`. In the chosen
deployment repository it belongs at `.github/workflows/pages.yml`, alongside
`scripts/package_pages.py` and `scripts/pages_archive.py`. Enable Pages with
GitHub Actions once through repository settings, upload `pages-site.tar.gz` as
a release asset, then manually dispatch the workflow on `main` with
`release_tag` and `archive_sha256`. It uses pinned GitHub actions, minimal
deployment permissions, and no automatic push trigger. It does not need a ROM
or generated game C on the hosted runner. If the package schema/allowlist or
workflow tools change, update their copies in the deployment repository before
publishing a new archive.

The first deployed preview is `pages-v1-ac77be235c22`. Its archive SHA-256 is
`ac77be235c22f3d55945287c37a4560779d6be09740d8c283f29bce79d934e0b`.
[Deployment run](https://github.com/pipebrain/DKC1RecompWeb-Pages/actions/runs/44516231581).
The live HTTPS site passes the native 600-frame, save/audio/pause checks and
matches all packaged asset hashes. The user subsequently accepted the mobile
test-site baseline on 2026-11-22. See `docs/VALIDATION.md` for the distinction
between automated evidence and the user report; detailed device coverage
remains unrecorded.

## Test on a phone or tablet

1. Open the published HTTPS URL in a WebGPU-capable browser. For Android, use
   current Chrome on a supported device. Safari 26 or later introduced the
   required WebGPU support on iOS/iPadOS; actual adapter availability is checked
   by the app.
2. Put your own verified ROM in the device's Files picker. Select it through
   Menu → Load ROM; it is read locally and not uploaded.
3. Pair your controller and press a button so the browser can detect it. In the
   compact **Menu**, open **Config → Input**, select **Player 1**, choose **Gamepad**,
   then select the device and its profile. **Config → Devices** shows detected hardware.
4. Tap the game screen and choose **DKM → Start Game**. Test the D-pad diagonals,
   face buttons, and mapped Start for quick resume. Sound defaults on.
5. Use **Config → Save Config** to download your settings. Change a binding or sound
   setting, use **Load Config** to restore it, then close and reopen the page.
   Check that the setting, input source and controller profile are restored.
6. Record device, OS, browser and controller connection when reporting results.
   Rotation, app switching, reconnecting the controller and rumble on supported
   devices are useful physical-device checks.

Pages and localhost have separate browser storage. **Save Config** transfers
preferences and bindings. **DKM → Export Save** transfers cartridge progress.

## References

- [Pages publishing sources and availability](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [Custom Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [Safari 26.0 WebGPU](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)
- [Chrome's initial Android WebGPU rollout](https://developer.chrome.com/blog/new-in-webgpu-121)
