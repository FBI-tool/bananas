#import "overlay_native.h"
#import "overlay_draw.h"

#import <Cocoa/Cocoa.h>
#import <ApplicationServices/ApplicationServices.h>
#import <math.h>
#import <stdio.h>
#import <stdlib.h>
#import <string.h>

#define MAX_OVERLAYS 4
#define MAX_CURSORS 32

static volatile int g_display_stale;

static void display_reconfig(CGDirectDisplayID display, CGDisplayChangeSummaryFlags flags, void *user) {
  (void)display;
  (void)user;
  if (flags & kCGDisplayBeginConfigurationFlag) return;
  g_display_stale = 1;
}

void native_macos_ensure_app(void) {
  static int once = 0;
  if (once) return;
  once = 1;
  [NSApplication sharedApplication];
  [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
  CGDisplayRegisterReconfigurationCallback(display_reconfig, NULL);
}

typedef struct Overlay {
  int in_use;
  int id;
  NativeSource source;
  NativeCursor cursors[MAX_CURSORS];
  int cursor_count;
  uint8_t *pixels;
  int pw;
  int ph;
  void *window;
  void *view;
  int hidden;
  int place_logged;
  int place_w;
  int place_h;
  int place_x;
  int place_y;
} Overlay;

static Overlay g_overlays[MAX_OVERLAYS];
static int g_next_id = 1;

@interface KiwiOverlayWindow : NSWindow
@end

@implementation KiwiOverlayWindow
- (BOOL)canBecomeKeyWindow {
  return NO;
}
- (BOOL)canBecomeMainWindow {
  return NO;
}
@end

@interface KiwiOverlayView : NSView
@property Overlay *overlay;
@end

@implementation KiwiOverlayView
- (BOOL)acceptsFirstResponder {
  return NO;
}
- (BOOL)acceptsFirstMouse:(NSEvent *)event {
  (void)event;
  return NO;
}
- (void)drawRect:(NSRect)dirtyRect {
  (void)dirtyRect;
  Overlay *o = self.overlay;
  if (!o || !o->pixels) return;
  CGColorSpaceRef space = CGColorSpaceCreateDeviceRGB();
  CGContextRef ctx = CGBitmapContextCreate(
      o->pixels,
      (size_t)o->pw,
      (size_t)o->ph,
      8,
      (size_t)o->pw * 4,
      space,
      kCGImageAlphaPremultipliedFirst | kCGBitmapByteOrder32Little);
  CGImageRef image = CGBitmapContextCreateImage(ctx);
  NSGraphicsContext *nsctx = [NSGraphicsContext currentContext];
  CGContextRef draw = nsctx.CGContext;
  NSRect bounds = self.bounds;
  CGContextSetInterpolationQuality(draw, kCGInterpolationHigh);
  CGContextDrawImage(draw, CGRectMake(0, 0, bounds.size.width, bounds.size.height), image);
  CGImageRelease(image);
  CGContextRelease(ctx);
  CGColorSpaceRelease(space);
}
@end

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

static int iabs(int v) { return v < 0 ? -v : v; }

/* Matches cocoa_frame_from_top_left in coords.odin. */
static NSRect cocoa_frame_for_source(const NativeSource *source) {
  int w = source->width > 0 ? source->width : 1;
  int h = source->height > 0 ? source->height : 1;
  int primary = 0;
  NSArray<NSScreen *> *screens = [NSScreen screens];
  if (screens.count > 0) primary = (int)llround(NSMaxY(screens[0].frame));
  int y = primary - (source->y + h);
  return NSMakeRect(source->x, y, w, h);
}

typedef struct MacPlacement {
  NSRect frame;
  int bw;
  int bh;
  float scale;
  int matched;
} MacPlacement;

/* Electron bounds only choose the NSScreen. The window is that screen's
 * point frame; the bitmap uses its backingScaleFactor. */
static MacPlacement macos_placement(const NativeSource *source) {
  int hw = source && source->width > 0 ? source->width : 1;
  int hh = source && source->height > 0 ? source->height : 1;
  int hx = source ? source->x : 0;
  int hy = source ? source->y : 0;
  NSArray<NSScreen *> *screens = [NSScreen screens];
  int primary = 0;
  if (screens.count > 0) primary = (int)llround(NSMaxY(screens[0].frame));
  int best = 0x7fffffff;
  NSScreen *picked = nil;
  for (NSScreen *screen in screens) {
    NSRect frame = screen.frame;
    int lw = (int)llround(frame.size.width);
    int lh = (int)llround(frame.size.height);
    if (lw < 1 || lh < 1) continue;
    int lx = (int)llround(frame.origin.x);
    int top = primary - (int)llround(NSMaxY(frame));
    CGFloat backing = screen.backingScaleFactor > 0 ? screen.backingScaleFactor : 1;
    int pw = (int)llround(frame.size.width * backing);
    int ph = (int)llround(frame.size.height * backing);
    int origin = iabs(lx - hx) + iabs(top - hy);
    int score = 0x7fffffff;
    if (overlay_sizes_share_ratio(lw, lh, hw, hh, NULL)) score = origin;
    if (overlay_sizes_share_ratio(pw, ph, hw, hh, NULL) && origin < score) score = origin;
    if (score < best) {
      best = score;
      picked = screen;
    }
  }
  MacPlacement place;
  memset(&place, 0, sizeof(place));
  if (picked && best != 0x7fffffff) {
    place.matched = 1;
    place.frame = picked.frame;
    CGFloat backing = picked.backingScaleFactor > 0 ? picked.backingScaleFactor : 1;
    place.scale = (float)backing;
    place.bw = (int)llround(place.frame.size.width * backing);
    place.bh = (int)llround(place.frame.size.height * backing);
  } else {
    place.frame = cocoa_frame_for_source(source);
    overlay_physical_size(source, &place.bw, &place.bh);
    place.scale = source && source->scale > 1.f ? source->scale : 1.f;
  }
  if (place.bw < 1) place.bw = 1;
  if (place.bh < 1) place.bh = 1;
  if (place.scale < 1.f) place.scale = 1.f;
  return place;
}

static int macos_foreign_window(const char *id, int *x, int *y, int *w, int *h) {
  char *end = NULL;
  unsigned long long raw;
  CFArrayRef list;
  int ok = 0;
  if (!id || !id[0] || !x || !y || !w || !h) return 0;
  raw = strtoull(id, &end, 10);
  if (!raw) return 0;
  list = CGWindowListCopyWindowInfo(kCGWindowListOptionIncludingWindow, (CGWindowID)raw);
  if (!list) return 0;
  if (CFArrayGetCount(list) > 0) {
    CFDictionaryRef info = CFArrayGetValueAtIndex(list, 0);
    CFDictionaryRef bounds = CFDictionaryGetValue(info, kCGWindowBounds);
    CGRect rect = CGRectZero;
    if (bounds && CGRectMakeWithDictionaryRepresentation(bounds, &rect)) {
      *x = (int)llround(rect.origin.x);
      *y = (int)llround(rect.origin.y);
      *w = (int)llround(rect.size.width);
      *h = (int)llround(rect.size.height);
      ok = *w > 0 && *h > 0;
    }
  }
  CFRelease(list);
  return ok;
}

void native_refresh_capture(NativeSource *source, int mx, int my, int mw, int mh) {
  int gx = 0;
  int gy = 0;
  int gw = 0;
  int gh = 0;
  if (!source || !source->window_id[0]) return;
  if (!macos_foreign_window(source->window_id, &gx, &gy, &gw, &gh)) return;
  overlay_set_capture_from_pointer(source, mx, my, mw, mh, gx, gy, gw, gh);
}

/* CGEvent positions are top-left points. The overlay window is the same screen in Cocoa points. */
int native_display_rect(const NativeSource *source, int *x, int *y, int *w, int *h) {
  MacPlacement place;
  NSArray<NSScreen *> *screens;
  int primary = 0;
  int left;
  int width;
  int height;
  int bottom;
  if (!x || !y || !w || !h) return 0;
  place = macos_placement(source);
  screens = [NSScreen screens];
  if (screens.count > 0) primary = (int)llround(NSMaxY(screens[0].frame));
  left = (int)llround(place.frame.origin.x);
  width = (int)llround(place.frame.size.width);
  height = (int)llround(place.frame.size.height);
  bottom = (int)llround(place.frame.origin.y);
  if (width < 1) width = 1;
  if (height < 1) height = 1;
  *x = left;
  *y = primary - (bottom + height);
  *w = width;
  *h = height;
  return place.matched;
}

static void log_macos_placement(Overlay *o, const MacPlacement *place) {
  int fx = (int)llround(place->frame.origin.x);
  int fy = (int)llround(place->frame.origin.y);
  if (o->place_logged && o->place_w == place->bw && o->place_h == place->bh && o->place_x == fx && o->place_y == fy) {
    return;
  }
  o->place_logged = 1;
  o->place_w = place->bw;
  o->place_h = place->bh;
  o->place_x = fx;
  o->place_y = fy;
  const NativeSource *source = &o->source;
  if (place->matched) {
    fprintf(stderr,
            "p2p.kiwi sidecar: macos overlay screen %dx%d at %d,%d scale %.2f (electron %dx%d at %d,%d scale %.2f)\n",
            place->bw, place->bh, fx, fy, place->scale, source->width, source->height, source->x, source->y,
            source->scale);
  } else {
    fprintf(stderr, "p2p.kiwi sidecar: macos overlay electron %dx%d at %d,%d scale %.2f (no screen match)\n",
            source->width, source->height, source->x, source->y, source->scale);
  }
}

static void apply_contents_scale(KiwiOverlayView *view, float scale) {
  if (scale < 1.f) scale = 1.f;
  view.wantsLayer = YES;
  view.layer.contentsScale = scale;
}

static void hide_overlays_for_display_change(void) {
  for (int i = 0; i < MAX_OVERLAYS; i++) {
    if (!g_overlays[i].in_use || !g_overlays[i].window) continue;
    g_overlays[i].hidden = 1;
    NSWindow *win = (__bridge NSWindow *)g_overlays[i].window;
    [win orderOut:nil];
  }
}

void native_query_caps(NativeCaps *out) {
  memset(out, 0, sizeof(*out));
  native_macos_ensure_app();
  out->overlays = 1;
  out->click_through = 1;
  out->display_enumeration = 1;
  out->screen_recording = 3;
  out->input_monitoring = 0;
  snprintf(out->backend, sizeof(out->backend), "macos");
}

int native_overlay_create(const NativeSource *source) {
  native_macos_ensure_app();
  Overlay *o = alloc_overlay();
  if (!o) return 0;
  o->source = *source;
  MacPlacement place = macos_placement(source);
  log_macos_placement(o, &place);
  int w = place.bw;
  int h = place.bh;
  o->pw = w;
  o->ph = h;
  o->pixels = calloc((size_t)w * (size_t)h, 4);
  NSRect frame = place.frame;
  KiwiOverlayWindow *win = [[KiwiOverlayWindow alloc] initWithContentRect:frame
                                                                 styleMask:NSWindowStyleMaskBorderless
                                                                   backing:NSBackingStoreBuffered
                                                                     defer:NO];
  [win setOpaque:NO];
  [win setBackgroundColor:[NSColor clearColor]];
  [win setHasShadow:NO];
  [win setLevel:NSPopUpMenuWindowLevel];
  [win setIgnoresMouseEvents:YES];
  [win setHidesOnDeactivate:NO];
  [win setCollectionBehavior:NSWindowCollectionBehaviorCanJoinAllSpaces |
                             NSWindowCollectionBehaviorFullScreenAuxiliary |
                             NSWindowCollectionBehaviorStationary |
                             NSWindowCollectionBehaviorIgnoresCycle];
  [win setSharingType:NSWindowSharingNone];
  KiwiOverlayView *view = [[KiwiOverlayView alloc] initWithFrame:NSMakeRect(0, 0, frame.size.width, frame.size.height)];
  view.overlay = o;
  apply_contents_scale(view, place.scale);
  [win setContentView:view];
  [win orderFrontRegardless];
  [win setAcceptsMouseMovedEvents:NO];
  o->window = (__bridge_retained void *)win;
  o->view = (__bridge void *)view;
  o->hidden = 0;
  overlay_draw_clear(o->pixels, w, h);
  [view setNeedsDisplay:YES];
  return o->id;
}

int native_overlay_update(int overlay_id, const NativeSource *source, const NativeCursor *cursors, int n) {
  Overlay *o = find_overlay(overlay_id);
  if (!o) return 0;
  if (source) o->source = *source;
  o->cursor_count = n > MAX_CURSORS ? MAX_CURSORS : n;
  if (cursors && o->cursor_count > 0) memcpy(o->cursors, cursors, sizeof(NativeCursor) * (size_t)o->cursor_count);
  MacPlacement place = macos_placement(&o->source);
  log_macos_placement(o, &place);
  int w = place.bw;
  int h = place.bh;
  if (w != o->pw || h != o->ph) {
    free(o->pixels);
    o->pixels = calloc((size_t)w * (size_t)h, 4);
    o->pw = w;
    o->ph = h;
  }
  {
    int mx = 0;
    int my = 0;
    int mw = 1;
    int mh = 1;
    native_display_rect(&o->source, &mx, &my, &mw, &mh);
    native_refresh_capture(&o->source, mx, my, mw, mh);
  }
  overlay_draw_cursors(o->pixels, o->pw, o->ph, &o->source, o->cursors, o->cursor_count);
  NSWindow *win = (__bridge NSWindow *)o->window;
  KiwiOverlayView *view = (__bridge KiwiOverlayView *)o->view;
  NSRect frame = place.frame;
  [win setFrame:frame display:YES];
  [view setFrame:NSMakeRect(0, 0, frame.size.width, frame.size.height)];
  apply_contents_scale(view, place.scale);
  o->hidden = 0;
  [win orderFrontRegardless];
  [view setNeedsDisplay:YES];
  return 1;
}

void native_overlay_destroy(int overlay_id) {
  Overlay *o = find_overlay(overlay_id);
  if (!o) return;
  if (o->window) {
    NSWindow *win = (__bridge_transfer NSWindow *)o->window;
    [win close];
  }
  free(o->pixels);
  memset(o, 0, sizeof(*o));
}

void native_overlay_pump(void) {
  native_macos_ensure_app();
  if (g_display_stale) {
    g_display_stale = 0;
    hide_overlays_for_display_change();
  }
  NSEvent *event;
  NSDate *until = [NSDate distantPast];
  while ((event = [NSApp nextEventMatchingMask:NSEventMaskAny
                                     untilDate:until
                                        inMode:NSDefaultRunLoopMode
                                       dequeue:YES])) {
    [NSApp sendEvent:event];
  }
}

void native_shutdown(void) {
  for (int i = 0; i < MAX_OVERLAYS; i++) {
    if (g_overlays[i].in_use) native_overlay_destroy(g_overlays[i].id);
  }
}
