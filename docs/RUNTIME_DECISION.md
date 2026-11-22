# Browser C runtime decision

Status: the user approved compiled C runtime support and handwritten host imports on 2026-11-18.

The supplied ROM matches the required 4,194,304-byte USA v1.0 image and SHA-256.
Pinned upstream sources have been obtained and private C source generation has
completed using the supported Python analysis backend.

## Why a decision is needed

The existing game/runtime allocates memory during normal initialization and
uses C memory/string functions, diagnostics, clocks, and watchdog unwinding.
Compiler executables alone do not provide these services in a browser.
The project's zero-runtime-dependency rule therefore needs an explicit choice
before a browser game build can link C runtime support.

Source evidence at the pinned revisions:

- [SNES initialization and allocation](https://github.com/elliotttate/snesrecomp/blob/75223f35b16e4c904cea78453b9cd1fcefbcd7f2/runner/src/snes/snes.c#L39).
- [Frame guard using setjmp](https://github.com/elliotttate/snesrecomp/blob/75223f35b16e4c904cea78453b9cd1fcefbcd7f2/runner/src/common_rtl.c#L492).
- [Watchdog unwind using longjmp](https://github.com/elliotttate/snesrecomp/blob/75223f35b16e4c904cea78453b9cd1fcefbcd7f2/runner/src/common_cpu_infra.c#L649).

## Approved option: compiled C support only

Allow a pinned compiler toolchain to statically link its C standard library
and required compiler support into the private `.wasm` file. Use handwritten
JavaScript for instantiation and a small, explicitly inventoried set of host
imports such as logging and time. Imports may have toolchain or WASI ABI names;
their implementations would remain project-owned JavaScript calling browser
APIs, without installing an adapter package or a general virtual filesystem.

Emscripten 6.0.2 is the selected build tool. Its
[standalone Wasm mode](https://emscripten.org/docs/tools_reference/settings_reference.html#standalone-wasm)
can target a Wasm file without its generated JavaScript loader. Its
[Wasm exception based setjmp/longjmp support](https://emscripten.org/docs/porting/setjmp-longjmp.html#webassembly-exception-handling-based-support)
retains the core's watchdog control-flow support. The actual standalone build
passes native-reference framebuffer comparisons in Chrome, and a separate
Wasm allocation/non-local-unwind probe passed 20 repetitions with no imports.
This does not establish an induced game-watchdog failure test.

This option permits compiled C support, not SDL, a frontend framework, WebGPU
wrappers, generated JavaScript runtime glue, npm runtime packages, or a
third-party browser WASI adapter. Exact tool versions, linked libraries,
licenses, and host imports must be recorded with the first successful build.

## Verified build inventory

Source/tool versions are in `upstream.lock.json`: Emscripten 6.0.2, LLVM/lld
23.1.6, Binaryen 129, and Node 22.16.0 as a build/test executable. Emscripten's
own compiler JavaScript packages are confined to the ignored tool checkout;
none is imported by the browser host. The only source-compatibility build
adjustment is `_POSIX_C_SOURCE=200809L` to expose `strdup` and monotonic clocks.
No upstream/generated game source was edited.

The clean v1.1.0 stock browser module is 7,990,186 bytes with SHA-256
`3b15c52350846a2ebac4137113f3d3cad2d53cdeaa9496fdeb758a9e1b415f6d`.
The build links into `build/phase2-wasm/` before installing the module at
`web/dkc.wasm`. Its linker map, `build/phase2-wasm/dkc.map`, records these
compiler support archives.

- `libc-debug.a`
- `libclang_rt.builtins-legacysjlj.a`
- `libdlmalloc-debug.a`
- `libnoexit.a`
- `libstandalonewasm-memgrow.a`
- `libstubs-debug.a`

The clean module imports nine functions. The handwritten host supplies each
function through `web/wasm-imports.js`. The worker presents the stock PPU
framebuffer and runs the original audio clock.

| Namespace | Functions |
| --- | --- |
| `env` | `emscripten_notify_memory_growth`, `__syscall_getdents64` |
| `wasi_snapshot_preview1` | `clock_time_get`, `fd_close`, `fd_write`, `fd_read`, `environ_sizes_get`, `environ_get`, `fd_seek` |

Optional directory enumeration returns unsupported. The host provides an
empty environment and routes diagnostic output to the console. For the
watchdog, process and thread clock requests use monotonic elapsed time in
the single game worker. Unknown imports fail before boot.

Third-party source/license pointers are in [THIRD_PARTY.md](THIRD_PARTY.md).

## Alternative: no additional runtime library

Use LLVM and wasm-ld with a project-owned implementation of the reachable C
services. That includes a real allocator, memory/string operations, diagnostics,
and a tested watchdog-unwind design. Analyze optional file-I/O and unused
coprocessor paths before excluding them. This is a larger implementation task,
not a demonstrated small shim, and must not disable watchdog protection.

## Independent work

Source generation, a native headless reference using macOS system libraries,
the browser-fork audit, and a freestanding compiler probe can proceed without
approving a browser C library. None constitutes a playable browser port.
