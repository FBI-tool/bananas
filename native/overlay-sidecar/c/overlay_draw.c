#include "overlay_draw.h"

#define STB_IMAGE_IMPLEMENTATION
#define STBI_ONLY_PNG
#define STBI_NO_STDIO
#define STBI_NO_HDR
#define STBI_NO_LINEAR
#include "vendor/stb_image.h"

#include "cursor_png.h"
#include "vendor/font8x8_basic.h"

#include <math.h>
#include <stdlib.h>
#include <string.h>

static uint8_t *g_src_rgba;
static int g_src_w;
static int g_src_h;
static uint8_t *g_mask;
static int g_mask_size;
static int g_hot_x;
static int g_hot_y;

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
  uint8_t a = (uint8_t)(argb >> 24);
  if (a == 0) return;
  if (a == 255) {
    px[y * w + x] = argb;
    return;
  }
  uint32_t dst = px[y * w + x];
  uint8_t da = (uint8_t)(dst >> 24);
  uint8_t inv = (uint8_t)(255 - a);
  uint8_t out_a = (uint8_t)(a + (uint16_t)da * inv / 255);
  uint8_t r = (uint8_t)(((argb >> 16) & 0xff) + ((dst >> 16) & 0xff) * inv / 255);
  uint8_t g = (uint8_t)(((argb >> 8) & 0xff) + ((dst >> 8) & 0xff) * inv / 255);
  uint8_t b = (uint8_t)((argb & 0xff) + (dst & 0xff) * inv / 255);
  px[y * w + x] = ((uint32_t)out_a << 24) | ((uint32_t)r << 16) | ((uint32_t)g << 8) | b;
}

static int cursor_size_for(int width, int height) {
  int short_edge = width < height ? width : height;
  if (short_edge < 1) short_edge = 1080;
  int size = (int)lroundf(24.f * (float)short_edge / 1080.f);
  if (size < 16) size = 16;
  if (size > 64) size = 64;
  return size;
}

static int load_cursor_png(void) {
  if (g_src_rgba) return 1;
  int n = 0;
  g_src_rgba = stbi_load_from_memory(cursor_png, (int)cursor_png_len, &g_src_w, &g_src_h, &n, 4);
  return g_src_rgba != NULL && g_src_w > 0 && g_src_h > 0;
}

static void ensure_mask(int size) {
  if (g_mask && g_mask_size == size) return;
  free(g_mask);
  g_mask = calloc((size_t)size * (size_t)size, 1);
  g_mask_size = size;
  g_hot_x = 0;
  g_hot_y = 0;
  if (!g_mask || !g_src_rgba) return;
  for (int y = 0; y < size; y++) {
    float v = ((float)y + 0.5f) * (float)g_src_h / (float)size - 0.5f;
    int y0 = (int)floorf(v);
    int y1 = y0 + 1;
    float fy = v - (float)y0;
    if (y0 < 0) {
      y0 = 0;
      fy = 0;
    }
    if (y1 >= g_src_h) y1 = g_src_h - 1;
    for (int x = 0; x < size; x++) {
      float u = ((float)x + 0.5f) * (float)g_src_w / (float)size - 0.5f;
      int x0 = (int)floorf(u);
      int x1 = x0 + 1;
      float fx = u - (float)x0;
      if (x0 < 0) {
        x0 = 0;
        fx = 0;
      }
      if (x1 >= g_src_w) x1 = g_src_w - 1;
      float a00 = g_src_rgba[(y0 * g_src_w + x0) * 4 + 3];
      float a10 = g_src_rgba[(y0 * g_src_w + x1) * 4 + 3];
      float a01 = g_src_rgba[(y1 * g_src_w + x0) * 4 + 3];
      float a11 = g_src_rgba[(y1 * g_src_w + x1) * 4 + 3];
      float a = a00 * (1.f - fx) * (1.f - fy) + a10 * fx * (1.f - fy) + a01 * (1.f - fx) * fy + a11 * fx * fy;
      g_mask[y * size + x] = (uint8_t)lroundf(a);
    }
  }
  for (int y = 0; y < size; y++) {
    for (int x = 0; x < size; x++) {
      if (g_mask[y * size + x] > 32) {
        g_hot_x = x;
        g_hot_y = y;
        return;
      }
    }
  }
}

static void draw_pointer_fallback(uint32_t *px, int w, int h, int x, int y, uint32_t rgb, int size) {
  uint32_t fill = premul(rgb, 255);
  uint32_t edge = premul(0x000000, 220);
  int hgt = size < 12 ? 12 : size;
  for (int i = 0; i < hgt; i++) {
    int span = i / 2 + 1;
    for (int j = 0; j <= span; j++) {
      uint32_t c = (j == 0 || j == span || i == hgt - 1) ? edge : fill;
      put_px(px, w, h, x + j, y + i, c);
    }
  }
}

static void draw_cursor_sprite(uint32_t *px, int w, int h, int ox, int oy, uint32_t rgb) {
  if (!g_mask) return;
  for (int y = 0; y < g_mask_size; y++) {
    for (int x = 0; x < g_mask_size; x++) {
      uint8_t a = g_mask[y * g_mask_size + x];
      if (!a) continue;
      put_px(px, w, h, ox + x, oy + y, premul(rgb, a));
    }
  }
}

static unsigned glyph_index(unsigned char c) {
  if (c < 32 || c > 127) return (unsigned)'?';
  return c;
}

static void draw_label(uint32_t *px, int w, int h, int x, int y, const char *label, uint32_t rgb) {
  if (!label || !label[0]) return;
  int len = 0;
  while (label[len] && len < 24) len++;
  uint32_t ink = premul(rgb, 255);
  uint32_t outline = premul(0x000000, 230);
  for (int i = 0; i < len; i++) {
    const char *row = font8x8_basic[glyph_index((unsigned char)label[i])];
    int gx = x + i * 8;
    for (int row_i = 0; row_i < 8; row_i++) {
      unsigned bits = (unsigned char)row[row_i];
      for (int col = 0; col < 8; col++) {
        if (((bits >> col) & 1u) == 0) continue;
        int px_x = gx + col;
        int px_y = y + row_i;
        for (int dy = -1; dy <= 1; dy++) {
          for (int dx = -1; dx <= 1; dx++) {
            if (dx == 0 && dy == 0) continue;
            put_px(px, w, h, px_x + dx, px_y + dy, outline);
          }
        }
      }
    }
    for (int row_i = 0; row_i < 8; row_i++) {
      unsigned bits = (unsigned char)row[row_i];
      for (int col = 0; col < 8; col++) {
        if (((bits >> col) & 1u) == 0) continue;
        put_px(px, w, h, gx + col, y + row_i, ink);
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
  if (!source || !cursors || n <= 0) return;
  int size = cursor_size_for(width, height);
  int have_asset = load_cursor_png();
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
    float ping_scale = cursors[i].ping_scale;
    if (ping_scale < 1.f) ping_scale = 1.f;
    if (ping_scale > 2.f) ping_scale = 2.f;
    int draw_size = (int)lroundf((float)size * ping_scale);
    if (draw_size < 16) draw_size = 16;
    if (draw_size > 128) draw_size = 128;
    if (have_asset) ensure_mask(draw_size);
    int ox;
    int oy;
    if (have_asset && g_mask) {
      ox = x - g_hot_x;
      oy = y - g_hot_y;
      draw_cursor_sprite(px, width, height, ox, oy, rgb);
    } else {
      ox = x;
      oy = y;
      draw_pointer_fallback(px, width, height, x, y, rgb, draw_size);
    }
    draw_label(px, width, height, ox, oy + draw_size + 2, cursors[i].label, rgb);
  }
}
