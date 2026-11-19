#include "web_core.h"

#include "common_cpu_infra.h"
#include "common_rtl.h"
#include "dkc1_game.h"
#include "dkc1_video.h"
#include "sha256.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

enum {
  kRomSize = 0x400000,
  kWidth = 256,
  kHeight = 224,
  kPitch = kWidth * 4,
  kAudioRate = 32040,
  kMaxAudioFrames = 534,
};

/* The native headless host is the first deterministic comparison baseline.
 * It advances one game frame before drawing and then consumes audio using
 * this cadence. Presentation scheduling belongs to the handwritten host. */
static const double kGameHz = 60.098811862;
static const uint8_t kRomSha256[32] = {
  0xfa, 0x8c, 0xac, 0xf5, 0xbb, 0xfc, 0x39, 0xee,
  0x6b, 0xba, 0xa5, 0x57, 0xad, 0xf8, 0x91, 0x33,
  0xd6, 0x0d, 0x42, 0xf6, 0xcf, 0x9e, 0x1d, 0xb3,
  0x0d, 0x5a, 0x36, 0xa4, 0x69, 0xf7, 0x4d, 0x15,
};

static uint8_t s_pixels[kPitch * kHeight];
static int16_t s_audio[kMaxAudioFrames * 2];
static unsigned s_audio_frames;
static double s_audio_fraction;
static uint8_t *s_rom;
static int s_attempted;
static int s_ready;
static char s_error[192];

static int SetError(int status, const char *message) {
  (void)snprintf(s_error, sizeof s_error, "%s", message);
  s_audio_frames = 0;
  return status;
}

void *dkc_alloc(size_t size) {
  /* ROM and save transfers are small and explicitly bounded by the host. */
  if (size == 0 || size > 16u * 1024u * 1024u)
    return NULL;
  return malloc(size);
}

void dkc_free(void *memory) { free(memory); }

int dkc_init(const uint8_t *rom, size_t size) {
  if (s_attempted)
    return SetError(2, "Create a fresh WebAssembly instance to load another ROM.");
  if (!rom || size != kRomSize)
    return SetError(1, "Expected the headerless 4 MiB DKC USA v1.0 ROM.");
  uint8_t digest[32];
  sha256_compute(rom, size, digest);
  if (memcmp(digest, kRomSha256, sizeof digest) != 0)
    return SetError(1, "ROM SHA-256 does not match DKC USA v1.0.");
  s_rom = malloc(size);
  if (!s_rom)
    return SetError(3, "Unable to allocate the retained ROM buffer.");
  memcpy(s_rom, rom, size);

  /* Existing upstream globals and function statics are intentionally owned
   * by a single instance, just as in its native process host. */
  s_attempted = 1;
  Dkc1VideoSetWidescreen(false);
  if (!Dkc1VideoSetRenderWidth(kWidth))
    return SetError(4, "Unable to select the stock 256-pixel framebuffer.");
  Dkc1VideoSetRom(s_rom, size);
  RtlRegisterGame(Dkc1GameInfo());
  if (!SnesInit(s_rom, (int)size))
    return SetError(4, "The SNES runtime rejected the verified ROM.");
  if (!g_sram || g_sram_size != 2048)
    return SetError(4, "The cartridge SRAM does not have the expected size.");
  Dkc1BeginDrawing(s_pixels, kPitch);
  RtlSetAudioOutputRate(kAudioRate);
  s_audio_fraction = 0.0;
  s_audio_frames = 0;
  s_error[0] = '\0';
  s_ready = 1;
  return 0;
}

int dkc_step(uint32_t buttons) {
  if (!s_ready)
    return SetError(2, "Load a supported ROM before advancing the game.");
  if (g_fail)
    return SetError(5, "The SNES runtime reported an off-rails failure.");
  RtlRunFrame(buttons & 0x00ffffffu);
  if (g_fail)
    return SetError(5, "The SNES runtime reported an off-rails failure.");
  if (g_watchdog_tripped)
    return SetError(6, "The frame watchdog stopped game execution.");

  /* Draw even frames the browser later skips presenting: the PPU draw path
   * participates in hardware behavior and cannot be omitted for catch-up. */
  Dkc1DrawPpuFrame();
  s_audio_fraction += (double)kAudioRate / kGameHz;
  s_audio_frames = (unsigned)s_audio_fraction;
  s_audio_fraction -= (double)s_audio_frames;
  if (s_audio_frames > kMaxAudioFrames)
    return SetError(7, "The per-frame audio request exceeded its buffer.");
  memset(s_audio, 0, s_audio_frames * 2u * sizeof s_audio[0]);
  RtlRenderAudio(s_audio, (int)s_audio_frames, 2);
  return 0;
}

const uint8_t *dkc_framebuffer(void) { return s_pixels; }
unsigned dkc_width(void) { return kWidth; }
unsigned dkc_height(void) { return kHeight; }
unsigned dkc_pitch(void) { return kPitch; }
const int16_t *dkc_audio_buffer(void) { return s_audio; }
unsigned dkc_audio_frames(void) { return s_audio_frames; }
unsigned dkc_audio_rate(void) { return kAudioRate; }
uint8_t *dkc_sram(void) { return s_ready ? g_sram : NULL; }
unsigned dkc_sram_size(void) { return s_ready ? (unsigned)g_sram_size : 0; }
const char *dkc_last_error(void) { return s_error; }
