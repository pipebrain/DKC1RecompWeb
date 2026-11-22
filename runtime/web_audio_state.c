/* Compile the pinned implementation once so a browser state can preserve its
 * private resampler history. Native file snapshots deliberately reset these
 * fields because an OS audio callback runs on an independent clock. The
 * browser worker consumes a deterministic number of samples per guest frame. */
#include "common_rtl.c"
#include <stddef.h>
#include <string.h>

typedef struct {
  double phase, occupancy;
  int16_t left, right;
  int starved, fade_position;
  uint64_t pace, last_cycles, last_master, frame_start;
  uint8_t frame_valid;
  uint8_t ports[sizeof(Apu) - offsetof(Apu, portQueue)];
} WebAudioState;

size_t WebAudioStateSize(void) { return sizeof(WebAudioState); }

void WebAudioStateSave(void *buffer) {
  WebAudioState state = {
    .phase=s_render_phase, .occupancy=s_render_occ_ema,
    .left=s_render_hold_l, .right=s_render_hold_r,
    .starved=s_render_starved, .fade_position=s_render_fade_pos,
    .pace=g_apu_pace_cycles_estimate, .last_cycles=g_apu_last_sync_cycles,
    .last_master=g_apu_last_sync_master, .frame_start=g_apu_frame_start_master,
    .frame_valid=g_apu_frame_time_valid
  };
  memcpy(state.ports, g_snes->apu->portQueue, sizeof state.ports);
  memcpy(buffer, &state, sizeof state);
}

void WebAudioStateLoad(const void *buffer) {
  WebAudioState state;
  memcpy(&state, buffer, sizeof state);
  s_render_phase=state.phase; s_render_occ_ema=state.occupancy;
  s_render_hold_l=state.left; s_render_hold_r=state.right;
  s_render_starved=state.starved; s_render_fade_pos=state.fade_position;
  g_apu_pace_cycles_estimate=state.pace; g_apu_last_sync_cycles=state.last_cycles;
  g_apu_last_sync_master=state.last_master; g_apu_frame_start_master=state.frame_start;
  g_apu_frame_time_valid=state.frame_valid!=0;
  memcpy(g_snes->apu->portQueue, state.ports, sizeof state.ports);
}
