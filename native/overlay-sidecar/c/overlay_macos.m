#import "overlay_native.h"
#import "overlay_draw.h"

#import <Cocoa/Cocoa.h>
#import <ApplicationServices/ApplicationServices.h>

#define MAX_OVERLAYS 4
#define MAX_CURSORS 32

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
} Overlay;

static Overlay g_overlays[MAX_OVERLAYS];
static int g_next_id = 1;

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
  CGContextDrawImage(draw, CGRectMake(0, 0, o->pw, o->ph), image);
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

static int permission_state(CFStringRef key) {
  if (@available(macOS 10.14, *)) {
    NSDictionary *opts = @{(__bridge NSString *)kAXTrustedCheckOptionPrompt : @NO};
    Boolean trusted = AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)opts);
    if (key == kAXTrustedCheckOptionPrompt) return trusted ? 1 : 2;
  }
  (void)key;
  return 0;
}

void native_query_caps(NativeCaps *out) {
  memset(out, 0, sizeof(*out));
  out->overlays = 1;
  out->click_through = 1;
  out->display_enumeration = 1;
  out->accessibility = AXIsProcessTrusted() ? 1 : 2;
  out->screen_recording = 0;
  out->input_monitoring = 0;
}

int native_overlay_create(const NativeSource *source) {
  Overlay *o = alloc_overlay();
  if (!o) return 0;
  o->source = *source;
  int w = source->width > 0 ? source->width : 1;
  int h = source->height > 0 ? source->height : 1;
  o->pw = w;
  o->ph = h;
  o->pixels = calloc((size_t)w * (size_t)h, 4);
  NSRect frame = NSMakeRect(source->x, source->y, w, h);
  NSWindow *win = [[NSWindow alloc] initWithContentRect:frame
                                              styleMask:NSWindowStyleMaskBorderless
                                                backing:NSBackingStoreBuffered
                                                  defer:NO];
  [win setOpaque:NO];
  [win setBackgroundColor:[NSColor clearColor]];
  [win setHasShadow:NO];
  [win setLevel:NSScreenSaverWindowLevel];
  [win setIgnoresMouseEvents:YES];
  [win setHidesOnDeactivate:NO];
  [win setCollectionBehavior:NSWindowCollectionBehaviorCanJoinAllSpaces |
                             NSWindowCollectionBehaviorFullScreenAuxiliary |
                             NSWindowCollectionBehaviorStationary |
                             NSWindowCollectionBehaviorIgnoresCycle];
  [win setSharingType:NSWindowSharingNone];
  KiwiOverlayView *view = [[KiwiOverlayView alloc] initWithFrame:NSMakeRect(0, 0, w, h)];
  view.overlay = o;
  [win setContentView:view];
  [win orderFrontRegardless];
  [win setAcceptsMouseMovedEvents:NO];
  o->window = (__bridge_retained void *)win;
  o->view = (__bridge void *)view;
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
  int w = o->source.width > 0 ? o->source.width : 1;
  int h = o->source.height > 0 ? o->source.height : 1;
  if (w != o->pw || h != o->ph) {
    free(o->pixels);
    o->pixels = calloc((size_t)w * (size_t)h, 4);
    o->pw = w;
    o->ph = h;
  }
  overlay_draw_cursors(o->pixels, o->pw, o->ph, &o->source, o->cursors, o->cursor_count);
  NSWindow *win = (__bridge NSWindow *)o->window;
  KiwiOverlayView *view = (__bridge KiwiOverlayView *)o->view;
  [win setFrame:NSMakeRect(o->source.x, o->source.y, w, h) display:YES];
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
