cmake_minimum_required(VERSION 3.20)

project(dkc1_native_reference LANGUAGES C)
set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS OFF)

get_filename_component(DKC1_PROJECT_ROOT "${CMAKE_CURRENT_LIST_DIR}/../.." ABSOLUTE)
file(READ "${DKC1_PROJECT_ROOT}/upstream.lock.json" DKC1_LOCK)
string(JSON DKC1_TAG GET "${DKC1_LOCK}" dkc1recomp tag)
set(DKC1_UPSTREAM_DIR "${DKC1_PROJECT_ROOT}/.local/upstream/DKC1Recomp-${DKC1_TAG}"
    CACHE PATH "Pinned DKC1Recomp checkout")
set(DKC1_GENERATED_DIR "${DKC1_UPSTREAM_DIR}/generated/snesrecomp"
    CACHE PATH "Private generated game C sources")
set(SNESRECOMP_ROOT "${DKC1_UPSTREAM_DIR}/snesrecomp")

if(NOT EXISTS "${SNESRECOMP_ROOT}/runner/runner.cmake")
    message(FATAL_ERROR "Prepare the pinned upstream checkout and snesrecomp submodule first")
endif()
file(GLOB DKC1_GENERATED_SOURCES CONFIGURE_DEPENDS "${DKC1_GENERATED_DIR}/*.c")
if(NOT DKC1_GENERATED_SOURCES)
    message(FATAL_ERROR "Generate the private game C sources from the verified ROM first")
endif()

# Build the upstream headless host independently of SDL and the browser adapter.
include("${SNESRECOMP_ROOT}/runner/runner.cmake")
set(DKC1_ENGINE_SOURCES ${SNESRECOMP_RUNNER_SOURCES})
list(REMOVE_ITEM DKC1_ENGINE_SOURCES
    "${SNESRECOMP_ROOT}/runner/src/keybinds.c"
    "${SNESRECOMP_ROOT}/runner/src/host_report.c")

set(DKC1_GAME_SOURCES
    desktop_sram.c
    dkc1_game.c
    dkc1_video.c
    dkc1_hd_scene.c
    dkc1_hd_sprites.c
    dkc1_framegen.c
    dkc1_dixie_mod.c
    dkc1_margin_proxy.c
    dkc1_ws_trace.c
    input_playback.c
    wram_dump.c
    dkc1_script.c
    dkc1_debug_dump.c
    dkc1_flight_recorder.c
    dkc1_blank_scan.c
    dkc1_invariant_monitor.c
    verified_rom.c
    headless_host.c
    headless_main.c)
list(TRANSFORM DKC1_GAME_SOURCES PREPEND "${DKC1_UPSTREAM_DIR}/runner/")

add_executable(dkc1_native_reference
    ${DKC1_ENGINE_SOURCES}
    ${DKC1_GENERATED_SOURCES}
    ${DKC1_GAME_SOURCES})
target_include_directories(dkc1_native_reference PRIVATE
    "${DKC1_UPSTREAM_DIR}/runner"
    "${DKC1_UPSTREAM_DIR}/recomp"
    ${SNESRECOMP_RUNNER_INCLUDE_DIRS})
target_compile_definitions(dkc1_native_reference PRIVATE
    SNESRECOMP_TRACE=0
    SNESRECOMP_REVERSE_DEBUG=0
    SNESRECOMP_EXTERNAL_RAM_ROUTINE_GUARDS=1
    SYSTEM_VOLUME_MIXER_AVAILABLE=0)
target_link_libraries(dkc1_native_reference PRIVATE ${SNESRECOMP_RUNNER_LIBRARIES})
if(APPLE)
    enable_language(OBJC)
    target_sources(dkc1_native_reference PRIVATE "${DKC1_UPSTREAM_DIR}/runner/macos_hd_scene.m")
    target_link_libraries(dkc1_native_reference PRIVATE
        "-framework Foundation" "-framework CoreFoundation" "-framework Metal")
endif()

# Exercise the exact standalone-Wasm adapter and source subset natively before
# attributing a mismatch to the browser compiler or its host imports.
set(DKC1_ADAPTER_ENGINE_SOURCES ${DKC1_ENGINE_SOURCES})
list(REMOVE_ITEM DKC1_ADAPTER_ENGINE_SOURCES
    "${SNESRECOMP_ROOT}/runner/src/launcher.c"
    "${SNESRECOMP_ROOT}/runner/src/launcher_cache.c"
    "${SNESRECOMP_ROOT}/runner/src/launcher_picker.c")
set(DKC1_ADAPTER_GAME_SOURCES
    dkc1_game.c dkc1_video.c dkc1_hd_scene.c dkc1_hd_sprites.c
    dkc1_framegen.c dkc1_margin_proxy.c dkc1_ws_trace.c
    dkc1_debug_dump.c headless_host.c)
list(TRANSFORM DKC1_ADAPTER_GAME_SOURCES PREPEND "${DKC1_UPSTREAM_DIR}/runner/")
add_executable(dkc1_adapter_check
    ${DKC1_ADAPTER_ENGINE_SOURCES} ${DKC1_GENERATED_SOURCES}
    ${DKC1_ADAPTER_GAME_SOURCES}
    "${DKC1_UPSTREAM_DIR}/runner/input_playback.c"
    "${DKC1_PROJECT_ROOT}/runtime/web_core.c"
    "${DKC1_PROJECT_ROOT}/tests/native_adapter_check.c")
target_include_directories(dkc1_adapter_check PRIVATE
    "${DKC1_PROJECT_ROOT}/runtime"
    "${DKC1_UPSTREAM_DIR}/runner" "${DKC1_UPSTREAM_DIR}/recomp"
    ${SNESRECOMP_RUNNER_INCLUDE_DIRS})
target_compile_definitions(dkc1_adapter_check PRIVATE
    SNESRECOMP_TRACE=0 SNESRECOMP_REVERSE_DEBUG=0
    SNESRECOMP_EXTERNAL_RAM_ROUTINE_GUARDS=1 SYSTEM_VOLUME_MIXER_AVAILABLE=0)
target_link_libraries(dkc1_adapter_check PRIVATE ${SNESRECOMP_RUNNER_LIBRARIES})
