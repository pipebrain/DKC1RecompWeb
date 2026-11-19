cmake_minimum_required(VERSION 3.20)
project(dkc1_browser_core LANGUAGES C)
set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS OFF)

if(NOT EMSCRIPTEN)
  message(FATAL_ERROR "Configure this target with the pinned Emscripten toolchain")
endif()
get_filename_component(DKC1_PROJECT_ROOT "${CMAKE_CURRENT_LIST_DIR}/../.." ABSOLUTE)
set(DKC1_UPSTREAM_DIR "${DKC1_PROJECT_ROOT}/.local/upstream/DKC1Recomp"
    CACHE PATH "Pinned DKC1Recomp checkout")
set(DKC1_GENERATED_DIR "${DKC1_UPSTREAM_DIR}/generated/snesrecomp"
    CACHE PATH "Private generated game C sources")
set(SNESRECOMP_ROOT "${DKC1_UPSTREAM_DIR}/snesrecomp")
if(NOT EXISTS "${SNESRECOMP_ROOT}/runner/runner.cmake")
  message(FATAL_ERROR "Prepare the pinned source checkout before configuring")
endif()
file(GLOB DKC1_GENERATED_SOURCES CONFIGURE_DEPENDS "${DKC1_GENERATED_DIR}/*.c")
if(NOT DKC1_GENERATED_SOURCES)
  message(FATAL_ERROR "Generate private game sources from the verified ROM first")
endif()

include("${SNESRECOMP_ROOT}/runner/runner.cmake")
set(DKC1_ENGINE_SOURCES ${SNESRECOMP_RUNNER_SOURCES})
list(REMOVE_ITEM DKC1_ENGINE_SOURCES
  "${SNESRECOMP_ROOT}/runner/src/keybinds.c"
  "${SNESRECOMP_ROOT}/runner/src/host_report.c"
  "${SNESRECOMP_ROOT}/runner/src/launcher.c"
  "${SNESRECOMP_ROOT}/runner/src/launcher_cache.c"
  "${SNESRECOMP_ROOT}/runner/src/launcher_picker.c")

# Preserve the pinned game's host adapters. Diagnostic file paths remain
# inactive in the browser's empty environment. No SDL or launcher is linked.
set(DKC1_GAME_SOURCES
  dkc1_game.c dkc1_video.c dkc1_baby_kong.c dkc1_baby_kong_animation.c
  dkc1_baby_kong_movement.c dkc1_margin_proxy.c dkc1_ws_trace.c
  dkc1_debug_dump.c headless_host.c)
list(TRANSFORM DKC1_GAME_SOURCES PREPEND "${DKC1_UPSTREAM_DIR}/runner/")

add_executable(dkc1_core ${DKC1_ENGINE_SOURCES} ${DKC1_GENERATED_SOURCES}
  ${DKC1_GAME_SOURCES} "${DKC1_PROJECT_ROOT}/runtime/web_core.c")
set_target_properties(dkc1_core PROPERTIES OUTPUT_NAME "dkc" SUFFIX ".wasm"
  RUNTIME_OUTPUT_DIRECTORY "${DKC1_PROJECT_ROOT}/web")
target_include_directories(dkc1_core PRIVATE
  "${DKC1_PROJECT_ROOT}/runtime" "${DKC1_UPSTREAM_DIR}/runner"
  "${DKC1_UPSTREAM_DIR}/recomp" ${SNESRECOMP_RUNNER_INCLUDE_DIRS})
target_compile_definitions(dkc1_core PRIVATE
  SNESRECOMP_TRACE=0 SNESRECOMP_REVERSE_DEBUG=0
  SNESRECOMP_EXTERNAL_RAM_ROUTINE_GUARDS=1 SYSTEM_VOLUME_MIXER_AVAILABLE=0
  # The pinned core uses POSIX clock_gettime and strdup. Musl correctly hides
  # those declarations under strict ISO C11 unless this feature level is set.
  _POSIX_C_SOURCE=200809L)
target_compile_options(dkc1_core PRIVATE -fwasm-exceptions
  "-sSUPPORT_LONGJMP=wasm" -Wno-unused-function)
target_link_libraries(dkc1_core PRIVATE ${SNESRECOMP_RUNNER_LIBRARIES})
target_link_options(dkc1_core PRIVATE
  --no-entry -fwasm-exceptions
  "-Wl,-Map=${CMAKE_CURRENT_BINARY_DIR}/dkc.map"
  "-sSTANDALONE_WASM=1" "-sSUPPORT_LONGJMP=wasm"
  "-sFILESYSTEM=0" "-sASSERTIONS=1"
  "-sALLOW_MEMORY_GROWTH=1" "-sINITIAL_MEMORY=134217728"
  "-sMAXIMUM_MEMORY=536870912" "-sSTACK_SIZE=8388608"
  "-sERROR_ON_UNDEFINED_SYMBOLS=1")
foreach(export IN ITEMS dkc_alloc dkc_free dkc_init dkc_step dkc_framebuffer
    dkc_width dkc_height dkc_pitch dkc_audio_buffer dkc_audio_frames
    dkc_audio_rate dkc_sram dkc_sram_size dkc_last_error)
  target_link_options(dkc1_core PRIVATE "-Wl,--export=${export}")
endforeach()
