/* Compare the browser C adapter against the existing native headless oracle.
 * Fingerprint fields/regions match upstream headless_main.c; no game code or
 * asset bytes are embedded in this test. This is not browser validation. */
#include "web_core.h"
#include "common_rtl.h"
#include "sha256.h"
#include "snes/ppu.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int Require(int condition, const char *message) {
  if (condition) return 1;
  fprintf(stderr, "adapter check failed: %s (%s)\n", message, dkc_last_error());
  return 0;
}

static void PrintHash(const char *key, const void *memory, size_t size) {
  uint8_t hash[32];
  sha256_compute(memory, size, hash);
  printf("\"%s\":\"", key);
  for (size_t i = 0; i < sizeof hash; ++i) printf("%02x", hash[i]);
  printf("\"");
}

int main(int argc, char **argv) {
  if (argc < 2 || argc > 3) {
    fprintf(stderr, "usage: dkc1_adapter_check <verified-rom> [frames]\n");
    return 2;
  }
  char *end = NULL;
  const long frames = argc == 3 ? strtol(argv[2], &end, 10) : 600;
  if ((argc == 3 && (!end || *end)) || frames < 1 || frames > 1000000) return 2;

  if (!Require(dkc_step(0) != 0, "step before initialization must fail") ||
      !Require(dkc_init(NULL, 0) != 0, "bad ROM size must fail")) return 3;
  enum { kRomSize = 0x400000 };
  uint8_t *rom = dkc_alloc(kRomSize);
  if (!Require(rom != NULL, "ROM allocation")) return 3;
  memset(rom, 0, kRomSize);
  if (!Require(dkc_init(rom, kRomSize) != 0,
               "correct-size incorrect-hash ROM must fail")) return 3;
  FILE *input = fopen(argv[1], "rb");
  if (!input || fread(rom, 1, kRomSize, input) != kRomSize ||
      fgetc(input) != EOF) {
    fprintf(stderr, "unable to read exact-size ROM\n");
    if (input) fclose(input);
    dkc_free(rom);
    return 2;
  }
  fclose(input);
  if (!Require(dkc_init(rom, kRomSize) == 0, "verified ROM initialization") ||
      !Require(dkc_init(rom, kRomSize) != 0, "second initialization must fail") ||
      !Require(dkc_width() == 256 && dkc_height() == 224 && dkc_pitch() == 1024,
               "stock framebuffer ABI") ||
      !Require(dkc_audio_rate() == 32040, "native audio rate") ||
      !Require(dkc_sram() != NULL && dkc_sram_size() == 2048, "SRAM ABI")) return 3;
  /* The adapter must retain its own bytes, not the freed caller upload. */
  memset(rom, 0, kRomSize);
  dkc_free(rom);

  uint64_t audio_fnv1a = UINT64_C(14695981039346656037);
  uint64_t audio_frames = 0;
  for (long frame = 0; frame < frames; ++frame) {
    if (!Require(dkc_step(0) == 0, "game step")) return 4;
    const unsigned count = dkc_audio_frames();
    if (!Require(count == 533 || count == 534, "audio frame count")) return 4;
    const int16_t *audio = dkc_audio_buffer();
    audio_frames += count;
    for (unsigned i = 0; i < count * 2u; ++i) {
      audio_fnv1a ^= (uint8_t)(audio[i] & 0xff);
      audio_fnv1a *= UINT64_C(1099511628211);
      audio_fnv1a ^= (uint8_t)(((uint16_t)audio[i] >> 8) & 0xff);
      audio_fnv1a *= UINT64_C(1099511628211);
    }
  }
  uint8_t oam[544];
  memcpy(oam, g_ppu->oam, sizeof g_ppu->oam);
  memcpy(oam + sizeof g_ppu->oam, g_ppu->highOam, sizeof g_ppu->highOam);
  printf("{");
  PrintHash("frame_sha256", dkc_framebuffer(), dkc_pitch() * dkc_height());
  printf(","); PrintHash("wram_sha256", g_ram, 0x20000);
  printf(","); PrintHash("vram_sha256", g_ppu->vram, sizeof g_ppu->vram);
  printf(","); PrintHash("cgram_sha256", g_ppu->cgram, sizeof g_ppu->cgram);
  printf(","); PrintHash("oam_sha256", oam, sizeof oam);
  printf(","); PrintHash("oam_source_sha256", g_ram + 0x200, sizeof oam);
  printf(",\"audio_fnv1a\":\"%016llx\",\"frames\":%ld,"
         "\"audio_frames\":%llu,\"abi_checks_passed\":true}\n",
         (unsigned long long)audio_fnv1a, frames,
         (unsigned long long)audio_frames);
  return 0;
}
