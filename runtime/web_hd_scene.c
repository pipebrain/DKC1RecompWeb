#include "web_hd_files.h"
#define fopen DkcWebHdOpen
#define getenv DkcWebHdEnv
#include "dkc1_hd_scene.c"
#include "common_rtl.h"

const uint32_t *DkcWebHdLooseSprite(const uint32_t *,int,int);

int dkc_hd_preload(void) {
  Dkc1HdScenePrepare(g_ppu,g_ram,0);
  return (int)Dkc1HdSceneResidentCount();
}

// Match the Metal compositor’s per-native-pixel polish eligibility. The
// presenter checks its 3x3 native neighborhood before smoothing an HD pixel.
static bool CanPolish(const uint32_t *native,int width,int x,int y) {
  if (fixed_scene!=FIXED_SCENE_NONE) return false;
  for (unsigned i=0;i<object_count;i++) {
    Object *o=&objects[i];
    if (o->material && x>=o->x-1 && x<o->x+o->width+1 &&
        y>=o->y-1 && y<o->y+o->height+1) return false;
  }
  for (int l=0;l<3;l++) if(main_enable[y]&(1<<l)) {
    Background *bg=&backgrounds[l];
    int tx=(x-(width-256)/2+scroll_x[l][y])&(bg->width-1);
    int ty=(y+1+scroll_y[l][y])&(bg->height-1);
    if ((bg->pixels[(size_t)ty*bg->width+tx]>>24)&&!BackgroundHd(bg,tx,ty)) return false;
  }
  unsigned hits=0,misses=0;
  return ((Pixel(x,y,0,0,false,&hits,&misses)^native[y*width+x])&0xffffffu)==0;
}

const uint32_t *dkc_hd_frame(const uint32_t *native,int width,int height,int polish) {
  if (!Dkc1HdEnabled() || !native || width<256 || width>WIDTH || height!=HEIGHT) return NULL;
  const uint32_t *scene=Dkc1HdScenePresent(native,width,height);
  uint32_t *frame=(uint32_t *)(scene?scene:DkcWebHdLooseSprite(native,width,height));
  if (!frame) return NULL;
  if (polish) for (int y=0;y<height;y++) for (int x=0;x<width;x++) {
    uint32_t mask=(scene && CanPolish(native,width,x,y))?0xff000000u:0;
    for(int dy=0;dy<SCALE;dy++) for(int dx=0;dx<SCALE;dx++) {
      size_t i=(size_t)(y*SCALE+dy)*width*SCALE+x*SCALE+dx;
      frame[i]=(frame[i]&0xffffffu)|mask;
    }
  }
  return frame;
}
