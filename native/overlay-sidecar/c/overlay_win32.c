#include "overlay_native.h"
#include "overlay_draw.h"

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <dwmapi.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>

#define MAX_OVERLAYS 4
#define MAX_CURSORS 32

typedef struct Overlay {
  int in_use;
  int id;
  HWND hwnd;
  NativeSource source;
  NativeCursor cursors[MAX_CURSORS];
  int cursor_count;
  uint8_t *pixels;
  int pw;
  int ph;
  int place_logged;
  int place_x;
  int place_y;
  int place_w;
  int place_h;
} Overlay;

static Overlay g_overlays[MAX_OVERLAYS];
static int g_next_id = 1;
static const char *CLASS_NAME = "P2PKiwiOverlay";
static int g_class_registered = 0;

static Overlay *find_overlay(int id) {
  for (int i = 0; i < MAX_OVERLAYS; i++) {
    if (g_overlays[i].in_use && g_overlays[i].id == id) return &g_overlays[i];
  }
  return NULL;
}

static Overlay *alloc_overlay(void) {
  for (int i = 0; i < MAX_OVERLAYS; i++) {
    if (!g_overlays[i].in_use) {
      memset(&g_overlays[i], 0, sizeof(Overlay));
      g_overlays[i].in_use = 1;
      g_overlays[i].id = g_next_id++;
      return &g_overlays[i];
    }
  }
  return NULL;
}

static LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
  if (msg == WM_NCHITTEST) return HTTRANSPARENT;
  if (msg == WM_ACTIVATE || msg == WM_MOUSEACTIVATE) return MA_NOACTIVATE;
  return DefWindowProc(hwnd, msg, wParam, lParam);
}

static int iabs(int v) { return v < 0 ? -v : v; }

typedef struct WinEnumCtx {
  const NativeSource *source;
  int found;
  int score;
  int x;
  int y;
  int w;
  int h;
} WinEnumCtx;

static BOOL CALLBACK monitor_enum(HMONITOR monitor, HDC hdc, LPRECT rect, LPARAM param) {
  (void)monitor;
  (void)hdc;
  WinEnumCtx *ctx = (WinEnumCtx *)param;
  if (!ctx || !ctx->source || !rect) return TRUE;
  int ow = rect->right - rect->left;
  int oh = rect->bottom - rect->top;
  int hw = ctx->source->width > 0 ? ctx->source->width : 1;
  int hh = ctx->source->height > 0 ? ctx->source->height : 1;
  float ratio = 1.f;
  if (!overlay_sizes_share_ratio(ow, oh, hw, hh, &ratio)) return TRUE;
  int ex = (int)llroundf((float)ctx->source->x * ratio);
  int ey = (int)llroundf((float)ctx->source->y * ratio);
  int origin = iabs(rect->left - ex) + iabs(rect->top - ey);
  float hint = ctx->source->scale > 0.f ? ctx->source->scale : 1.f;
  int bias = (int)llroundf(fabsf(ratio - hint) * 100.f);
  int score = origin * 1000 + bias;
  if (!ctx->found || score < ctx->score) {
    ctx->found = 1;
    ctx->score = score;
    ctx->x = rect->left;
    ctx->y = rect->top;
    ctx->w = ow;
    ctx->h = oh;
  }
  return TRUE;
}

static void win_rect_fallback(const NativeSource *source, int *x, int *y, int *w, int *h) {
  float scale = source && source->scale > 1.f ? source->scale : 1.f;
  int sx = source ? source->x : 0;
  int sy = source ? source->y : 0;
  *x = (int)llroundf((float)sx * scale);
  *y = (int)llroundf((float)sy * scale);
  overlay_physical_size(source, w, h);
}

/* rcMonitor is physical pixels under per-monitor DPI awareness. Electron
 * bounds only choose which monitor. */
static int win_rect(const NativeSource *source, int *x, int *y, int *w, int *h) {
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  WinEnumCtx ctx;
  memset(&ctx, 0, sizeof(ctx));
  ctx.source = source;
  EnumDisplayMonitors(NULL, NULL, monitor_enum, (LPARAM)&ctx);
  if (ctx.found && ctx.w > 0 && ctx.h > 0) {
    *x = ctx.x;
    *y = ctx.y;
    *w = ctx.w;
    *h = ctx.h;
    return 1;
  }
  win_rect_fallback(source, x, y, w, h);
  return 0;
}

int native_display_rect(const NativeSource *source, int *x, int *y, int *w, int *h) {
  if (!x || !y || !w || !h) return 0;
  return win_rect(source, x, y, w, h);
}

static void log_win_placement(Overlay *o, int matched, int x, int y, int w, int h) {
  if (o->place_logged && o->place_x == x && o->place_y == y && o->place_w == w && o->place_h == h) return;
  o->place_logged = 1;
  o->place_x = x;
  o->place_y = y;
  o->place_w = w;
  o->place_h = h;
  const NativeSource *source = &o->source;
  if (matched) {
    fprintf(stderr,
            "p2p.kiwi sidecar: windows overlay monitor %dx%d at %d,%d (electron %dx%d at %d,%d scale %.2f)\n", w, h,
            x, y, source->width, source->height, source->x, source->y, source->scale);
  } else {
    fprintf(stderr, "p2p.kiwi sidecar: windows overlay electron %dx%d at %d,%d scale %.2f (no monitor match)\n",
            source->width, source->height, source->x, source->y, source->scale);
  }
}

static void register_class(void) {
  if (g_class_registered) return;
  WNDCLASSA wc;
  memset(&wc, 0, sizeof(wc));
  wc.lpfnWndProc = WndProc;
  wc.hInstance = GetModuleHandle(NULL);
  wc.lpszClassName = CLASS_NAME;
  wc.hCursor = LoadCursor(NULL, IDC_ARROW);
  RegisterClassA(&wc);
  g_class_registered = 1;
}

static void present(Overlay *o) {
  if (!o->hwnd || !o->pixels) return;
  BITMAPINFO bmi;
  memset(&bmi, 0, sizeof(bmi));
  bmi.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
  bmi.bmiHeader.biWidth = o->pw;
  bmi.bmiHeader.biHeight = -o->ph;
  bmi.bmiHeader.biPlanes = 1;
  bmi.bmiHeader.biBitCount = 32;
  bmi.bmiHeader.biCompression = BI_RGB;
  HDC screen = GetDC(NULL);
  HDC mem = CreateCompatibleDC(screen);
  void *bits = NULL;
  HBITMAP dib = CreateDIBSection(mem, &bmi, DIB_RGB_COLORS, &bits, NULL, 0);
  if (dib && bits) {
    memcpy(bits, o->pixels, (size_t)o->pw * (size_t)o->ph * 4);
    HGDIOBJ old = SelectObject(mem, dib);
    int place_x = 0;
    int place_y = 0;
    int place_w = o->pw;
    int place_h = o->ph;
    (void)win_rect(&o->source, &place_x, &place_y, &place_w, &place_h);
    SIZE size = {place_w, place_h};
    POINT src = {0, 0};
    POINT dst = {place_x, place_y};
    BLENDFUNCTION blend;
    blend.BlendOp = AC_SRC_OVER;
    blend.BlendFlags = 0;
    blend.SourceConstantAlpha = 255;
    blend.AlphaFormat = AC_SRC_ALPHA;
    UpdateLayeredWindow(o->hwnd, screen, &dst, &size, mem, &src, 0, &blend, ULW_ALPHA);
    SelectObject(mem, old);
  }
  if (dib) DeleteObject(dib);
  DeleteDC(mem);
  ReleaseDC(NULL, screen);
}

void native_query_caps(NativeCaps *out) {
  memset(out, 0, sizeof(*out));
  out->overlays = 1;
  out->click_through = 1;
  out->display_enumeration = 1;
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
}

int native_overlay_create(const NativeSource *source) {
  Overlay *o = alloc_overlay();
  if (!o) return 0;
  register_class();
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  o->source = *source;
  int x = 0;
  int y = 0;
  int w = 1;
  int h = 1;
  int matched = win_rect(source, &x, &y, &w, &h);
  log_win_placement(o, matched, x, y, w, h);
  HWND hwnd = CreateWindowExA(
      WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE | WS_EX_TOPMOST | WS_EX_TOOLWINDOW,
      CLASS_NAME,
      "p2p.kiwi overlay",
      WS_POPUP,
      x,
      y,
      w,
      h,
      NULL,
      NULL,
      GetModuleHandle(NULL),
      NULL);
  if (!hwnd) {
    o->in_use = 0;
    return 0;
  }
  ShowWindow(hwnd, SW_SHOWNOACTIVATE);
  SetWindowPos(hwnd, HWND_TOPMOST, x, y, w, h, SWP_NOACTIVATE | SWP_SHOWWINDOW);
  o->hwnd = hwnd;
  o->pw = w;
  o->ph = h;
  o->pixels = calloc((size_t)w * (size_t)h, 4);
  overlay_draw_clear(o->pixels, w, h);
  present(o);
  return o->id;
}

int native_overlay_update(int overlay_id, const NativeSource *source, const NativeCursor *cursors, int n) {
  Overlay *o = find_overlay(overlay_id);
  if (!o) return 0;
  if (source) o->source = *source;
  o->cursor_count = n > MAX_CURSORS ? MAX_CURSORS : n;
  if (cursors && o->cursor_count > 0) memcpy(o->cursors, cursors, sizeof(NativeCursor) * (size_t)o->cursor_count);
  int x = 0;
  int y = 0;
  int w = 1;
  int h = 1;
  int matched = win_rect(&o->source, &x, &y, &w, &h);
  log_win_placement(o, matched, x, y, w, h);
  if (w != o->pw || h != o->ph) {
    free(o->pixels);
    o->pixels = calloc((size_t)w * (size_t)h, 4);
    o->pw = w;
    o->ph = h;
    SetWindowPos(o->hwnd, HWND_TOPMOST, x, y, w, h, SWP_NOACTIVATE);
  } else {
    SetWindowPos(o->hwnd, HWND_TOPMOST, x, y, w, h, SWP_NOACTIVATE | SWP_NOSIZE);
  }
  overlay_draw_cursors(o->pixels, o->pw, o->ph, &o->source, o->cursors, o->cursor_count);
  present(o);
  return 1;
}

void native_overlay_destroy(int overlay_id) {
  Overlay *o = find_overlay(overlay_id);
  if (!o) return;
  if (o->hwnd) DestroyWindow(o->hwnd);
  free(o->pixels);
  memset(o, 0, sizeof(*o));
}

void native_overlay_pump(void) {
  MSG msg;
  while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
    TranslateMessage(&msg);
    DispatchMessage(&msg);
  }
}

void native_shutdown(void) {
  for (int i = 0; i < MAX_OVERLAYS; i++) {
    if (g_overlays[i].in_use) native_overlay_destroy(g_overlays[i].id);
  }
}
