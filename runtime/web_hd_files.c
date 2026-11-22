// Limit file access to the selected material pack. The pinned CPU compositor
// reads its normal streams. The worker releases each source blob on fclose.
#define _GNU_SOURCE
#include "web_hd_files.h"
#include <stdint.h>
#include <string.h>

__attribute__((import_module("env"),import_name("dkc_hd_open")))
extern int OpenMaterial(const char *name);
__attribute__((import_module("env"),import_name("dkc_hd_read")))
extern int ReadMaterial(int handle, void *buffer, size_t length);
__attribute__((import_module("env"),import_name("dkc_hd_close")))
extern void CloseMaterial(int handle);

static ssize_t Read(void *cookie, char *buffer, size_t length) {
  return ReadMaterial((int)(intptr_t)cookie,buffer,length);
}
static int Close(void *cookie) {
  CloseMaterial((int)(intptr_t)cookie);
  return 0;
}
FILE *DkcWebHdOpen(const char *path, const char *mode) {
  if (strncmp(path,"/materials/",11) || strcmp(mode,"rb")) return NULL;
  int handle=OpenMaterial(path+11);
  if (!handle) return NULL;
  void *cookie=(void *)(intptr_t)handle;
  FILE *file=fopencookie(cookie,"r",(cookie_io_functions_t){.read=Read,.close=Close});
  if (!file) Close(cookie);
  return file;
}

static int indexed;
void dkc_hd_indexed(int enabled) { indexed=enabled; }
char *DkcWebHdEnv(const char *name) {
  if (!strcmp(name,"DKC1_HD_PACK") || !strcmp(name,"DKC1_HD_SCENE_PACK")) return "/materials";
  if (!strcmp(name,"DKC1_HD_SCENE")) return "1";
  if (!strcmp(name,"DKC1_HD_SCENE_PRELOAD") || !strcmp(name,"DKC1_HD_CONNECTED_WORLD") ||
      !strcmp(name,"DKC1_HD_EXACT_CENTERS")) return indexed?"1":NULL;
  return NULL;
}
