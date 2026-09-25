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
/* Capture rectangle in the same global pointer space as the monitor rect.
   Without a capture, the monitor rect is copied through. Returns 1 when a
   window rectangle was applied. */
int overlay_capture_global(
    const NativeSource *source, int mx, int my, int mw, int mh, int *x, int *y, int *w, int *h);
/* Same rectangle relative to a monitor bitmap whose size is the monitor's physical size. */
void overlay_capture_local(
    const NativeSource *source, int bitmap_w, int bitmap_h, int *lx, int *ly, int *lw, int *lh);
/* Store a pointer-space window rectangle as DIP capture fields. */
void overlay_set_capture_from_pointer(
    NativeSource *source, int mx, int my, int mw, int mh, int gx, int gy, int gw, int gh);
/* 1 when ow/oh and hw/hh share one scale in about 0.5x..4x, within 8px. */
int overlay_sizes_share_ratio(int ow, int oh, int hw, int hh, float *ratio_out);

#endif
