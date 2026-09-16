#define _GNU_SOURCE

#include "overlay_native.h"
#include "overlay_draw.h"

#include <X11/Xlib.h>
#include <X11/Xatom.h>
#include <X11/Xutil.h>
#include <X11/extensions/shape.h>
#include <X11/extensions/Xfixes.h>
#include <X11/extensions/Xrandr.h>

#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <unistd.h>

#ifdef HAVE_WAYLAND
#include <wayland-client.h>
#include "wlr-layer-shell-client-protocol.h"
#endif

#define MAX_OVERLAYS 4
#define MAX_CURSORS 32
#define MAX_WL_OUTPUTS 8

#ifdef HAVE_WAYLAND
struct WlOutput {
  struct wl_output *output;
  int x;
  int y;
  int width;
  int height;
};

struct WlShmBuffer {
  struct wl_buffer *buffer;
  void *data;
  size_t size;
  int width;
  int height;
  int busy;
};

struct WlState {
  struct wl_display *display;
  struct wl_registry *registry;
  struct wl_compositor *compositor;
  struct wl_shm *shm;
  struct zwlr_layer_shell_v1 *shell;
  struct WlOutput outputs[MAX_WL_OUTPUTS];
  int output_count;
  struct WlShmBuffer buffers[2];
  int configured;
  uint32_t serial;
  int width;
  int height;
};
#endif

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
  Visual *visual;
  int depth;
  Colormap colormap;
#ifdef HAVE_WAYLAND
  struct WlState *wl;
  struct wl_surface *surface;
  struct zwlr_layer_surface_v1 *layer;
#endif
} Overlay;

static Overlay g_overlays[MAX_OVERLAYS];
static int g_next_id = 1;
static int g_wayland_session = 0;
static int g_wayland_layer_shell = 0;
static char g_backend[16] = "none";
static int g_x11_error_code = 0;

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

static int x11_error_handler(Display *dpy, XErrorEvent *ev) {
  (void)dpy;
  g_x11_error_code = ev->error_code;
  return 0;
}

static void x11_apply_click_through(Display *dpy, Window win) {
  int event_base = 0;
  int error_base = 0;
  if (!XShapeQueryExtension(dpy, &event_base, &error_base)) {
    fprintf(stderr, "p2p.kiwi sidecar: XShape extension missing; click-through unavailable\n");
  } else {
    XShapeCombineMask(dpy, win, ShapeInput, 0, 0, None, ShapeSet);
  }

  int maj = 5;
  int min = 0;
  if (!XFixesQueryExtension(dpy, &event_base, &error_base)) {
    fprintf(stderr, "p2p.kiwi sidecar: XFixes extension missing; click-through may fail\n");
    XFlush(dpy);
    return;
  }
  if (!XFixesQueryVersion(dpy, &maj, &min) || maj < 5) {
    fprintf(stderr, "p2p.kiwi sidecar: XFixes v5 missing (got %d.%d); click-through may fail\n", maj, min);
    XFlush(dpy);
    return;
  }

  int (*prev)(Display *, XErrorEvent *) = XSetErrorHandler(x11_error_handler);
  g_x11_error_code = 0;
  XRectangle r = {0, 0, 0, 0};
  XserverRegion region = XFixesCreateRegion(dpy, &r, 1);
  XFixesSetWindowShapeRegion(dpy, win, ShapeInput, 0, 0, region);
  XFixesDestroyRegion(dpy, region);
  XSync(dpy, False);
  if (g_x11_error_code) {
    fprintf(stderr, "p2p.kiwi sidecar: XFixesSetWindowShapeRegion error %d\n", g_x11_error_code);
  }
  XSetErrorHandler(prev);
}

static void x11_set_atom_window_type(Display *dpy, Window win) {
  Atom net_wm_window_type = XInternAtom(dpy, "_NET_WM_WINDOW_TYPE", False);
  Atom notification = XInternAtom(dpy, "_NET_WM_WINDOW_TYPE_NOTIFICATION", False);
  XChangeProperty(dpy, win, net_wm_window_type, XA_ATOM, 32, PropModeReplace, (unsigned char *)&notification, 1);

  Atom net_wm_state = XInternAtom(dpy, "_NET_WM_STATE", False);
  Atom skip_taskbar = XInternAtom(dpy, "_NET_WM_STATE_SKIP_TASKBAR", False);
  Atom skip_pager = XInternAtom(dpy, "_NET_WM_STATE_SKIP_PAGER", False);
  Atom above = XInternAtom(dpy, "_NET_WM_STATE_ABOVE", False);
  Atom states[3] = {above, skip_taskbar, skip_pager};
  XChangeProperty(dpy, win, net_wm_state, XA_ATOM, 32, PropModeReplace, (unsigned char *)states, 3);
}

static int x11_probe(void) {
  Display *dpy = XOpenDisplay(NULL);
  if (!dpy) return 0;
  XCloseDisplay(dpy);
  return 1;
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
  swa.event_mask = StructureNotifyMask | VisibilityChangeMask;
  unsigned long mask = CWColormap | CWBorderPixel | CWBackPixel | CWOverrideRedirect | CWSaveUnder | CWEventMask;
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
  x11_set_atom_window_type(dpy, win);
  XStoreName(dpy, win, "p2p.kiwi overlay");

  XWMHints hints;
  memset(&hints, 0, sizeof(hints));
  hints.flags = InputHint | StateHint;
  hints.input = False;
  hints.initial_state = NormalState;
  XSetWMHints(dpy, win, &hints);

  XClassHint class_hint;
  class_hint.res_name = "p2p-kiwi-overlay";
  class_hint.res_class = "p2p.kiwi";
  XSetClassHint(dpy, win, &class_hint);

  XMapRaised(dpy, win);
  XFlush(dpy);
  {
    int mapped = 0;
    for (int i = 0; i < 200 && !mapped; i++) {
      while (XPending(dpy)) {
        XEvent ev;
        XNextEvent(dpy, &ev);
        if (ev.type == MapNotify && ev.xmap.window == win) {
          mapped = 1;
          break;
        }
      }
      if (!mapped) usleep(1000);
    }
  }
  x11_apply_click_through(dpy, win);
  XRaiseWindow(dpy, win);
  XFlush(dpy);

  o->dpy = dpy;
  o->win = win;
  o->gc = XCreateGC(dpy, win, 0, NULL);
  o->visual = vinfo.visual;
  o->depth = vinfo.depth;
  o->colormap = swa.colormap;
  o->is_wayland = 0;
  ensure_pixels(o, w, h);
  snprintf(g_backend, sizeof(g_backend), "x11");
  fprintf(stderr, "p2p.kiwi sidecar: overlay backend x11\n");
  return 1;
}

static void x11_present(Overlay *o) {
  if (!o->dpy || !o->pixels || !o->visual) return;
  XImage *img = XCreateImage(
      o->dpy,
      o->visual,
      (unsigned)o->depth,
      ZPixmap,
      0,
      (char *)o->pixels,
      (unsigned)o->pw,
      (unsigned)o->ph,
      32,
      0);
  if (!img) return;
  img->byte_order = LSBFirst;
  img->bitmap_bit_order = LSBFirst;
  XPutImage(o->dpy, o->win, o->gc, img, 0, 0, 0, 0, (unsigned)o->pw, (unsigned)o->ph);
  img->data = NULL;
  XDestroyImage(img);
  XFlush(o->dpy);
}

static void x11_handle_event(Overlay *o, XEvent *ev) {
  if (ev->type == MapNotify && ev->xmap.window == o->win) {
    x11_apply_click_through(o->dpy, o->win);
    return;
  }
  if (ev->type == ConfigureNotify && ev->xconfigure.window == o->win) {
    x11_apply_click_through(o->dpy, o->win);
    return;
  }
  if (ev->type == VisibilityNotify && ev->xvisibility.window == o->win) {
    if (ev->xvisibility.state != VisibilityUnobscured) {
      XRaiseWindow(o->dpy, o->win);
      x11_apply_click_through(o->dpy, o->win);
    }
  }
}

static void x11_destroy(Overlay *o) {
  if (!o->dpy) return;
  if (o->gc) XFreeGC(o->dpy, o->gc);
  if (o->win) XDestroyWindow(o->dpy, o->win);
  if (o->colormap) XFreeColormap(o->dpy, o->colormap);
  XCloseDisplay(o->dpy);
  o->dpy = NULL;
  o->win = 0;
  o->gc = 0;
  o->visual = NULL;
  o->depth = 0;
  o->colormap = 0;
}

#ifdef HAVE_WAYLAND
static void output_geometry(
    void *data,
    struct wl_output *output,
    int32_t x,
    int32_t y,
    int32_t physical_width,
    int32_t physical_height,
    int32_t subpixel,
    const char *make,
    const char *model,
    int32_t transform) {
  (void)output;
  (void)physical_width;
  (void)physical_height;
  (void)subpixel;
  (void)make;
  (void)model;
  (void)transform;
  struct WlOutput *o = data;
  o->x = x;
  o->y = y;
}

static void output_mode(
    void *data,
    struct wl_output *output,
    uint32_t flags,
    int32_t width,
    int32_t height,
    int32_t refresh) {
  (void)output;
  (void)refresh;
  struct WlOutput *o = data;
  if (flags & WL_OUTPUT_MODE_CURRENT) {
    o->width = width;
    o->height = height;
  }
}

static void output_done(void *data, struct wl_output *output) {
  (void)data;
  (void)output;
}

static void output_scale(void *data, struct wl_output *output, int32_t factor) {
  (void)data;
  (void)output;
  (void)factor;
}

static const struct wl_output_listener output_listener = {
    .geometry = output_geometry,
    .mode = output_mode,
    .done = output_done,
    .scale = output_scale,
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
  } else if (strcmp(interface, wl_output_interface.name) == 0) {
    if (st->output_count >= MAX_WL_OUTPUTS) return;
    uint32_t ver = version < 3 ? version : 3;
    struct WlOutput *out = &st->outputs[st->output_count++];
    memset(out, 0, sizeof(*out));
    out->output = wl_registry_bind(registry, name, &wl_output_interface, ver);
    wl_output_add_listener(out->output, &output_listener, out);
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

static void wl_buffer_release(void *data, struct wl_buffer *buffer) {
  (void)buffer;
  struct WlShmBuffer *b = data;
  b->busy = 0;
}

static const struct wl_buffer_listener wl_buffer_listener = {
    .release = wl_buffer_release,
};

static int create_anon_file(size_t size) {
  int fd = memfd_create("p2p-kiwi-overlay", MFD_CLOEXEC);
  if (fd >= 0) {
    if (ftruncate(fd, (off_t)size) == 0) return fd;
    close(fd);
  }
  const char *dir = getenv("XDG_RUNTIME_DIR");
  char path[256];
  snprintf(path, sizeof(path), "%s/p2p-kiwi-overlay-XXXXXX", dir && dir[0] ? dir : "/tmp");
  fd = mkstemp(path);
  if (fd < 0) return -1;
  unlink(path);
  if (ftruncate(fd, (off_t)size) != 0) {
    close(fd);
    return -1;
  }
  return fd;
}

static void wayland_free_buffer(struct WlShmBuffer *b) {
  if (b->buffer) {
    wl_buffer_destroy(b->buffer);
    b->buffer = NULL;
  }
  if (b->data && b->size) {
    munmap(b->data, b->size);
    b->data = NULL;
  }
  b->size = 0;
  b->width = 0;
  b->height = 0;
  b->busy = 0;
}

static int wayland_ensure_buffer(struct WlState *st, struct WlShmBuffer *b, int w, int h) {
  size_t size = (size_t)w * (size_t)h * 4;
  if (b->buffer && b->width == w && b->height == h && b->data) return 1;
  wayland_free_buffer(b);
  int fd = create_anon_file(size);
  if (fd < 0) return 0;
  void *data = mmap(NULL, size, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
  if (data == MAP_FAILED) {
    close(fd);
    return 0;
  }
  struct wl_shm_pool *pool = wl_shm_create_pool(st->shm, fd, (int32_t)size);
  close(fd);
  if (!pool) {
    munmap(data, size);
    return 0;
  }
  struct wl_buffer *buf = wl_shm_pool_create_buffer(pool, 0, w, h, w * 4, WL_SHM_FORMAT_ARGB8888);
  wl_shm_pool_destroy(pool);
  if (!buf) {
    munmap(data, size);
    return 0;
  }
  wl_buffer_add_listener(buf, &wl_buffer_listener, b);
  b->buffer = buf;
  b->data = data;
  b->size = size;
  b->width = w;
  b->height = h;
  b->busy = 0;
  return 1;
}

static void wayland_apply_click_through(struct WlState *st, struct wl_surface *surface) {
  if (!st || !st->compositor || !surface) return;
  struct wl_region *empty = wl_compositor_create_region(st->compositor);
  wl_surface_set_input_region(surface, empty);
  wl_region_destroy(empty);
}

static struct wl_output *pick_output(struct WlState *st, const NativeSource *source) {
  for (int i = 0; i < st->output_count; i++) {
    struct WlOutput *out = &st->outputs[i];
    if (!out->output || out->width <= 0 || out->height <= 0) continue;
    if (source->x >= out->x && source->y >= out->y && source->x < out->x + out->width && source->y < out->y + out->height) {
      return out->output;
    }
  }
  return NULL;
}

static void wayland_state_destroy(struct WlState *st) {
  if (!st) return;
  for (int i = 0; i < 2; i++) wayland_free_buffer(&st->buffers[i]);
  for (int i = 0; i < st->output_count; i++) {
    if (st->outputs[i].output) wl_output_destroy(st->outputs[i].output);
  }
  if (st->shell) zwlr_layer_shell_v1_destroy(st->shell);
  if (st->compositor) wl_compositor_destroy(st->compositor);
  if (st->shm) wl_shm_destroy(st->shm);
  if (st->registry) wl_registry_destroy(st->registry);
  if (st->display) wl_display_disconnect(st->display);
  free(st);
}

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
  for (int i = 0; i < st.output_count; i++) {
    if (st.outputs[i].output) wl_output_destroy(st.outputs[i].output);
  }
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
  wl_display_roundtrip(d);
  if (!st->compositor || !st->shell || !st->shm) {
    wayland_state_destroy(st);
    return 0;
  }
  struct wl_surface *surface = wl_compositor_create_surface(st->compositor);
  if (!surface) {
    wayland_state_destroy(st);
    return 0;
  }
  struct wl_output *output = pick_output(st, source);
  struct zwlr_layer_surface_v1 *layer = zwlr_layer_shell_v1_get_layer_surface(
      st->shell,
      surface,
      output,
      ZWLR_LAYER_SHELL_V1_LAYER_OVERLAY,
      "p2p.kiwi");
  zwlr_layer_surface_v1_add_listener(layer, &layer_listener, st);
  int w = source->width > 0 ? source->width : 1;
  int h = source->height > 0 ? source->height : 1;
  zwlr_layer_surface_v1_set_size(layer, (uint32_t)w, (uint32_t)h);
  zwlr_layer_surface_v1_set_anchor(
      layer,
      ZWLR_LAYER_SURFACE_V1_ANCHOR_TOP | ZWLR_LAYER_SURFACE_V1_ANCHOR_LEFT);
  if (output) {
    for (int i = 0; i < st->output_count; i++) {
      if (st->outputs[i].output == output) {
        int top = source->y - st->outputs[i].y;
        int left = source->x - st->outputs[i].x;
        if (top < 0) top = 0;
        if (left < 0) left = 0;
        zwlr_layer_surface_v1_set_margin(layer, top, 0, 0, left);
        break;
      }
    }
  }
  zwlr_layer_surface_v1_set_keyboard_interactivity(layer, 0);
  zwlr_layer_surface_v1_set_exclusive_zone(layer, 0);
  wayland_apply_click_through(st, surface);
  wl_surface_commit(surface);
  wl_display_roundtrip(d);
  o->wl = st;
  o->surface = surface;
  o->layer = layer;
  o->is_wayland = 1;
  ensure_pixels(o, w, h);
  snprintf(g_backend, sizeof(g_backend), "wayland");
  fprintf(stderr, "p2p.kiwi sidecar: overlay backend wayland\n");
  return 1;
}

static void wayland_present(Overlay *o) {
  struct WlState *st = o->wl;
  if (!st || !o->surface || !o->pixels) return;
  if (o->layer && (o->pw != st->width || o->ph != st->height) && (st->width > 0 && st->height > 0)) {
    /* compositor-chosen size is advisory; keep source buffer size */
  }
  struct WlShmBuffer *b = NULL;
  for (int i = 0; i < 2; i++) {
    if (!st->buffers[i].busy) {
      b = &st->buffers[i];
      break;
    }
  }
  if (!b) {
    wl_display_dispatch_pending(st->display);
    for (int i = 0; i < 2; i++) {
      if (!st->buffers[i].busy) {
        b = &st->buffers[i];
        break;
      }
    }
  }
  if (!b) return;
  if (!wayland_ensure_buffer(st, b, o->pw, o->ph)) return;
  memcpy(b->data, o->pixels, b->size);
  b->busy = 1;
  wayland_apply_click_through(st, o->surface);
  wl_surface_attach(o->surface, b->buffer, 0, 0);
  wl_surface_damage(o->surface, 0, 0, o->pw, o->ph);
  wl_surface_commit(o->surface);
  wl_display_flush(st->display);
}

static void wayland_destroy(Overlay *o) {
  if (o->layer) zwlr_layer_surface_v1_destroy(o->layer);
  if (o->surface) wl_surface_destroy(o->surface);
  o->layer = NULL;
  o->surface = NULL;
  wayland_state_destroy(o->wl);
  o->wl = NULL;
}
#endif

static void set_caps_backend(NativeCaps *out, const char *backend, int ok) {
  out->overlays = ok;
  out->click_through = ok;
  out->display_enumeration = ok;
  snprintf(out->backend, sizeof(out->backend), "%s", backend);
  snprintf(g_backend, sizeof(g_backend), "%s", backend);
}

void native_query_caps(NativeCaps *out) {
  memset(out, 0, sizeof(*out));
  g_wayland_session = env_set("WAYLAND_DISPLAY") || (getenv("XDG_SESSION_TYPE") && strcmp(getenv("XDG_SESSION_TYPE"), "wayland") == 0);
#ifdef HAVE_WAYLAND
  if (g_wayland_session) {
    g_wayland_layer_shell = wayland_probe_layer_shell();
    if (g_wayland_layer_shell) {
      set_caps_backend(out, "wayland", 1);
    } else if (x11_probe()) {
      set_caps_backend(out, "x11", 1);
    } else {
      set_caps_backend(out, "none", 0);
    }
  } else
#endif
  {
    if (x11_probe()) set_caps_backend(out, "x11", 1);
    else set_caps_backend(out, "none", 0);
  }
  out->global_pointer_observation = 0;
  out->global_keyboard_observation = 0;
  out->pointer_injection = 0;
  out->keyboard_injection = 0;
  out->accessibility = 0;
  out->screen_recording = 0;
  out->input_monitoring = 0;
  fprintf(stderr, "p2p.kiwi sidecar: backend %s overlays=%d\n", out->backend, out->overlays);
}

int native_overlay_create(const NativeSource *source) {
  Overlay *o = alloc_overlay();
  if (!o) return 0;
  o->source = *source;
#ifdef HAVE_WAYLAND
  if (g_wayland_session && g_wayland_layer_shell) {
    if (wayland_create(o, source)) return o->id;
    fprintf(stderr, "p2p.kiwi sidecar: wayland overlay create failed; trying x11\n");
  }
#endif
  if (x11_create(o, source)) return o->id;
  o->in_use = 0;
  return 0;
}

int native_overlay_update(int overlay_id, const NativeSource *source, const NativeCursor *cursors, int n) {
  Overlay *o = find_overlay(overlay_id);
  if (!o) return 0;
  NativeSource prev = o->source;
  if (source) o->source = *source;
  o->cursor_count = n > MAX_CURSORS ? MAX_CURSORS : n;
  if (cursors && o->cursor_count > 0) {
    memcpy(o->cursors, cursors, sizeof(NativeCursor) * (size_t)o->cursor_count);
  }
  int w = o->source.width > 0 ? o->source.width : 1;
  int h = o->source.height > 0 ? o->source.height : 1;
  int moved = o->source.x != prev.x || o->source.y != prev.y || w != o->pw || h != o->ph;
  if (o->dpy && moved) {
    XMoveResizeWindow(o->dpy, o->win, o->source.x, o->source.y, (unsigned)w, (unsigned)h);
    x11_apply_click_through(o->dpy, o->win);
  }
#ifdef HAVE_WAYLAND
  if (o->is_wayland && o->layer && moved) {
    zwlr_layer_surface_v1_set_size(o->layer, (uint32_t)w, (uint32_t)h);
  }
#endif
  ensure_pixels(o, w, h);
  overlay_draw_cursors(o->pixels, o->pw, o->ph, &o->source, o->cursors, o->cursor_count);
  if (!o->is_wayland) x11_present(o);
#ifdef HAVE_WAYLAND
  else wayland_present(o);
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
        x11_handle_event(o, &ev);
      }
    }
#ifdef HAVE_WAYLAND
    if (o->wl && o->wl->display) wl_display_dispatch_pending(o->wl->display);
#endif
  }
}

void native_shutdown(void) {
  for (int i = 0; i < MAX_OVERLAYS; i++) {
    if (g_overlays[i].in_use) native_overlay_destroy(g_overlays[i].id);
  }
}
