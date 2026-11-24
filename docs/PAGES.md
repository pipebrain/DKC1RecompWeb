# GitHub Pages and mobile testing

GitHub Pages hosting is part of the version-1 scope. On 2026-11-22 the user
reported: "Mobile test site passes all checks." The mobile test-site baseline
is user-accepted; specific devices, OS/browser versions, input methods, and
test duration were not supplied.

## Hosting status

The public [DKC1RecompWeb source repository](https://github.com/pipebrain/DKC1RecompWeb)
hosts [DKC1R Web](https://pipebrain.github.io/DKC1RecompWeb/). The manual Pages
workflow deploys the verified archive attached to the
[v1.1.2 release](https://github.com/pipebrain/DKC1RecompWeb/releases/tag/v1.1.2).

## Earlier mobile previews

The retired `DKC1RecompWeb-Pages` repository was used for previews while
the source was private. It is kept for rollback and marked for future deletion.

The former test site served the
**clean v1.1.0 testing preview**, built from Phase 3 commit
`d6adeae2ee325c15fb150c7e9e349be8985ddab4`.  [Preview release](https://github.com/pipebrain/DKC1RecompWeb-Pages/releases/tag/pages-v1.1.0-preview-16443759c66d) ·
[Deployment run](https://github.com/pipebrain/DKC1RecompWeb-Pages/actions/runs/45073717643)

| Clean preview | SHA-256 |
| --- | --- |
| Release archive, 37 files | `16443759c66d6c846c06bc42a8c846d529f0b34031127e223b731a1f1b4948fb` |
| Pages manifest | `9b8fcdefc6231b4f3b5d8f5dc422b98247599b1e1665615378ccb8c7f2710a30` |
| Stock Wasm | `3b15c52350846a2ebac4137113f3d3cad2d53cdeaa9496fdeb758a9e1b415f6d` |

Sound, resume after switching apps, and save states passed in Android
Chrome, iOS Safari, and iOS Chrome. Controller rumble was unavailable in
these mobile tests. iOS Safari showed persistent audio drift after save-state
load and game reload. [Device results](VALIDATION.md#clean-v110-live-pages-preview)

The previous
43-file archive remains available for rollback with SHA-256
`1a3d6518c669539d5dc52bcdf98a685f246e43385c15d6e44ac49c264446ae4a`.
[Phase 2 release](https://github.com/pipebrain/DKC1RecompWeb-Pages/releases/tag/pages-phase2-1a3d6518c669)

GitHub initially rejected Pages for the private source repository on the
account plan (HTTP 422). The separate preview repository provided public Pages
until the source repository became public.

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
The packager writes a clean archive with one stock Wasm module, the
browser host, icons, license notices, a checksum manifest and `.nojekyll`.
The local and public verifiers accept the exact clean, v1.0.0 and Phase 2
archive layouts. ROMs and cartridge saves stay on the player's device.
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

Deployment is manual. Attach the checked `pages-site.tar.gz` archive to
the release in `pipebrain/DKC1RecompWeb`. GitHub's Pages actions deploy it
after the workflow checks its SHA-256 and verifies the manifest. The hosted
runner needs the archive and the repository's deployment scripts.

The workflow is `.github/workflows/pages.yml`. Its source template lives
at `deployment/pages/workflow.yml`. In repository settings, select GitHub
Actions as the Pages publishing source, then dispatch the workflow on
`main` with `release_tag` and `archive_sha256`.

The first deployed preview is `pages-v1-ac77be235c22`. Its archive SHA-256 is
`ac77be235c22f3d55945287c37a4560779d6be09740d8c283f29bce79d934e0b`.
[Deployment run](https://github.com/pipebrain/DKC1RecompWeb-Pages/actions/runs/44516231581).
The live HTTPS site passes the native 600-frame, save/audio/pause checks and
matches all packaged asset hashes. The user subsequently accepted the mobile
test-site baseline on 2026-11-22. See `docs/VALIDATION.md` for the distinction
between automated evidence and the user report; detailed device coverage
remains unrecorded.

## Test on a phone or tablet

1. Open [DKC1R Web](https://pipebrain.github.io/DKC1RecompWeb/) on the
   phone in a browser with WebGPU.
2. Choose **Load ROM** on the game screen and select your supported ROM.
3. Pair your controller and press a button to make it available to the browser.
   In **Settings → Manage input profiles**, create a profile and use **Set** to
   bind its inputs. Assign that profile to a player in Settings.
4. Use **Start Game** on the game screen. Test sound, D-pad diagonals, face
   buttons, and the mapped Start input after pausing.
5. Test **Quick Save**, **Quick Load**, and reopening the app. Save at Candy's
   to check that cartridge progress is restored.
6. Test rumble from the selected profile. Record the device, OS, browser,
   controller, and connection when reporting results.

Both Pages URLs use the same browser origin. The app uses the same local
ROM and save keys at the new path. Localhost has separate browser storage.
**Save Settings** transfers preferences and profiles. **Save Game** exports
cartridge progress.

## References

- [Pages publishing sources and availability](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [Custom Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [Safari 26.0 WebGPU](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)
- [Chrome's initial Android WebGPU rollout](https://developer.chrome.com/blog/new-in-webgpu-121)
