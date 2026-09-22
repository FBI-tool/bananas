#ifndef P2P_KIWI_OVERLAY_DRAW_H
#define P2P_KIWI_OVERLAY_DRAW_H

#include "overlay_native.h"
#include <stdint.h>

void overlay_draw_clear(uint8_t *buf, int width, int height);
void overlay_draw_cursors(uint8_t *buf, int width, int height, const NativeSource *source, const NativeCursor *cursors, int n);
uint32_t overlay_parse_color(const char *hex);
/* Pixel size of a cursor buffer for a zoomed display. Logical bounds stay in
 * source->width/height; this is bounds * scaleFactor, at least 1x. */
void overlay_physical_size(const NativeSource *source, int *bw, int *bh);
/* 1 when ow/oh and hw/hh share one scale in about 0.5x..4x, within 8px. */
int overlay_sizes_share_ratio(int ow, int oh, int hw, int hh, float *ratio_out);

#endif
