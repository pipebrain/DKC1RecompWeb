# DKC1Recomp browser-port audit

Checked: 2026-11-18 (America/Toronto).

No existing browser implementation was identified within the scope below.
This is a source-discovery audit, not a build or gameplay validation.

## Scope and method

- The [repository metadata](https://api.github.com/repos/elliotttate/DKC1Recomp)
  reported `forks_count: 25`, while the
  [public direct-forks endpoint](https://api.github.com/repos/elliotttate/DKC1Recomp/forks?per_page=100&sort=newest)
  returned 22 entries in a single 100-item page. The audit covers the 22
  enumerated repositories, not an inferred set of 25. The count discrepancy
  was not resolved.
- Retrieved each fork's complete recursive default-branch Git tree. All 22
  responses reported `truncated: false`.
- Searched paths for browser/web/Wasm/WebGPU/Emscripten names, `.wasm`, `.wgsl`,
  and HTML entry points. The only matching file in every default tree was
  `docs/dashboard.html`.
- Inspected the [shared HTML](https://github.com/elliotttate/DKC1Recomp/blob/3eb9a10c49cb210df2bd63addafe2a78cf9f4e22/docs/dashboard.html):
  it is a generated regression dashboard, not a browser game host.
- Enumerated branches of the two most recently pushed forks, RaffDevs and
  maxhym. Inspected all three of their non-default branch trees, as listed
  below; their only matching browser-style path was also the dashboard.
- Read the pinned default-branch README and top-level CMake files of those two
  recent forks. They describe native hosts and expose native/iOS targets; no
  browser target was identified in those files.
- GitHub repository searches for `DKC1Recomp wasm`, `DKC1Recomp web`,
  `"donkey kong country" webassembly`, and `snesrecomp webgpu` each returned
  zero repository matches. Supplementary web searches, including GitHub-only
  queries for DKC1Recomp/browser/Wasm/WebGPU, found no additional browser-port
  candidate. Search coverage is inherently incomplete.

The connected GitHub tools supported repository, file, branch, and tree reads,
but rejected forks and repository-search endpoints. Those limited queries and
the default-tree enumeration used unauthenticated public GitHub REST reads.
No repository was modified, built, or run for this audit.

## Enumerated default branches

Every row below was scanned at the recorded commit. Repository links identify
the primary source; commit hashes make the scan reproducible.

| Repository | Default branch | Inspected commit |
| --- | --- | --- |
| [szlego212/DKC1Recomp](https://github.com/szlego212/DKC1Recomp) | `main` | `3eb9a10c49cb210df2bd63addafe2a78cf9f4e22` |
| [RaffDevs/DKC1Recomp](https://github.com/RaffDevs/DKC1Recomp) | `main` | `bd7b3cd474da2c13dd31b7fbf79243dac4030128` |
| [maxhym/DKC1Recomp](https://github.com/maxhym/DKC1Recomp) | `main` | `ea39d3704020d6b13b2705033e994ed14047c121` |
| [striddan/DKC1Recomp](https://github.com/striddan/DKC1Recomp) | `main` | `3eb9a10c49cb210df2bd63addafe2a78cf9f4e22` |
| [MadladWithABoxHat/DKC1RecompAndroid](https://github.com/MadladWithABoxHat/DKC1RecompAndroid) | `android-port` | `9afb1d9ec7bc834543c48b5ef2f0636c042ff1e8` |
| [gumilastik/DKC1Recomp-Coop](https://github.com/gumilastik/DKC1Recomp-Coop) | `main` | `50162ebb355d2ad21771838a99e837d17a131fdb` |
| [lfdjs/DKC1Recomp](https://github.com/lfdjs/DKC1Recomp) | `main` | `3eb9a10c49cb210df2bd63addafe2a78cf9f4e22` |
| [AIarchaea/DKC1Recomp](https://github.com/AIarchaea/DKC1Recomp) | `main` | `3eb9a10c49cb210df2bd63addafe2a78cf9f4e22` |
| [slash-proc/DKC1Recomp](https://github.com/slash-proc/DKC1Recomp) | `main` | `3eb9a10c49cb210df2bd63addafe2a78cf9f4e22` |
| [cualquiercosa327/DKC1Recomp](https://github.com/cualquiercosa327/DKC1Recomp) | `main` | `3eb9a10c49cb210df2bd63addafe2a78cf9f4e22` |
| [douglasars10/DKC1Recomp](https://github.com/douglasars10/DKC1Recomp) | `main` | `f4c82a2a03d410e5622cff6a80086f4898b5570c` |
| [H0R1Z0N/DKC1Recomp](https://github.com/H0R1Z0N/DKC1Recomp) | `main` | `f4c82a2a03d410e5622cff6a80086f4898b5570c` |
| [FermataRest/DKC1Recomp](https://github.com/FermataRest/DKC1Recomp) | `main` | `aa196393ece613d3b04adf437f38f6f2d5364649` |
| [YlPorts/DKC1Recomp-ANdroid](https://github.com/YlPorts/DKC1Recomp-ANdroid) | `main` | `38b3935b4fe2262e17a65d7e1d16926e7605668b` |
| [victor-oliveira1/DKC1Recomp-Linux](https://github.com/victor-oliveira1/DKC1Recomp-Linux) | `main` | `6bd2346151833555380a7ccb0b9bfc5de2dde6a1` |
| [souldbminerr/DKC1Recomp-NX](https://github.com/souldbminerr/DKC1Recomp-NX) | `main` | `7d565eaa3c9e3340e8bc6cca7e2f375d9a40e606` |
| [juanitopop1/DKC1Recomp](https://github.com/juanitopop1/DKC1Recomp) | `main` | `cb4dae77a6552790cbb7a9663957b2cb6c3e6b58` |
| [MauricioBarrientos/DKC1Recomp](https://github.com/MauricioBarrientos/DKC1Recomp) | `main` | `f4c82a2a03d410e5622cff6a80086f4898b5570c` |
| [omegakatana92/DKC1Recomp](https://github.com/omegakatana92/DKC1Recomp) | `main` | `ee6d662b75021acfdd0592324aab0acf01344f57` |
| [zeroz41/DKC1Recomp](https://github.com/zeroz41/DKC1Recomp) | `main` | `ee6d662b75021acfdd0592324aab0acf01344f57` |
| [snackztime/DKC1Recomp](https://github.com/snackztime/DKC1Recomp) | `main` | `b404cb708460829998315d44a9fa0ab39984a96b` |
| [Nicktendonick/DKC1Recomp](https://github.com/Nicktendonick/DKC1Recomp) | `main` | `d85f5f41b311681c06e5fc020580f6251967a467` |

## Additional branch coverage

Branch lists: [RaffDevs](https://api.github.com/repos/RaffDevs/DKC1Recomp/branches?per_page=100),
[maxhym](https://api.github.com/repos/maxhym/DKC1Recomp/branches?per_page=100).

| Repository | Branch | Inspected commit |
| --- | --- | --- |
| RaffDevs/DKC1Recomp | `experiment/dk-hd-slice` | `fca21c30b62d36b33c6099bd57bbd5b10d4af5bd` |
| RaffDevs/DKC1Recomp | `windows-release-polish` | `559bab62596a97e91f389b39cdeb6cda981ab7c9` |
| maxhym/DKC1Recomp | `claude/quirky-keller-9qug4g` | `c498bf378eb21ff80c2dee580487eb35035e3569` |

Additional content inspection:
[RaffDevs CMake](https://github.com/RaffDevs/DKC1Recomp/blob/bd7b3cd474da2c13dd31b7fbf79243dac4030128/CMakeLists.txt),
[RaffDevs README](https://github.com/RaffDevs/DKC1Recomp/blob/bd7b3cd474da2c13dd31b7fbf79243dac4030128/README.md),
[maxhym CMake](https://github.com/maxhym/DKC1Recomp/blob/ea39d3704020d6b13b2705033e994ed14047c121/CMakeLists.txt),
[maxhym README](https://github.com/maxhym/DKC1Recomp/blob/ea39d3704020d6b13b2705033e994ed14047c121/README.md).

## Limits

The tree scan is a filename inventory, not semantic inspection of every file.
Other branches, private repositories, unlisted forks, differently named
projects, and source hidden in unexpected filenames may contain relevant work.
Submodule contents were not recursively searched as part of this derivative
audit. Absence of a candidate here is sufficient to continue evaluating the
chosen upstream; it is not proof that no browser implementation exists.
