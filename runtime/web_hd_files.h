#ifndef DKC_WEB_HD_FILES_H
#define DKC_WEB_HD_FILES_H

#include <stdio.h>
#include <stdlib.h>

FILE *DkcWebHdOpen(const char *path, const char *mode);
char *DkcWebHdEnv(const char *name);
#endif
