#include "overlay_native.h"
#include "overlay_draw.h"

#include <X11/Xlib.h>
#include <X11/Xatom.h>
#include <X11/Xutil.h>
#include <X11/extensions/shape.h>
#include <X11/extensions/Xfixes.h>
#include <X11/extensions/Xrandr.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#ifdef HAVE_WAYLAND
#include <wayland-client.h>
#include "wlr-layer-shell-client-protocol.h"
#endif

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
  int is_wayland;
  Display *dpy;
  Window win;
  GC gc;
  XImage *img;
#ifdef HAVE_WAYLAND
  struct wl_display *wld;
  struct wl_surface *surface;
  struct zwlr_layer_surface_v1 *layer;
#endif
} Overlay;

static Overlay g_overlays[MAX_OVERLAYS];
static int g_next_id = 1;
static int g_wayland_session = 0;
static int g_wayland_layer_shell = 0;

static int env_set(const char *name) {
  const char *v = getenv(name);
  return v && v[0];
}

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

static void ensure_pixels(Overlay *o, int w, int h) {
  if (w < 1) w = 1;
  if (h < 1) h = 1;
  if (o->pixels && o->pw == w && o->ph == h) return;
  free(o->pixels);
  o->pixels = calloc((size_t)w * (size_t)h, 4);
  o->pw = w;
  o->ph = h;
}

static void x11_apply_click_through(Display *dpy, Window win) {
  XRectangle rect;
  memset(&rect, 0, sizeof(rect));
  XShapeCombineRectangles(dpy, win, ShapeInput, 0, 0, &rect, 0, ShapeSet, Unsorted);
  XserverRegion region = XFixesCreateRegion(dpy, NULL, 0);
  XFixesSetWindowShapeRegion(dpy, win, ShapeInput, 0, 0, region);
  XFixesDestroyRegion(dpy, region);
}

static int x11_create(Overlay *o, const NativeSource *source) {
  Display *dpy = XOpenDisplay(NULL);
  if (!dpy) return 0;
  int screen = DefaultScreen(dpy);
  XVisualInfo vinfo;
  if (!XMatchVisualInfo(dpy, screen, 32, TrueColor, &vinfo)) {
    if (!XMatchVisualInfo(dpy, screen, DefaultDepth(dpy, screen), TrueColor, &vinfo)) {
      XCloseDisplay(dpy);
      return 0;
    }
  }
  XSetWindowAttributes swa;
  memset(&swa, 0, sizeof(swa));
  swa.colormap = XCreateColormap(dpy, RootWindow(dpy, screen), vinfo.visual, AllocNone);
  swa.border_pixel = 0;
  swa.background_pixel = 0;
  swa.override_redirect = True;
  swa.save_under = True;
  unsigned long mask = CWColormap | CWBorderPixel | CWBackPixel | CWOverrideRedirect | CWSaveUnder;
  int x = source->x;
  int y = source->y;
  int w = source->width > 0 ? source->width : DisplayWidth(dpy, screen);
  int h = source->height > 0 ? source->height : DisplayHeight(dpy, screen);
  Window win = XCreateWindow(
      dpy,
      RootWindow(dpy, screen),
      x,
      y,
      (unsigned)w,
      (unsigned)h,
      0,
      vinfo.depth,
      InputOutput,
      vinfo.visual,
      mask,
      &swa);
  Atom net_wm_state = XInternAtom(dpy, "_NET_WM_STATE", False);
  Atom net_wm_above = XInternAtom(dpy, "_NET_WM_STATE_ABOVE", False);
  Atom net_wm_skip = XInternAtom(dpy, "_NET_WM_STATE_SKIP_TASKBAR", False);
  Atom states[3] = {net_wm_above, net_wm_skip, 0};
  XChangeProperty(dpy, win, net_wm_state, XA_ATOM, 32, PropModeReplace, (unsigned char *)states, 2);
  XStoreName(dpy, win, "p2p.kiwi overlay");
  x11_apply_click_through(dpy, win);
  XMapRaised(dpy, win);
  XFlush(dpy);
  o->dpy = dpy;
  o->win = win;
  o->gc = XCreateGC(dpy, win, 0, NULL);
  o->is_wayland = 0;
  ensure_pixels(o, w, h);
  return 1;
}

static void x11_present(Overlay *o) {
  if (!o->dpy || !o->pixels) return;
  Visual *visual = DefaultVisual(o->dpy, DefaultScreen(o->dpy));
  int depth = DefaultDepth(o->dpy, DefaultScreen(o->dpy));
  XImage *img = XCreateImage(o->dpy, visual, (unsigned)depth, ZPixmap, 0, (char *)o->pixels, (unsigned)o->pw, (unsigned)o->ph, 32, 0);
  if (!img) return;
  img->byte_order = LSBFirst;
  XPutImage(o->dpy, o->win, o->gc, img, 0, 0, 0, 0, (unsigned)o->pw, (unsigned)o->ph);
  img->data = NULL;
  XDestroyImage(img);
  XRaiseWindow(o->dpy, o->win);
  XFlush(o->dpy);
}

static void x11_destroy(Overlay *o) {
  if (!o->dpy) return;
  if (o->gc) XFreeGC(o->dpy, o->gc);
  if (o->win) XDestroyWindow(o->dpy, o->win);
  XCloseDisplay(o->dpy);
  o->dpy = NULL;
  o->win = 0;
  o->gc = 0;
}

#ifdef HAVE_WAYLAND
struct WlState {
  struct wl_display *display;
  struct wl_registry *registry;
  struct wl_compositor *compositor;
  struct wl_shm *shm;
  struct zwlr_layer_shell_v1 *shell;
  int configured;
  uint32_t serial;
  int width;
  int height;
};

static void registry_global(
    void *data,
    struct wl_registry *registry,
    uint32_t name,
    const char *interface,
    uint32_t version) {
  struct WlState *st = data;
  if (strcmp(interface, wl_compositor_interface.name) == 0) {
    st->compositor = wl_registry_bind(registry, name, &wl_compositor_interface, 4);
  } else if (strcmp(interface, wl_shm_interface.name) == 0) {
    st->shm = wl_registry_bind(registry, name, &wl_shm_interface, 1);
  } else if (strcmp(interface, zwlr_layer_shell_v1_interface.name) == 0) {
    st->shell = wl_registry_bind(registry, name, &zwlr_layer_shell_v1_interface, version < 4 ? version : 4);
  }
}

static void registry_global_remove(void *data, struct wl_registry *registry, uint32_t name) {
  (void)data;
  (void)registry;
  (void)name;
}

static const struct wl_registry_listener registry_listener = {
    .global = registry_global,
    .global_remove = registry_global_remove,
};

static void layer_configure(
    void *data,
    struct zwlr_layer_surface_v1 *layer,
    uint32_t serial,
    uint32_t width,
    uint32_t height) {
  struct WlState *st = data;
  st->serial = serial;
  st->width = (int)width;
  st->height = (int)height;
  st->configured = 1;
  zwlr_layer_surface_v1_ack_configure(layer, serial);
}

static void layer_closed(void *data, struct zwlr_layer_surface_v1 *layer) {
  (void)data;
  (void)layer;
}

static const struct zwlr_layer_surface_v1_listener layer_listener = {
    .configure = layer_configure,
    .closed = layer_closed,
};

static int wayland_probe_layer_shell(void) {
  struct wl_display *d = wl_display_connect(NULL);
  if (!d) return 0;
  struct WlState st;
  memset(&st, 0, sizeof(st));
  st.display = d;
  st.registry = wl_display_get_registry(d);
  wl_registry_add_listener(st.registry, &registry_listener, &st);
  wl_display_roundtrip(d);
  int ok = st.shell != NULL;
  if (st.shell) zwlr_layer_shell_v1_destroy(st.shell);
  if (st.compositor) wl_compositor_destroy(st.compositor);
  if (st.shm) wl_shm_destroy(st.shm);
  if (st.registry) wl_registry_destroy(st.registry);
  wl_display_disconnect(d);
  return ok;
}

static int wayland_create(Overlay *o, const NativeSource *source) {
  struct wl_display *d = wl_display_connect(NULL);
  if (!d) return 0;
  struct WlState *st = calloc(1, sizeof(*st));
  if (!st) {
    wl_display_disconnect(d);
    return 0;
  }
  st->display = d;
  st->registry = wl_display_get_registry(d);
  wl_registry_add_listener(st->registry, &registry_listener, st);
  wl_display_roundtrip(d);
  if (!st->compositor || !st->shell || !st->shm) {
    wl_display_disconnect(d);
    free(st);
    return 0;
  }
  struct wl_surface *surface = wl_compositor_create_surface(st->compositor);
  struct zwlr_layer_surface_v1 *layer = zwlr_layer_shell_v1_get_layer_surface(
      st->shell,
      surface,
      NULL,
      ZWLR_LAYER_SHELL_V1_LAYER_OVERLAY,
      "p2p.kiwi");
  zwlr_layer_surface_v1_add_listener(layer, &layer_listener, st);
  int w = source->width > 0 ? source->width : 1;
  int h = source->height > 0 ? source->height : 1;
  zwlr_layer_surface_v1_set_size(layer, (uint32_t)w, (uint32_t)h);
  zwlr_layer_surface_v1_set_anchor(
      layer,
      ZWLR_LAYER_SURFACE_V1_ANCHOR_TOP | ZWLR_LAYER_SURFACE_V1_ANCHOR_LEFT);
  zwlr_layer_surface_v1_set_keyboard_interactivity(layer, 0);
  zwlr_layer_surface_v1_set_exclusive_zone(layer, -1);
  struct wl_region *empty = wl_compositor_create_region(st->compositor);
  wl_surface_set_input_region(surface, empty);
  wl_region_destroy(empty);
  wl_surface_commit(surface);
  wl_display_roundtrip(d);
  o->wld = d;
  o->surface = surface;
  o->layer = layer;
  o->is_wayland = 1;
  ensure_pixels(o, w, h);
  (void)st;
  return 1;
}

static void wayland_destroy(Overlay *o) {
  if (o->layer) zwlr_layer_surface_v1_destroy(o->layer);
  if (o->surface) wl_surface_destroy(o->surface);
  if (o->wld) wl_display_disconnect(o->wld);
  o->layer = NULL;
  o->surface = NULL;
  o->wld = NULL;
}
#endif

void native_query_caps(NativeCaps *out) {
  memset(out, 0, sizeof(*out));
  g_wayland_session = env_set("WAYLAND_DISPLAY") || (getenv("XDG_SESSION_TYPE") && strcmp(getenv("XDG_SESSION_TYPE"), "wayland") == 0);
#ifdef HAVE_WAYLAND
  if (g_wayland_session) {
    g_wayland_layer_shell = wayland_probe_layer_shell();
    out->overlays = g_wayland_layer_shell;
    out->click_through = g_wayland_layer_shell;
    out->display_enumeration = g_wayland_layer_shell;
  } else
#endif
  {
    Display *dpy = XOpenDisplay(NULL);
    int ok = dpy != NULL;
    if (dpy) XCloseDisplay(dpy);
    out->overlays = ok;
    out->click_through = ok;
    out->display_enumeration = ok;
  }
  out->global_pointer_observation = 0;
  out->global_keyboard_observation = 0;
  out->pointer_injection = 0;
  out->keyboard_injection = 0;
  out->accessibility = 0;
  out->screen_recording = 0;
  out->input_monitoring = 0;
}

int native_overlay_create(const NativeSource *source) {
  Overlay *o = alloc_overlay();
  if (!o) return 0;
  o->source = *source;
#ifdef HAVE_WAYLAND
  if (g_wayland_session && g_wayland_layer_shell) {
    if (wayland_create(o, source)) return o->id;
    o->in_use = 0;
    return 0;
  }
#endif
  if (x11_create(o, source)) return o->id;
  o->in_use = 0;
  return 0;
}

int native_overlay_update(int overlay_id, const NativeSource *source, const NativeCursor *cursors, int n) {
  Overlay *o = find_overlay(overlay_id);
  if (!o) return 0;
  if (source) o->source = *source;
  o->cursor_count = n > MAX_CURSORS ? MAX_CURSORS : n;
  if (cursors && o->cursor_count > 0) {
    memcpy(o->cursors, cursors, sizeof(NativeCursor) * (size_t)o->cursor_count);
  }
  int w = o->source.width > 0 ? o->source.width : 1;
  int h = o->source.height > 0 ? o->source.height : 1;
  if (o->dpy && (w != o->pw || h != o->ph)) {
    XMoveResizeWindow(o->dpy, o->win, o->source.x, o->source.y, (unsigned)w, (unsigned)h);
  }
  ensure_pixels(o, w, h);
  overlay_draw_cursors(o->pixels, o->pw, o->ph, &o->source, o->cursors, o->cursor_count);
  if (!o->is_wayland) x11_present(o);
#ifdef HAVE_WAYLAND
  else if (o->wld) wl_display_flush(o->wld);
#endif
  return 1;
}

void native_overlay_destroy(int overlay_id) {
  Overlay *o = find_overlay(overlay_id);
  if (!o) return;
#ifdef HAVE_WAYLAND
  if (o->is_wayland) wayland_destroy(o);
  else
#endif
    x11_destroy(o);
  free(o->pixels);
  memset(o, 0, sizeof(*o));
}

void native_overlay_pump(void) {
  for (int i = 0; i < MAX_OVERLAYS; i++) {
    Overlay *o = &g_overlays[i];
    if (!o->in_use) continue;
    if (o->dpy) {
      while (XPending(o->dpy)) {
        XEvent ev;
        XNextEvent(o->dpy, &ev);
      }
    }
#ifdef HAVE_WAYLAND
    if (o->wld) wl_display_dispatch_pending(o->wld);
#endif
  }
}

void native_shutdown(void) {
  for (int i = 0; i < MAX_OVERLAYS; i++) {
    if (g_overlays[i].in_use) native_overlay_destroy(g_overlays[i].id);
  }
}
