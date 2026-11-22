// Route only the upstream HD translation units through the local pack reader.
#include "web_hd_files.h"
#define fopen DkcWebHdOpen
#define getenv DkcWebHdEnv
#define Dkc1HdPrepare PrepareHd
#define Dkc1HdCaptureLine CaptureHdLine
#define Dkc1HdFinish FinishHd
#include "dkc1_hd_sprites.c"
#undef Dkc1HdPrepare
#undef Dkc1HdCaptureLine
#undef Dkc1HdFinish

void dkc_hd_enable(int on) {
  if (Dkc1HdEnabled()!=!!on) Dkc1HdToggle();
}
void Dkc1HdPrepare(Ppu *p, const uint8_t *ram, int bias) {
  if (Dkc1HdEnabled()) PrepareHd(p,ram,bias);
}
void Dkc1HdCaptureLine(Ppu *p,int line) {
  if (Dkc1HdEnabled()) CaptureHdLine(p,line);
}
void Dkc1HdFinish(Ppu *p) {
  if (Dkc1HdEnabled()) FinishHd(p);
}
const uint32_t *DkcWebHdLooseSprite(const uint32_t *source,int width,int height) {
  if (!visible || !selected || !selected->pixels || width!=frame_width ||
      memcmp(source,accepted_native,(size_t)width*height*4)) return NULL;
  int scale=1;
  return Dkc1HdPresent(source,width,height,&scale);
}
