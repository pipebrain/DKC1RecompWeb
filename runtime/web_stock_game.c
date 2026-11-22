/* Use the pinned stock game and PPU draw path. Fold optional host hooks out
 * at compile time so the module never needs a pack, second rendering pass,
 * or widened viewport. The native reference builds dkc1_game.c unchanged. */
#include "dkc1_framegen.h"
#include "dkc1_hd_sprites.h"
#include "dkc1_video.h"
#define Dkc1FrameGenEnabled() false
#define Dkc1AnimCadenceLogFrame(ram, frame) ((void)0)
#define Dkc1VideoIsWidescreen() false
#define Dkc1HdPrepare(ppu, ram, bias) ((void)0)
#define Dkc1HdCaptureLine(ppu, line) ((void)0)
#define Dkc1HdFinish(ppu) ((void)0)
#include "dkc1_game.c"
