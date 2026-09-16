#ifndef P2P_KIWI_OVERLAY_DRAW_H
#define P2P_KIWI_OVERLAY_DRAW_H

#include "overlay_native.h"
#include <stdint.h>

void overlay_draw_clear(uint8_t *buf, int width, int height);
void overlay_draw_cursors(uint8_t *buf, int width, int height, const NativeSource *source, const NativeCursor *cursors, int n);
uint32_t overlay_parse_color(const char *hex);

#endif
