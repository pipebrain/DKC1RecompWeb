#ifndef DKC_WEB_CORE_H
#define DKC_WEB_CORE_H

#include <stddef.h>
#include <stdint.h>

/* One game initialization per WebAssembly instance. Return 0 on success.
 * Input memory remains caller-owned; initialization retains its own ROM copy.
 * Framebuffer bytes are BGRA8. Audio is interleaved signed 16-bit stereo at
 * 32040 Hz, consumed once after each successful step (533 or 534 frames).
 * Button bits: B,Y,Select,Start,Up,Down,Left,Right,A,X,L,R, low to high. */
void *dkc_alloc(size_t size);
void dkc_free(void *memory);
void dkc_msu_enable(int enabled);
uint32_t dkc_msu_state(void);
int dkc_init(const uint8_t *rom, size_t size);
int dkc_stomp_event(void);
int dkc_step(uint32_t buttons);
const uint8_t *dkc_framebuffer(void);
unsigned dkc_width(void);
unsigned dkc_height(void);
unsigned dkc_pitch(void);
void dkc_video_config(unsigned width, unsigned edge, unsigned layer,
                      int provenance, int aquatic, int framegen);
void dkc_video_invalidate(void);
const uint8_t *dkc_video_smooth(int midpoint);
const uint8_t *dkc_video_midpoint(void);
int dkc_video_color(int kind);
const uint8_t *dkc_video_grade(const uint8_t *frame, unsigned width, unsigned height);
const int16_t *dkc_audio_buffer(void);
unsigned dkc_audio_frames(void);
unsigned dkc_audio_rate(void);
uint8_t *dkc_sram(void);
unsigned dkc_sram_size(void);
const char *dkc_last_error(void);
size_t dkc_state_write(void *out, size_t capacity);
int dkc_state_read(const void *data, size_t size);

/* Fresh-boot route diagnostics. Fold PCM exactly once per diagnostic step,
 * then request the native headless fingerprints for that checkpoint. */
void dkc_debug_hash_audio(void);
const char *dkc_debug_fingerprints(void);

#endif
