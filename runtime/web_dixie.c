/* Reuse the pinned loader's IPS decoder and its post-patch SHA-256 check.
 * The web host has already verified the clean image in memory. */
#include "dkc1_dixie_mod.c"
#include "snes/dma.h"

uint8_t *WebDixieRom(const uint8_t *rom, size_t *size, char *error, size_t capacity) {
  uint8_t *image = calloc(1, kModRomSize);
  if (!image) {
    snprintf(error, capacity, "Unable to allocate the Dixie cartridge.");
    return NULL;
  }
  memcpy(image, rom, *size);
  if (!ApplyIps(kDkc1DixiePatchIps, kDkc1DixiePatchIpsSize, image, kModRomSize,
                error, capacity) || !Dkc1DixieMemoryMatchesModIdentity(image, kModRomSize)) {
    free(image);
    snprintf(error, capacity, "Dixie cartridge synthesis failed its identity check.");
    return NULL;
  }
  // Dixie emits zero-length VRAM transfers that the native variant skips.
  dma_set_zero_size_vram_noop(1);
  *size = kModRomSize;
  return image;
}
