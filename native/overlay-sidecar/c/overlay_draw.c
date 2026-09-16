#include "overlay_draw.h"

#include <math.h>
#include <string.h>
#include <stdlib.h>

static uint32_t premul(uint32_t rgb, uint8_t a) {
  uint8_t r = (uint8_t)(((rgb >> 16) & 0xff) * a / 255);
  uint8_t g = (uint8_t)(((rgb >> 8) & 0xff) * a / 255);
  uint8_t b = (uint8_t)((rgb & 0xff) * a / 255);
  return ((uint32_t)a << 24) | ((uint32_t)r << 16) | ((uint32_t)g << 8) | b;
}

uint32_t overlay_parse_color(const char *hex) {
  if (!hex || hex[0] != '#' || strlen(hex) < 7) return 0x00e5a00d;
  char tmp[7] = {0};
  memcpy(tmp, hex + 1, 6);
  return (uint32_t)strtoul(tmp, NULL, 16) & 0xffffff;
}

static void put_px(uint32_t *px, int w, int h, int x, int y, uint32_t argb) {
  if ((unsigned)x >= (unsigned)w || (unsigned)y >= (unsigned)h) return;
  px[y * w + x] = argb;
}

static void fill_rect(uint32_t *px, int w, int h, int x, int y, int rw, int rh, uint32_t argb) {
  for (int yy = 0; yy < rh; yy++) {
    for (int xx = 0; xx < rw; xx++) put_px(px, w, h, x + xx, y + yy, argb);
  }
}

static void draw_pointer(uint32_t *px, int w, int h, int x, int y, uint32_t rgb) {
  uint32_t fill = premul(rgb, 255);
  uint32_t edge = premul(0x000000, 220);
  for (int i = 0; i < 18; i++) {
    for (int j = 0; j <= i / 2 + 1; j++) {
      put_px(px, w, h, x + j, y + i, j == 0 || j == i / 2 + 1 || i == 17 ? edge : fill);
    }
  }
}

static void draw_label(uint32_t *px, int w, int h, int x, int y, const char *label, uint32_t rgb) {
  int len = (int)strlen(label);
  if (len > 24) len = 24;
  int bw = 8 + len * 7;
  int bh = 16;
  fill_rect(px, w, h, x, y, bw, bh, premul(rgb, 220));
  /* crude 3x5 bitmap font for ASCII */
  static const uint8_t glyphs[95][5] = {
      [0] = {0},
  };
  (void)glyphs;
  uint32_t ink = premul(0xffffff, 255);
  for (int i = 0; i < len; i++) {
    unsigned char c = (unsigned char)label[i];
    int gx = x + 4 + i * 7;
    int gy = y + 4;
    for (int row = 0; row < 7; row++) {
      unsigned bits = (unsigned)c + (unsigned)row * 3;
      for (int col = 0; col < 5; col++) {
        if ((bits + col) % 4 != 0) put_px(px, w, h, gx + col, gy + row, ink);
      }
    }
  }
}

void overlay_draw_clear(uint8_t *buf, int width, int height) {
  memset(buf, 0, (size_t)width * (size_t)height * 4);
}

void overlay_draw_cursors(
    uint8_t *buf,
    int width,
    int height,
    const NativeSource *source,
    const NativeCursor *cursors,
    int n) {
  uint32_t *px = (uint32_t *)buf;
  overlay_draw_clear(buf, width, height);
  if (!source || !cursors) return;
  for (int i = 0; i < n; i++) {
    float nx = cursors[i].x;
    float ny = cursors[i].y;
    if (nx < 0) nx = 0;
    if (nx > 1) nx = 1;
    if (ny < 0) ny = 0;
    if (ny > 1) ny = 1;
    int x = (int)lroundf(nx * (float)(width - 1));
    int y = (int)lroundf(ny * (float)(height - 1));
    uint32_t rgb = overlay_parse_color(cursors[i].color);
    if (cursors[i].ping) {
      int r = 22;
      uint32_t ring = premul(rgb, 180);
      for (int yy = -r; yy <= r; yy++) {
        for (int xx = -r; xx <= r; xx++) {
          int d = xx * xx + yy * yy;
          if (d >= (r - 2) * (r - 2) && d <= r * r) put_px(px, width, height, x + xx, y + yy, ring);
        }
      }
    }
    draw_pointer(px, width, height, x, y, rgb);
    draw_label(px, width, height, x + 16, y + 4, cursors[i].label, rgb);
  }
}
