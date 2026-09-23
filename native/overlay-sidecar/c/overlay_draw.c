#include "overlay_draw.h"

#define STB_IMAGE_IMPLEMENTATION
#define STBI_ONLY_PNG
#define STBI_NO_STDIO
#define STBI_NO_HDR
#define STBI_NO_LINEAR
#include "vendor/stb_image.h"

#include "cursor_png.h"
#include "maple_mono.h"
#include "vendor/font8x8_basic.h"

#define STB_TRUETYPE_IMPLEMENTATION
#include "vendor/stb_truetype.h"

#include <math.h>
#include <stdlib.h>
#include <string.h>

static uint8_t *g_src_rgba;
static int g_src_w;
static int g_src_h;
static uint8_t *g_alpha;
static uint8_t *g_lum;
static int g_mask_size;
static int g_hot_x;
static int g_hot_y;

static stbtt_fontinfo g_font;
static int g_font_ready;
static int g_font_failed;

#define GLYPH_CACHE 512

typedef struct {
  int cp;
  int px;
  int w;
  int h;
  int xoff;
  int yoff;
  int advance;
  unsigned char *bmp;
} Glyph;

static Glyph g_glyphs[GLYPH_CACHE];
static int g_glyph_n;
static int g_glyph_px;

static uint32_t premul(uint32_t rgb, uint8_t a) {
  uint8_t r = (uint8_t)(((rgb >> 16) & 0xff) * a / 255);
  uint8_t g = (uint8_t)(((rgb >> 8) & 0xff) * a / 255);
  uint8_t b = (uint8_t)((rgb & 0xff) * a / 255);
  return ((uint32_t)a << 24) | ((uint32_t)r << 16) | ((uint32_t)g << 8) | b;
}

int overlay_sizes_share_ratio(int ow, int oh, int hw, int hh, float *ratio_out) {
  if (ow < 1 || oh < 1 || hw < 1 || hh < 1) return 0;
  float wr = (float)ow / (float)hw;
  float hr = (float)oh / (float)hh;
  float ratio = (wr + hr) * 0.5f;
  if (ratio < 0.5f || ratio > 4.f) return 0;
  int ew = (int)llroundf((float)hw * ratio);
  int eh = (int)llroundf((float)hh * ratio);
  int dw = ow - ew;
  int dh = oh - eh;
  if (dw < 0) dw = -dw;
  if (dh < 0) dh = -dh;
  if (dw > 8 || dh > 8) return 0;
  if (ratio_out) *ratio_out = ratio;
  return 1;
}

void overlay_physical_size(const NativeSource *source, int *bw, int *bh) {
  float scale = 1.f;
  if (source && source->scale > 1.f) scale = source->scale;
  int w = source && source->width > 0 ? source->width : 1;
  int h = source && source->height > 0 ? source->height : 1;
  *bw = (int)llroundf((float)w * scale);
  *bh = (int)llroundf((float)h * scale);
  if (*bw < 1) *bw = 1;
  if (*bh < 1) *bh = 1;
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

static void sample_cursor(float u, float v, float *out_a, float *out_lum) {
  int x0 = (int)floorf(u);
  int y0 = (int)floorf(v);
  int x1 = x0 + 1;
  int y1 = y0 + 1;
  float fx = u - (float)x0;
  float fy = v - (float)y0;
  if (x0 < 0) {
    x0 = 0;
    fx = 0;
  }
  if (y0 < 0) {
    y0 = 0;
    fy = 0;
  }
  if (x1 >= g_src_w) x1 = g_src_w - 1;
  if (y1 >= g_src_h) y1 = g_src_h - 1;
  if (x0 >= g_src_w) x0 = g_src_w - 1;
  if (y0 >= g_src_h) y0 = g_src_h - 1;
  const uint8_t *p00 = g_src_rgba + (y0 * g_src_w + x0) * 4;
  const uint8_t *p10 = g_src_rgba + (y0 * g_src_w + x1) * 4;
  const uint8_t *p01 = g_src_rgba + (y1 * g_src_w + x0) * 4;
  const uint8_t *p11 = g_src_rgba + (y1 * g_src_w + x1) * 4;
  float w00 = (1.f - fx) * (1.f - fy);
  float w10 = fx * (1.f - fy);
  float w01 = (1.f - fx) * fy;
  float w11 = fx * fy;
  float a00 = p00[3];
  float a10 = p10[3];
  float a01 = p01[3];
  float a11 = p11[3];
  float a = a00 * w00 + a10 * w10 + a01 * w01 + a11 * w11;
  float lum00 = (p00[0] + p00[1] + p00[2]) / 3.f;
  float lum10 = (p10[0] + p10[1] + p10[2]) / 3.f;
  float lum01 = (p01[0] + p01[1] + p01[2]) / 3.f;
  float lum11 = (p11[0] + p11[1] + p11[2]) / 3.f;
  float weighted = lum00 * a00 * w00 + lum10 * a10 * w10 + lum01 * a01 * w01 + lum11 * a11 * w11;
  *out_a = a;
  *out_lum = a > 0.5f ? weighted / a : 255.f;
}

static void ensure_mask(int size) {
  if (g_alpha && g_lum && g_mask_size == size) return;
  free(g_alpha);
  free(g_lum);
  g_alpha = calloc((size_t)size * (size_t)size, 1);
  g_lum = calloc((size_t)size * (size_t)size, 1);
  g_mask_size = size;
  g_hot_x = 0;
  g_hot_y = 0;
  if (!g_alpha || !g_lum || !g_src_rgba) return;
  for (int y = 0; y < size; y++) {
    float v = ((float)y + 0.5f) * (float)g_src_h / (float)size - 0.5f;
    for (int x = 0; x < size; x++) {
      float u = ((float)x + 0.5f) * (float)g_src_w / (float)size - 0.5f;
      float a = 0.f;
      float lum = 255.f;
      sample_cursor(u, v, &a, &lum);
      if (a < 0.f) a = 0.f;
      if (a > 255.f) a = 255.f;
      if (lum < 0.f) lum = 0.f;
      if (lum > 255.f) lum = 255.f;
      g_alpha[y * size + x] = (uint8_t)lroundf(a);
      g_lum[y * size + x] = (uint8_t)lroundf(lum);
    }
  }
  for (int y = 0; y < size; y++) {
    for (int x = 0; x < size; x++) {
      if (g_alpha[y * size + x] > 32) {
        g_hot_x = x;
        g_hot_y = y;
        return;
      }
    }
  }
}

static void draw_pointer_fallback(uint32_t *px, int w, int h, int x, int y, uint32_t rgb, int size) {
  uint32_t fill = premul(0xffffff, 255);
  uint32_t edge = premul(rgb, 255);
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
  if (!g_alpha || !g_lum) return;
  uint32_t cr = (rgb >> 16) & 255u;
  uint32_t cg = (rgb >> 8) & 255u;
  uint32_t cb = rgb & 255u;
  for (int y = 0; y < g_mask_size; y++) {
    for (int x = 0; x < g_mask_size; x++) {
      uint8_t a = g_alpha[y * g_mask_size + x];
      if (!a) continue;
      uint32_t lum = g_lum[y * g_mask_size + x];
      uint32_t edge = 255u - lum;
      uint32_t r = (cr * edge + 255u * lum) / 255u;
      uint32_t g = (cg * edge + 255u * lum) / 255u;
      uint32_t b = (cb * edge + 255u * lum) / 255u;
      put_px(px, w, h, ox + x, oy + y, premul((r << 16) | (g << 8) | b, a));
    }
  }
}

static unsigned glyph_index(unsigned char c) {
  if (c < 32 || c > 127) return (unsigned)'?';
  return c;
}

static void fill_capsule(uint32_t *px, int bw, int bh, int x, int y, int rw, int rh, uint32_t rgb) {
  if (rw < 1 || rh < 1) return;
  float radius = (float)rh * 0.5f;
  if (radius > (float)rw * 0.5f) radius = (float)rw * 0.5f;
  float limit = radius * radius;
  uint32_t ink = premul(rgb, 255);
  for (int row = 0; row < rh; row++) {
    float cy = (float)row + 0.5f;
    float dy = 0.f;
    if (cy < radius) dy = radius - cy;
    else if (cy > (float)rh - radius) dy = cy - ((float)rh - radius);
    for (int col = 0; col < rw; col++) {
      float cx = (float)col + 0.5f;
      float dx = 0.f;
      if (cx < radius) dx = radius - cx;
      else if (cx > (float)rw - radius) dx = cx - ((float)rw - radius);
      if (dx * dx + dy * dy > limit) continue;
      put_px(px, bw, bh, x + col, y + row, ink);
    }
  }
}

static void draw_label_bitmap(
    uint32_t *px,
    int w,
    int h,
    int x,
    int y,
    const char *label,
    uint32_t foreground,
    uint32_t background) {
  if (!label || !label[0]) return;
  int len = 0;
  while (label[len] && len < 24) len++;
  int pad_x = 4;
  int pad_y = 2;
  int chip_w = len * 8 + pad_x * 2;
  int chip_h = 8 + pad_y * 2;
  int origin_x = x - chip_w / 2;
  fill_capsule(px, w, h, origin_x, y, chip_w, chip_h, background);
  uint32_t ink = premul(foreground, 255);
  for (int i = 0; i < len; i++) {
    const char *row = font8x8_basic[glyph_index((unsigned char)label[i])];
    int gx = origin_x + pad_x + i * 8;
    int gy = y + pad_y;
    for (int row_i = 0; row_i < 8; row_i++) {
      unsigned bits = (unsigned char)row[row_i];
      for (int col = 0; col < 8; col++) {
        if (((bits >> col) & 1u) == 0) continue;
        put_px(px, w, h, gx + col, gy + row_i, ink);
      }
    }
  }
}

static int ensure_font(void) {
  if (g_font_ready) return 1;
  if (g_font_failed) return 0;
  int offset = stbtt_GetFontOffsetForIndex(maple_mono_ttf, 0);
  if (offset < 0 || !stbtt_InitFont(&g_font, maple_mono_ttf, offset)) {
    g_font_failed = 1;
    return 0;
  }
  g_font_ready = 1;
  return 1;
}

static void clear_glyphs(void) {
  for (int i = 0; i < g_glyph_n; i++) free(g_glyphs[i].bmp);
  g_glyph_n = 0;
}

static int utf8_next(const char *s, int *i) {
  unsigned char c = (unsigned char)s[*i];
  if (c == 0) return -1;
  if (c < 0x80) {
    (*i)++;
    return c;
  }
  int need = c < 0xe0 ? 1 : c < 0xf0 ? 2 : 3;
  int cp = c < 0xe0 ? (c & 0x1f) : c < 0xf0 ? (c & 0x0f) : (c & 0x07);
  (*i)++;
  for (int n = 0; n < need; n++) {
    unsigned char cont = (unsigned char)s[*i];
    if ((cont & 0xc0) != 0x80) return 0xfffd;
    cp = (cp << 6) | (cont & 0x3f);
    (*i)++;
  }
  return cp;
}

static int font_px_for(int width, int height) {
  int short_edge = width < height ? width : height;
  if (short_edge < 1) short_edge = 1080;
  int px = (int)lroundf(15.f * (float)short_edge / 1080.f);
  if (px < 12) px = 12;
  if (px > 64) px = 64;
  return px;
}

static Glyph *glyph_for(int cp, int px) {
  for (int i = 0; i < g_glyph_n; i++) {
    if (g_glyphs[i].cp == cp && g_glyphs[i].px == px) return &g_glyphs[i];
  }
  if (g_glyph_n >= GLYPH_CACHE) {
    static Glyph empty;
    empty.cp = cp;
    empty.px = px;
    empty.w = 0;
    empty.h = 0;
    empty.xoff = 0;
    empty.yoff = 0;
    empty.advance = px > 1 ? px / 2 : 1;
    empty.bmp = NULL;
    return &empty;
  }
  int draw_cp = cp;
  if (stbtt_FindGlyphIndex(&g_font, draw_cp) == 0) draw_cp = '?';
  float scale = stbtt_ScaleForPixelHeight(&g_font, (float)px);
  int gw = 0;
  int gh = 0;
  int xoff = 0;
  int yoff = 0;
  unsigned char *bmp = stbtt_GetCodepointBitmap(&g_font, scale, scale, draw_cp, &gw, &gh, &xoff, &yoff);
  int adv = 0;
  int lsb = 0;
  stbtt_GetCodepointHMetrics(&g_font, draw_cp, &adv, &lsb);
  Glyph *g = &g_glyphs[g_glyph_n++];
  g->cp = cp;
  g->px = px;
  g->w = gw;
  g->h = gh;
  g->xoff = xoff;
  g->yoff = yoff;
  g->advance = (int)lroundf((float)adv * scale);
  if (g->advance < 1) g->advance = px / 2;
  if (g->advance < 1) g->advance = 1;
  g->bmp = bmp;
  return g;
}

static void blit_glyph(uint32_t *px, int w, int h, int x, int y, const Glyph *g, uint32_t rgb, int alpha_num) {
  if (!g || !g->bmp || g->w <= 0 || g->h <= 0) return;
  for (int row = 0; row < g->h; row++) {
    const unsigned char *src = g->bmp + row * g->w;
    for (int col = 0; col < g->w; col++) {
      unsigned cov = src[col];
      if (!cov) continue;
      unsigned a = cov * (unsigned)alpha_num / 255u;
      if (a > 255u) a = 255u;
      if (!a) continue;
      put_px(px, w, h, x + col, y + row, premul(rgb, (uint8_t)a));
    }
  }
}

static void draw_label(
    uint32_t *px,
    int w,
    int h,
    int x,
    int y,
    const char *label,
    uint32_t foreground,
    uint32_t background) {
  if (!label || !label[0]) return;
  if (!ensure_font()) {
    draw_label_bitmap(px, w, h, x, y, label, foreground, background);
    return;
  }
  int px_size = font_px_for(w, h);
  if (g_glyph_px != px_size) {
    clear_glyphs();
    g_glyph_px = px_size;
  }
  int ascent = 0;
  stbtt_GetFontVMetrics(&g_font, &ascent, NULL, NULL);
  float scale = stbtt_ScaleForPixelHeight(&g_font, (float)px_size);
  int baseline = (int)lroundf((float)ascent * scale);
  Glyph *glyphs[48];
  int n = 0;
  int i = 0;
  while (label[i] && n < 48) {
    int cp = utf8_next(label, &i);
    if (cp < 0) break;
    glyphs[n] = glyph_for(cp, px_size);
    n++;
  }
  if (n == 0) return;
  int text_w = 0;
  for (int g = 0; g < n; g++) text_w += glyphs[g]->advance;
  if (text_w < 1) text_w = 1;
  int pad_x = (int)lroundf((float)px_size * 0.45f);
  int pad_y = (int)lroundf((float)px_size * 0.22f);
  if (pad_x < 2) pad_x = 2;
  if (pad_y < 1) pad_y = 1;
  int chip_w = text_w + pad_x * 2;
  int chip_h = px_size + pad_y * 2;
  int origin_x = x - chip_w / 2;
  fill_capsule(px, w, h, origin_x, y, chip_w, chip_h, background);
  int pen = origin_x + pad_x;
  int top = y + pad_y;
  for (int g = 0; g < n; g++) {
    Glyph *glyph = glyphs[g];
    blit_glyph(px, w, h, pen + glyph->xoff, top + baseline + glyph->yoff, glyph, foreground, 255);
    pen += glyph->advance;
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
    uint32_t foreground = overlay_parse_color(cursors[i].foreground);
    uint32_t background = overlay_parse_color(cursors[i].background);
    float ping_scale = cursors[i].ping_scale;
    if (ping_scale < 1.f) ping_scale = 1.f;
    if (ping_scale > 2.f) ping_scale = 2.f;
    int draw_size = (int)lroundf((float)size * ping_scale);
    if (draw_size < 16) draw_size = 16;
    if (draw_size > 128) draw_size = 128;
    if (have_asset) ensure_mask(draw_size);
    int ox;
    int oy;
    if (have_asset && g_alpha) {
      ox = x - g_hot_x;
      oy = y - g_hot_y;
      draw_cursor_sprite(px, width, height, ox, oy, background);
    } else {
      ox = x;
      oy = y;
      draw_pointer_fallback(px, width, height, x, y, background, draw_size);
    }
    draw_label(px, width, height, x, oy + draw_size + 2, cursors[i].label, foreground, background);
  }
}
