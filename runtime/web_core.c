#include "web_core.h"

#include "common_cpu_infra.h"
#include "common_rtl.h"
#include "dkc1_game.h"
#include "dkc1_haptics.h"
#include "dkc1_video.h"
#include "sha256.h"
#include "snes/ppu.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

enum {
  kRomSize = 0x400000,
  kHeight = 224,
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

static uint8_t s_pixels[kDkc1VideoNativeWidth * kHeight * 4];
static int16_t s_audio[kMaxAudioFrames * 2];
static unsigned s_audio_frames;
static double s_audio_fraction;
static uint8_t *s_rom;
static int s_attempted;
static int s_ready;
static char s_error[192];
/* Each instance initializes one game. Diagnostic PCM starts at the FNV-1a
 * offset basis and is collected only when a replay requests it. */
static uint64_t s_debug_audio_fnv1a = UINT64_C(14695981039346656037);

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
  Dkc1VideoSetRenderWidth(kDkc1VideoNativeWidth);
  Dkc1VideoSetRom(s_rom, size);
  RtlRegisterGame(Dkc1GameInfo());
  if (!SnesInit(s_rom, (int)size))
    return SetError(4, "The SNES runtime rejected the verified ROM.");
  if (!g_sram || g_sram_size != 2048)
    return SetError(4, "The cartridge SRAM does not have the expected size.");
  Dkc1BeginDrawing(s_pixels, dkc_pitch());
  RtlSetAudioOutputRate(kAudioRate);
  s_audio_fraction = 0.0;
  s_audio_frames = 0;
  s_error[0] = '\0';
  s_ready = 1;
  return 0;
}

static int s_stomp_event;

int dkc_stomp_event(void) { return s_stomp_event; }

int dkc_step(uint32_t buttons) {
  if (!s_ready)
    return SetError(2, "Load a supported ROM before advancing the game.");
  if (g_fail)
    return SetError(5, "The SNES runtime reported an off-rails failure.");
  Dkc1StompProbe stomp;
  Dkc1StompProbeCapture(&stomp, g_ram);
  RtlRunFrame(buttons & 0x00ffffffu);
  s_stomp_event = Dkc1StompProbeAccepted(&stomp, g_ram);
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
unsigned dkc_width(void) { return kDkc1VideoNativeWidth; }
unsigned dkc_height(void) { return kHeight; }
unsigned dkc_pitch(void) { return kDkc1VideoNativeWidth * 4; }
const int16_t *dkc_audio_buffer(void) { return s_audio; }
unsigned dkc_audio_frames(void) { return s_audio_frames; }
unsigned dkc_audio_rate(void) { return kAudioRate; }
uint8_t *dkc_sram(void) { return s_ready ? g_sram : NULL; }
unsigned dkc_sram_size(void) { return s_ready ? (unsigned)g_sram_size : 0; }
const char *dkc_last_error(void) { return s_error; }

void dkc_debug_hash_audio(void) {
  for (unsigned i = 0; i < s_audio_frames * 2u; i++) {
    uint16_t sample = (uint16_t)s_audio[i];
    s_debug_audio_fnv1a ^= (uint8_t)sample;
    s_debug_audio_fnv1a *= UINT64_C(1099511628211);
    s_debug_audio_fnv1a ^= (uint8_t)(sample >> 8);
    s_debug_audio_fnv1a *= UINT64_C(1099511628211);
  }
}

static void HashHex(const void *data, size_t size, char hex[65]) {
  static const char digits[] = "0123456789abcdef";
  uint8_t hash[32];
  sha256_compute(data, size, hash);
  for (size_t i = 0; i < sizeof hash; i++) {
    hex[2 * i] = digits[hash[i] >> 4];
    hex[2 * i + 1] = digits[hash[i] & 15];
  }
  hex[64] = '\0';
}

const char *dkc_debug_fingerprints(void) {
  static char result[640];
  if (!s_ready)
    return NULL;
  uint8_t oam[sizeof g_ppu->oam + sizeof g_ppu->highOam];
  memcpy(oam, g_ppu->oam, sizeof g_ppu->oam);
  memcpy(oam + sizeof g_ppu->oam, g_ppu->highOam, sizeof g_ppu->highOam);
  char frame[65], wram[65], vram[65], cgram[65], oam_hash[65], oam_source[65];
  HashHex(s_pixels, dkc_pitch() * kHeight, frame);
  HashHex(g_ram, 0x20000, wram);
  HashHex(g_ppu->vram, sizeof g_ppu->vram, vram);
  HashHex(g_ppu->cgram, sizeof g_ppu->cgram, cgram);
  HashHex(oam, sizeof oam, oam_hash);
  HashHex(g_ram + 0x200, sizeof oam, oam_source);
  snprintf(result, sizeof result,
           "{\"frame_sha256\":\"%s\",\"wram_sha256\":\"%s\",\"vram_sha256\":\"%s\","
           "\"cgram_sha256\":\"%s\",\"oam_sha256\":\"%s\",\"oam_source_sha256\":\"%s\","
           "\"audio_fnv1a\":\"%016llx\"}",
           frame, wram, vram, cgram, oam_hash, oam_source,
           (unsigned long long)s_debug_audio_fnv1a);
  return result;
}

/* The guest snapshot omits the browser host's sample clock and the last
 * rendered frame. Include both so restore can present a paused frame without
 * advancing the game. This wrapper is private to this pinned browser core. */
typedef struct {
  uint32_t magic, width, guest_size, reserved;
  double audio_fraction;
  uint64_t audio_hash;
} WebStateHeader;

size_t WebAudioStateSize(void);
void WebAudioStateSave(void *out);
void WebAudioStateLoad(const void *data);

size_t dkc_state_write(void *out, size_t capacity) {
  if (!s_ready) return 0;
  size_t pixels = dkc_pitch() * kHeight;
  size_t guest = RtlSaveSnapshotToMemory(NULL, 0);
  size_t total = sizeof(WebStateHeader) + WebAudioStateSize() + pixels + guest;
  if (!guest || total > 16u * 1024u * 1024u) return 0;
  if (!out) return total;
  if (capacity < total) return 0;
  WebStateHeader header = {0x32574344, dkc_width(), (uint32_t)guest, 0,
                           s_audio_fraction, s_debug_audio_fnv1a};
  uint8_t *p = out;
  memcpy(p, &header, sizeof header);
  WebAudioStateSave(p + sizeof header);
  p += WebAudioStateSize();
  memcpy(p + sizeof header, s_pixels, pixels);
  return RtlSaveSnapshotToMemory(p + sizeof header + pixels, guest) == guest ? total : 0;
}

int dkc_state_read(const void *data, size_t size) {
  WebStateHeader h;
  if (!s_ready || !data || size < sizeof h) return 0;
  memcpy(&h, data, sizeof h);
  if (h.magic != 0x32574344 || (h.width != 256 && h.width != 308 && h.width != 342) ||
      !(h.audio_fraction >= 0 && h.audio_fraction < 1)) return 0;
  size_t pixels = h.width * kHeight * 4;
  const size_t prefix = sizeof h + WebAudioStateSize() + pixels;
  if (size < prefix || !h.guest_size || h.guest_size != size - prefix) return 0;
  const uint8_t *audio = (const uint8_t *)data + sizeof h;
  const uint8_t *frame = audio + WebAudioStateSize();
  if (!RtlLoadSnapshotFromMemory(frame + pixels, h.guest_size)) return 0;
  WebAudioStateLoad(audio);
  /* Phase 2 can store a wider stock frame. Recover the center console image. */
  unsigned left = (h.width - kDkc1VideoNativeWidth) / 2;
  for (unsigned y = 0; y < kHeight; y++)
    memcpy(s_pixels + y * dkc_pitch(), frame + (h.width * y + left) * 4, dkc_pitch());
  s_audio_fraction = h.audio_fraction;
  s_debug_audio_fnv1a = h.audio_hash;
  s_audio_frames = 0;
  Dkc1BeginDrawing(s_pixels, dkc_pitch());
  return 1;
}
