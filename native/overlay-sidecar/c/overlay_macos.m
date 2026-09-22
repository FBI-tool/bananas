#import "overlay_native.h"
#import "overlay_draw.h"

#import <Cocoa/Cocoa.h>
#import <ApplicationServices/ApplicationServices.h>
#import <math.h>
#import <stdio.h>
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

static void bitmap_size_for_source(const NativeSource *source, int *bw, int *bh) {
  float scale = source->scale > 0.f ? source->scale : 1.f;
  if (scale < 1.f) scale = 1.f;
  int w = source->width > 0 ? source->width : 1;
  int h = source->height > 0 ? source->height : 1;
  *bw = (int)llroundf((float)w * scale);
  *bh = (int)llroundf((float)h * scale);
  if (*bw < 1) *bw = 1;
  if (*bh < 1) *bh = 1;
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
  int w = 1;
  int h = 1;
  bitmap_size_for_source(source, &w, &h);
  o->pw = w;
  o->ph = h;
  o->pixels = calloc((size_t)w * (size_t)h, 4);
  NSRect frame = cocoa_frame_for_source(source);
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
  int w = 1;
  int h = 1;
  bitmap_size_for_source(&o->source, &w, &h);
  if (w != o->pw || h != o->ph) {
    free(o->pixels);
    o->pixels = calloc((size_t)w * (size_t)h, 4);
    o->pw = w;
    o->ph = h;
  }
  overlay_draw_cursors(o->pixels, o->pw, o->ph, &o->source, o->cursors, o->cursor_count);
  NSWindow *win = (__bridge NSWindow *)o->window;
  KiwiOverlayView *view = (__bridge KiwiOverlayView *)o->view;
  NSRect frame = cocoa_frame_for_source(&o->source);
  [win setFrame:frame display:YES];
  [view setFrame:NSMakeRect(0, 0, frame.size.width, frame.size.height)];
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
