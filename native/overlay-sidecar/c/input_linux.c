#include "input_native.h"
#include "portable_keys.h"

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <linux/input.h>
#include <linux/uinput.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include <sys/ioctl.h>
#include <X11/Xlib.h>
#include <X11/extensions/XInput2.h>
#include <X11/extensions/XTest.h>
#include <X11/keysym.h>

#include "capture_queue.h"

#ifndef KEY_ESC
#define KEY_ESC 1
#endif

static int g_wayland;
static Display *g_dpy;
static int g_x_error_code;
static int g_xtest;
static int g_hotkey_grabbed;
static int g_x11_hotkey_grabbed;
static int g_hotkey_fired;
static int g_uinput_fd = -1;
static int g_evdev_fds[32];
static int g_evdev_n;
static int g_x_min_kc = 8;
static int g_x_max_kc = 255;
static int g_ctrl_down;
static int g_alt_down;
static int g_shift_down;
static int g_meta_down;
static int g_esc_down;
static int g_hotkey_want_ctrl = 1;
static int g_hotkey_want_alt;
static int g_hotkey_want_shift;
static int g_hotkey_want_meta;
static int g_capture_evdev;
static int g_capture_x11;
static int g_evdev_access_denied;
static unsigned char g_kbd_event[32];
static int g_xi_opcode;
static int g_xi_ready;
static int g_xtest_keyboard = -1;
static int g_xi_ctrl;
static int g_xi_alt;
static int g_xi_shift;
static int g_xi_meta;
static int g_kc_esc;
static int g_kc_ctrl_l;
static int g_kc_ctrl_r;
static int g_kc_alt_l;
static int g_kc_alt_r;
static int g_kc_shift_l;
static int g_kc_shift_r;
static int g_kc_meta_l;
static int g_kc_meta_r;

static int linux_key_for_portable(unsigned int code);
static int session_is_wayland(void);
static void init_xi_hotkey(void);

static unsigned int portable_from_linux(int linux_code) {
  unsigned int pk;
  for (pk = 1; pk <= (unsigned int)PK_COUNT; pk++) {
    if (linux_key_for_portable(pk) == linux_code) return pk;
  }
  return 0;
}

static unsigned int current_mods(void) {
  unsigned int mods = 0;
  if (g_ctrl_down) mods |= 1;
  if (g_alt_down) mods |= 2;
  if (g_shift_down) mods |= 4;
  if (g_meta_down) mods |= 8;
  return mods;
}

static int hotkey_chord_down(void) {
  return g_esc_down &&
         (!g_hotkey_want_ctrl || g_ctrl_down) &&
         (!g_hotkey_want_alt || g_alt_down) &&
         (!g_hotkey_want_shift || g_shift_down) &&
         (!g_hotkey_want_meta || g_meta_down);
}

static void note_linux_key(int linux_code, int value) {
  int down = value != 0;
  if (linux_code == KEY_LEFTCTRL || linux_code == KEY_RIGHTCTRL) g_ctrl_down = down;
  else if (linux_code == KEY_LEFTALT || linux_code == KEY_RIGHTALT) g_alt_down = down;
  else if (linux_code == KEY_LEFTSHIFT || linux_code == KEY_RIGHTSHIFT) g_shift_down = down;
  else if (linux_code == KEY_LEFTMETA || linux_code == KEY_RIGHTMETA) g_meta_down = down;
  else if (linux_code == KEY_ESC) g_esc_down = down;
  /* Controller capture forwards the chord. Only a physical host key stops control. */
  if (!g_capture_active && hotkey_chord_down()) {
    g_hotkey_fired = 1;
    capture_lock();
  }
  if (g_hotkey_fired && !g_capture_active) return;
  if (g_capture_active) {
    unsigned int pk = portable_from_linux(linux_code);
    int loc = 0;
    if (pk == PK_SHIFT_LEFT || pk == PK_CONTROL_LEFT || pk == PK_ALT_LEFT || pk == PK_META_LEFT) loc = 1;
    else if (pk == PK_SHIFT_RIGHT || pk == PK_CONTROL_RIGHT || pk == PK_ALT_RIGHT || pk == PK_META_RIGHT) loc = 2;
    else if (pk >= PK_NUMPAD0 && pk <= PK_NUMPAD_ENTER) loc = 3;
    cap_push(pk, down, current_mods(), loc, value == 2);
  }
}

static int env_set(const char *name) {
  const char *v = getenv(name);
  return v && v[0];
}

#ifndef KEY_COMPOSE
#define KEY_COMPOSE 127
#endif

static int linux_key_for_portable(unsigned int code) {
  static const int letters[] = {
      KEY_A, KEY_B, KEY_C, KEY_D, KEY_E, KEY_F, KEY_G, KEY_H, KEY_I, KEY_J,
      KEY_K, KEY_L, KEY_M, KEY_N, KEY_O, KEY_P, KEY_Q, KEY_R, KEY_S, KEY_T,
      KEY_U, KEY_V, KEY_W, KEY_X, KEY_Y, KEY_Z};
  if (code == PK_ESCAPE) return KEY_ESC;
  if (code >= PK_DIGIT1 && code <= PK_DIGIT9) return KEY_1 + (int)(code - PK_DIGIT1);
  if (code == PK_DIGIT0) return KEY_0;
  /* KEY_A..KEY_Z are QWERTY scancodes, not a contiguous A-Z range. */
  if (code >= PK_A && code <= PK_Z) return letters[code - PK_A];
  if (code >= PK_F1 && code <= PK_F10) return KEY_F1 + (int)(code - PK_F1);
  if (code == PK_F11) return KEY_F11;
  if (code == PK_F12) return KEY_F12;
  switch (code) {
    case PK_F13:
#ifdef KEY_F13
      return KEY_F13;
#else
      return 0;
#endif
    case PK_F14:
#ifdef KEY_F14
      return KEY_F14;
#else
      return 0;
#endif
    case PK_F15:
#ifdef KEY_F15
      return KEY_F15;
#else
      return 0;
#endif
    case PK_F16:
#ifdef KEY_F16
      return KEY_F16;
#else
      return 0;
#endif
    case PK_F17:
#ifdef KEY_F17
      return KEY_F17;
#else
      return 0;
#endif
    case PK_F18:
#ifdef KEY_F18
      return KEY_F18;
#else
      return 0;
#endif
    case PK_F19:
#ifdef KEY_F19
      return KEY_F19;
#else
      return 0;
#endif
    case PK_F20:
#ifdef KEY_F20
      return KEY_F20;
#else
      return 0;
#endif
    case PK_F21:
#ifdef KEY_F21
      return KEY_F21;
#else
      return 0;
#endif
    case PK_F22:
#ifdef KEY_F22
      return KEY_F22;
#else
      return 0;
#endif
    case PK_F23:
#ifdef KEY_F23
      return KEY_F23;
#else
      return 0;
#endif
    case PK_F24:
#ifdef KEY_F24
      return KEY_F24;
#else
      return 0;
#endif
    case PK_SHIFT_LEFT: return KEY_LEFTSHIFT;
    case PK_SHIFT_RIGHT: return KEY_RIGHTSHIFT;
    case PK_CONTROL_LEFT: return KEY_LEFTCTRL;
    case PK_CONTROL_RIGHT: return KEY_RIGHTCTRL;
    case PK_ALT_LEFT: return KEY_LEFTALT;
    case PK_ALT_RIGHT: return KEY_RIGHTALT;
    case PK_META_LEFT: return KEY_LEFTMETA;
    case PK_META_RIGHT: return KEY_RIGHTMETA;
    case PK_ENTER: return KEY_ENTER;
    case PK_SPACE: return KEY_SPACE;
    case PK_TAB: return KEY_TAB;
    case PK_BACKSPACE: return KEY_BACKSPACE;
    case PK_DELETE: return KEY_DELETE;
    case PK_INSERT: return KEY_INSERT;
    case PK_HOME: return KEY_HOME;
    case PK_END: return KEY_END;
    case PK_PAGE_UP: return KEY_PAGEUP;
    case PK_PAGE_DOWN: return KEY_PAGEDOWN;
    case PK_ARROW_UP: return KEY_UP;
    case PK_ARROW_DOWN: return KEY_DOWN;
    case PK_ARROW_LEFT: return KEY_LEFT;
    case PK_ARROW_RIGHT: return KEY_RIGHT;
    case PK_CAPS_LOCK: return KEY_CAPSLOCK;
    case PK_NUM_LOCK: return KEY_NUMLOCK;
    case PK_SCROLL_LOCK: return KEY_SCROLLLOCK;
    case PK_PAUSE: return KEY_PAUSE;
    case PK_PRINT_SCREEN: return KEY_SYSRQ;
    case PK_CONTEXT_MENU: return KEY_COMPOSE;
    case PK_NUMPAD0: return KEY_KP0;
    case PK_NUMPAD1: return KEY_KP1;
    case PK_NUMPAD2: return KEY_KP2;
    case PK_NUMPAD3: return KEY_KP3;
    case PK_NUMPAD4: return KEY_KP4;
    case PK_NUMPAD5: return KEY_KP5;
    case PK_NUMPAD6: return KEY_KP6;
    case PK_NUMPAD7: return KEY_KP7;
    case PK_NUMPAD8: return KEY_KP8;
    case PK_NUMPAD9: return KEY_KP9;
    case PK_NUMPAD_ADD: return KEY_KPPLUS;
    case PK_NUMPAD_SUBTRACT: return KEY_KPMINUS;
    case PK_NUMPAD_MULTIPLY: return KEY_KPASTERISK;
    case PK_NUMPAD_DIVIDE: return KEY_KPSLASH;
    case PK_NUMPAD_DECIMAL: return KEY_KPDOT;
    case PK_NUMPAD_ENTER: return KEY_KPENTER;
    case PK_MINUS: return KEY_MINUS;
    case PK_EQUAL: return KEY_EQUAL;
    case PK_BRACKET_LEFT: return KEY_LEFTBRACE;
    case PK_BRACKET_RIGHT: return KEY_RIGHTBRACE;
    case PK_BACKSLASH: return KEY_BACKSLASH;
    case PK_SEMICOLON: return KEY_SEMICOLON;
    case PK_QUOTE: return KEY_APOSTROPHE;
    case PK_BACKQUOTE: return KEY_GRAVE;
    case PK_COMMA: return KEY_COMMA;
    case PK_PERIOD: return KEY_DOT;
    case PK_SLASH: return KEY_SLASH;
    case PK_VOLUME_MUTE: return KEY_MUTE;
    case PK_VOLUME_DOWN: return KEY_VOLUMEDOWN;
    case PK_VOLUME_UP: return KEY_VOLUMEUP;
    case PK_MEDIA_NEXT: return KEY_NEXTSONG;
    case PK_MEDIA_PREV: return KEY_PREVIOUSSONG;
    case PK_MEDIA_PLAY: return KEY_PLAYPAUSE;
    case PK_MEDIA_STOP: return KEY_STOPCD;
    case PK_INTL_BACKSLASH: return KEY_102ND;
    case PK_INTL_RO: return KEY_RO;
    case PK_INTL_YEN: return KEY_YEN;
    case PK_LANG1: return KEY_HANGEUL;
    case PK_LANG2: return KEY_HANJA;
    default: return 0;
  }
}

/* Prefer the X server's own keycode for this keysym so we are not
 * tied to the evdev+8 convention (wrong on some Xwayland setups). */
static KeySym x_keysym_for_portable(unsigned int code) {
  if (code >= PK_A && code <= PK_Z) return (KeySym)(XK_a + (code - PK_A));
  if (code >= PK_DIGIT1 && code <= PK_DIGIT9) return (KeySym)(XK_1 + (code - PK_DIGIT1));
  if (code == PK_DIGIT0) return XK_0;
  if (code >= PK_F1 && code <= PK_F12) return (KeySym)(XK_F1 + (code - PK_F1));
  switch (code) {
    case PK_ESCAPE: return XK_Escape;
    case PK_SHIFT_LEFT: return XK_Shift_L;
    case PK_SHIFT_RIGHT: return XK_Shift_R;
    case PK_CONTROL_LEFT: return XK_Control_L;
    case PK_CONTROL_RIGHT: return XK_Control_R;
    case PK_ALT_LEFT: return XK_Alt_L;
    case PK_ALT_RIGHT: return XK_Alt_R;
    case PK_META_LEFT: return XK_Super_L;
    case PK_META_RIGHT: return XK_Super_R;
    case PK_ENTER: return XK_Return;
    case PK_SPACE: return XK_space;
    case PK_TAB: return XK_Tab;
    case PK_BACKSPACE: return XK_BackSpace;
    case PK_DELETE: return XK_Delete;
    case PK_INSERT: return XK_Insert;
    case PK_HOME: return XK_Home;
    case PK_END: return XK_End;
    case PK_PAGE_UP: return XK_Page_Up;
    case PK_PAGE_DOWN: return XK_Page_Down;
    case PK_ARROW_UP: return XK_Up;
    case PK_ARROW_DOWN: return XK_Down;
    case PK_ARROW_LEFT: return XK_Left;
    case PK_ARROW_RIGHT: return XK_Right;
    case PK_CAPS_LOCK: return XK_Caps_Lock;
    case PK_NUM_LOCK: return XK_Num_Lock;
    case PK_SCROLL_LOCK: return XK_Scroll_Lock;
    case PK_PAUSE: return XK_Pause;
    case PK_PRINT_SCREEN: return XK_Print;
    case PK_MINUS: return XK_minus;
    case PK_EQUAL: return XK_equal;
    case PK_BRACKET_LEFT: return XK_bracketleft;
    case PK_BRACKET_RIGHT: return XK_bracketright;
    case PK_BACKSLASH: return XK_backslash;
    case PK_SEMICOLON: return XK_semicolon;
    case PK_QUOTE: return XK_apostrophe;
    case PK_BACKQUOTE: return XK_grave;
    case PK_COMMA: return XK_comma;
    case PK_PERIOD: return XK_period;
    case PK_SLASH: return XK_slash;
    default: return NoSymbol;
  }
}

static int x_keycode_for_portable(unsigned int code) {
  if (g_dpy) {
    KeySym ks = x_keysym_for_portable(code);
    if (ks != NoSymbol) {
      KeyCode kc = XKeysymToKeycode(g_dpy, ks);
      if (kc) return (int)kc;
    }
  }
  int evdev = linux_key_for_portable(code);
  if (evdev <= 0) return 0;
  int kc = evdev + g_x_min_kc;
  if (kc < g_x_min_kc || kc > g_x_max_kc || kc > 255) return 0;
  return kc;
}

static int emit_uinput(int type, int code, int value) {
  if (g_uinput_fd < 0) return -1;
  struct input_event ev;
  memset(&ev, 0, sizeof(ev));
  ev.type = (uint16_t)type;
  ev.code = (uint16_t)code;
  ev.value = value;
  return write(g_uinput_fd, &ev, sizeof(ev)) == (ssize_t)sizeof(ev) ? 0 : -1;
}

static int open_uinput(void) {
  int fd = open("/dev/uinput", O_WRONLY | O_NONBLOCK);
  if (fd < 0) return -1;
  ioctl(fd, UI_SET_EVBIT, EV_KEY);
  ioctl(fd, UI_SET_EVBIT, EV_REL);
  ioctl(fd, UI_SET_EVBIT, EV_ABS);
  ioctl(fd, UI_SET_EVBIT, EV_SYN);
  for (int k = 0; k < KEY_MAX; k++) ioctl(fd, UI_SET_KEYBIT, k);
  ioctl(fd, UI_SET_RELBIT, REL_X);
  ioctl(fd, UI_SET_RELBIT, REL_Y);
  ioctl(fd, UI_SET_RELBIT, REL_WHEEL);
  ioctl(fd, UI_SET_RELBIT, REL_HWHEEL);
  ioctl(fd, UI_SET_ABSBIT, ABS_X);
  ioctl(fd, UI_SET_ABSBIT, ABS_Y);
#ifdef UI_ABS_SETUP
  struct uinput_abs_setup abs;
  memset(&abs, 0, sizeof(abs));
  abs.code = ABS_X;
  abs.absinfo.minimum = -32768;
  abs.absinfo.maximum = 32767;
  ioctl(fd, UI_ABS_SETUP, &abs);
  abs.code = ABS_Y;
  ioctl(fd, UI_ABS_SETUP, &abs);
#endif
  struct uinput_setup setup;
  memset(&setup, 0, sizeof(setup));
  snprintf(setup.name, sizeof(setup.name), "p2p-kiwi-remote");
  setup.id.bustype = BUS_USB;
  setup.id.vendor = 0x5042;
  setup.id.product = 0x4b57;
  if (ioctl(fd, UI_DEV_SETUP, &setup) < 0 || ioctl(fd, UI_DEV_CREATE) < 0) {
    close(fd);
    return -1;
  }
  return fd;
}

static void close_uinput(void) {
  if (g_uinput_fd < 0) return;
  ioctl(g_uinput_fd, UI_DEV_DESTROY);
  close(g_uinput_fd);
  g_uinput_fd = -1;
}

static void close_evdev(void) {
  for (int i = 0; i < g_evdev_n; i++) close(g_evdev_fds[i]);
  g_evdev_n = 0;
}

static int session_is_wayland(void) {
  return env_set("WAYLAND_DISPLAY") ||
         (getenv("XDG_SESSION_TYPE") && strcmp(getenv("XDG_SESSION_TYPE"), "wayland") == 0);
}

static int x_error_handler(Display *dpy, XErrorEvent *ev) {
  (void)dpy;
  g_x_error_code = (int)ev->error_code;
  return 0;
}

static int open_x11_input(void) {
  if (!g_dpy) {
    /* BadAccess from a second XGrabKey must not hit Xlib's default handler,
       which exits the process. Keep this handler for the life of the display. */
    XSetErrorHandler(x_error_handler);
    g_dpy = XOpenDisplay(NULL);
  }
  if (!g_dpy) {
    g_xtest = 0;
    return 0;
  }
  int event_base = 0, error_base = 0, major = 0, minor = 0;
  g_xtest = XTestQueryExtension(g_dpy, &event_base, &error_base, &major, &minor) ? 1 : 0;
  XDisplayKeycodes(g_dpy, &g_x_min_kc, &g_x_max_kc);
  if (g_x_min_kc < 1) g_x_min_kc = 8;
  if (!session_is_wayland()) init_xi_hotkey();
  return g_xtest;
}

static int evdev_hotkey_complete(void) {
  return g_evdev_n > 0 && !g_evdev_access_denied;
}

static int event_index_from_name(const char *name) {
  if (!name || strncmp(name, "event", 5) != 0) return -1;
  char *end = NULL;
  long n = strtol(name + 5, &end, 10);
  if (!end || *end != '\0' || n < 0 || n >= 256) return -1;
  return (int)n;
}

static void mark_keyboard_event(int idx) {
  if (idx < 0 || idx >= 256) return;
  g_kbd_event[idx / 8] = (unsigned char)(g_kbd_event[idx / 8] | (1u << (idx % 8)));
}

static int is_keyboard_event(int idx) {
  if (idx < 0 || idx >= 256) return 0;
  return (g_kbd_event[idx / 8] & (1u << (idx % 8))) != 0;
}

/* /proc lists keyboards even when open() returns EACCES. The last KEY word is bits 0-63. */
static int key_word_has_keyboard(const char *line) {
  const char *p = strstr(line, "KEY=");
  if (!p) return 0;
  p += 4;
  const char *last = p;
  for (const char *s = p; *s && *s != '\n'; s++) {
    if (*s == ' ') last = s + 1;
  }
  char word[32];
  int n = 0;
  while (last[n] && last[n] != ' ' && last[n] != '\n' && n < 31) {
    word[n] = last[n];
    n++;
  }
  word[n] = 0;
  if (!n) return 0;
  unsigned long long bits = strtoull(word, NULL, 16);
  int esc = (bits & (1ULL << KEY_ESC)) != 0;
  int ctrl = (bits & (1ULL << KEY_LEFTCTRL)) != 0;
  int a = (bits & (1ULL << KEY_A)) != 0;
  return esc && ctrl && a;
}

static void load_keyboard_events(void) {
  memset(g_kbd_event, 0, sizeof(g_kbd_event));
  FILE *f = fopen("/proc/bus/input/devices", "r");
  if (!f) return;
  char line[512];
  int event_idx = -1;
  while (fgets(line, sizeof(line), f)) {
    if (line[0] == '\n') {
      event_idx = -1;
      continue;
    }
    if (strncmp(line, "H: Handlers=", 12) == 0) {
      event_idx = -1;
      char *tok = line + 12;
      while (*tok && *tok != '\n') {
        while (*tok == ' ') tok++;
        if (*tok == '\0' || *tok == '\n') break;
        if (strncmp(tok, "event", 5) == 0) {
          char *end = NULL;
          long n = strtol(tok + 5, &end, 10);
          if (end && end != tok + 5 && n >= 0 && n < 256) event_idx = (int)n;
        }
        while (*tok && *tok != ' ' && *tok != '\n') tok++;
      }
    } else if (strncmp(line, "B: KEY=", 7) == 0 && event_idx >= 0 && key_word_has_keyboard(line)) {
      mark_keyboard_event(event_idx);
    }
  }
  fclose(f);
}

static int keycode_is(int keycode, int want) {
  return want && keycode == want;
}

static void note_xi_key(int keycode, int down) {
  if (keycode_is(keycode, g_kc_ctrl_l) || keycode_is(keycode, g_kc_ctrl_r)) g_xi_ctrl = down;
  else if (keycode_is(keycode, g_kc_alt_l) || keycode_is(keycode, g_kc_alt_r)) g_xi_alt = down;
  else if (keycode_is(keycode, g_kc_shift_l) || keycode_is(keycode, g_kc_shift_r)) g_xi_shift = down;
  else if (keycode_is(keycode, g_kc_meta_l) || keycode_is(keycode, g_kc_meta_r)) g_xi_meta = down;
  if (g_capture_active || !down || !keycode_is(keycode, g_kc_esc)) return;
  int ok = (!g_hotkey_want_ctrl || g_xi_ctrl) &&
           (!g_hotkey_want_alt || g_xi_alt) &&
           (!g_hotkey_want_shift || g_xi_shift) &&
           (!g_hotkey_want_meta || g_xi_meta);
  if (!ok) return;
  g_hotkey_fired = 1;
  capture_lock();
}

static void init_xi_hotkey(void) {
  g_xi_ready = 0;
  g_xtest_keyboard = -1;
  if (!g_dpy) return;
  int event = 0, error = 0;
  if (!XQueryExtension(g_dpy, "XInputExtension", &g_xi_opcode, &event, &error)) return;
  int major = 2, minor = 0;
  if (XIQueryVersion(g_dpy, &major, &minor) != Success) return;
  int n = 0;
  XIDeviceInfo *info = XIQueryDevice(g_dpy, XIAllDevices, &n);
  if (info) {
    for (int i = 0; i < n; i++) {
      if (info[i].use == XISlaveKeyboard && info[i].name && strstr(info[i].name, "XTEST"))
        g_xtest_keyboard = (int)info[i].deviceid;
    }
    XIFreeDeviceInfo(info);
  }
  unsigned char mask_bits[XIMaskLen(XI_RawKeyRelease)];
  memset(mask_bits, 0, sizeof(mask_bits));
  XIEventMask mask;
  mask.deviceid = XIAllDevices;
  mask.mask_len = sizeof(mask_bits);
  mask.mask = mask_bits;
  XISetMask(mask_bits, XI_RawKeyPress);
  XISetMask(mask_bits, XI_RawKeyRelease);
  if (XISelectEvents(g_dpy, DefaultRootWindow(g_dpy), &mask, 1) != Success) return;
  g_kc_esc = (int)XKeysymToKeycode(g_dpy, XK_Escape);
  g_kc_ctrl_l = (int)XKeysymToKeycode(g_dpy, XK_Control_L);
  g_kc_ctrl_r = (int)XKeysymToKeycode(g_dpy, XK_Control_R);
  g_kc_alt_l = (int)XKeysymToKeycode(g_dpy, XK_Alt_L);
  g_kc_alt_r = (int)XKeysymToKeycode(g_dpy, XK_Alt_R);
  g_kc_shift_l = (int)XKeysymToKeycode(g_dpy, XK_Shift_L);
  g_kc_shift_r = (int)XKeysymToKeycode(g_dpy, XK_Shift_R);
  g_kc_meta_l = (int)XKeysymToKeycode(g_dpy, XK_Super_L);
  g_kc_meta_r = (int)XKeysymToKeycode(g_dpy, XK_Super_R);
  g_xi_ready = 1;
}

static int open_evdev(void) {
  close_evdev();
  g_evdev_access_denied = 0;
  load_keyboard_events();
  DIR *dir = opendir("/dev/input");
  if (!dir) return 0;
  struct dirent *ent;
  while ((ent = readdir(dir)) && g_evdev_n < 32) {
    if (strncmp(ent->d_name, "event", 5) != 0) continue;
    char path[256];
    snprintf(path, sizeof(path), "/dev/input/%s", ent->d_name);
    int fd = open(path, O_RDONLY | O_NONBLOCK);
    if (fd < 0) {
      int idx = event_index_from_name(ent->d_name);
      if (errno == EACCES && is_keyboard_event(idx)) {
        g_evdev_access_denied = 1;
        fprintf(stderr, "p2p.kiwi sidecar: keyboard %s not readable\n", path);
      }
      continue;
    }
    char name[256];
    memset(name, 0, sizeof(name));
    if (ioctl(fd, EVIOCGNAME(sizeof(name)), name) >= 0 && strstr(name, "p2p-kiwi")) {
      close(fd);
      continue;
    }
    unsigned char bits[(KEY_MAX + 7) / 8];
    memset(bits, 0, sizeof(bits));
    if (ioctl(fd, EVIOCGBIT(EV_KEY, sizeof(bits)), bits) < 0) {
      close(fd);
      continue;
    }
    int has_esc = bits[KEY_ESC / 8] & (1 << (KEY_ESC % 8));
    int has_ctrl = bits[KEY_LEFTCTRL / 8] & (1 << (KEY_LEFTCTRL % 8));
    int has_a = bits[KEY_A / 8] & (1 << (KEY_A % 8));
    int has_space = bits[KEY_SPACE / 8] & (1 << (KEY_SPACE % 8));
    if (!has_esc || !has_ctrl || !has_a || !has_space) {
      close(fd);
      continue;
    }
    g_evdev_fds[g_evdev_n++] = fd;
  }
  closedir(dir);
  return g_evdev_n > 0;
}

static void grab_x11_hotkey(void) {
  if (!g_dpy) return;
  Window root = DefaultRootWindow(g_dpy);
  KeyCode kc = XKeysymToKeycode(g_dpy, XK_Escape);
  if (!kc) return;
  unsigned int base = 0;
  if (g_hotkey_want_ctrl) base |= ControlMask;
  if (g_hotkey_want_alt) base |= Mod1Mask;
  if (g_hotkey_want_shift) base |= ShiftMask;
  if (g_hotkey_want_meta) base |= Mod4Mask;
  unsigned int extras[] = {0, Mod2Mask, LockMask, Mod2Mask | LockMask};
  g_x_error_code = 0;
  for (int i = 0; i < 4; i++) {
    XGrabKey(g_dpy, kc, base | extras[i], root, True, GrabModeAsync, GrabModeAsync);
  }
  /* X errors are async. Sync now so a BadAccess from another sidecar is
     reported here instead of aborting the process on a later XPending. */
  XSync(g_dpy, False);
  if (g_x_error_code) {
    fprintf(stderr, "p2p.kiwi sidecar: XGrabKey unavailable (X error %d); another client owns this hotkey\n",
            g_x_error_code);
    g_x_error_code = 0;
    XUngrabKey(g_dpy, kc, AnyModifier, root);
    XSync(g_dpy, False);
    g_x_error_code = 0;
    g_x11_hotkey_grabbed = 0;
    return;
  }
  g_x11_hotkey_grabbed = 1;
  g_hotkey_grabbed = 1;
}

int native_input_init(void) {
  g_wayland = 0;
  g_xtest = 0;
  g_hotkey_grabbed = 0;
  g_x11_hotkey_grabbed = 0;

  if (session_is_wayland()) open_evdev();

  /* XTest on XWayland is what makes GNOME show "Allow remote interaction".
     uinput never opens that dialog, so Mutter never grants control. */
  if (open_x11_input()) {
    if (g_evdev_n > 0) g_hotkey_grabbed = 1;
    grab_x11_hotkey();
    fprintf(stderr, "p2p.kiwi sidecar: input backend x11 xtest=1 hotkey=%d evdev=%d xhotkey=%d minkc=%d wayland=%d\n",
            g_hotkey_grabbed, g_evdev_n, g_x11_hotkey_grabbed, g_x_min_kc, session_is_wayland());
    return 1;
  }

  if (session_is_wayland()) {
    g_uinput_fd = open_uinput();
    if (g_uinput_fd >= 0 && g_evdev_n > 0) {
      g_wayland = 1;
      g_hotkey_grabbed = 1;
      fprintf(stderr, "p2p.kiwi sidecar: input backend wayland uinput=1 evdev=%d denied=%d (no XTest)\n",
              g_evdev_n, g_evdev_access_denied);
      return 1;
    }
    fprintf(stderr,
            "p2p.kiwi sidecar: wayland input unavailable (uinput=%d evdev=%d xtest=0)\n",
            g_uinput_fd >= 0, g_evdev_n);
    close_uinput();
  }

  fprintf(stderr, "p2p.kiwi sidecar: input backend none uinput=%d evdev=%d xtest=%d\n",
          g_uinput_fd >= 0, g_evdev_n, g_xtest);
  return 1;
}

void native_input_shutdown(void) {
  native_keyboard_capture_stop();
  native_hotkey_unregister();
  close_evdev();
  close_uinput();
  if (g_dpy) {
    XCloseDisplay(g_dpy);
    g_dpy = NULL;
  }
}

void native_input_query_caps(NativeCaps *out) {
  if (!out) return;
  /* One readable keyboard is enough to arm. An unreadable built-in keyboard
   * cannot raise the chord, but it must not disable remote control. */
  if (g_wayland) {
    int inject = g_uinput_fd >= 0;
    int watched = g_evdev_n > 0;
    out->pointer_injection = inject && watched;
    out->keyboard_injection = out->pointer_injection;
    out->global_keyboard_observation = watched;
    out->emergency_hotkey = out->pointer_injection;
    out->keyboard_capture = watched;
    if (!inject) {
      snprintf(out->unavailable_reason, sizeof(out->unavailable_reason), "uinput-permission");
    } else if (!watched) {
      snprintf(out->unavailable_reason, sizeof(out->unavailable_reason), "evdev-permission");
    } else {
      out->unavailable_reason[0] = 0;
    }
    return;
  }
  int emergency = g_hotkey_grabbed || g_evdev_n > 0;
  out->pointer_injection = g_xtest && emergency;
  out->keyboard_injection = out->pointer_injection;
  out->global_keyboard_observation = emergency;
  out->emergency_hotkey = out->pointer_injection;
  out->keyboard_capture = g_evdev_n > 0 || (g_dpy != NULL && !session_is_wayland());
  if (!g_xtest) {
    if (session_is_wayland()) {
      snprintf(out->unavailable_reason, sizeof(out->unavailable_reason), "uinput-permission");
    } else {
      snprintf(out->unavailable_reason, sizeof(out->unavailable_reason), "unsupported");
    }
  } else if (!emergency) {
    snprintf(out->unavailable_reason, sizeof(out->unavailable_reason), "hotkey-registration-failed");
  } else {
    out->unavailable_reason[0] = 0;
  }
}

static int x_event_matches_hotkey(const XKeyEvent *kev) {
  if (!g_dpy || !kev) return 0;
  KeyCode esc = XKeysymToKeycode(g_dpy, XK_Escape);
  if (!esc || kev->keycode != esc) return 0;
  int ctrl = (kev->state & ControlMask) != 0;
  int alt = (kev->state & Mod1Mask) != 0;
  int shift = (kev->state & ShiftMask) != 0;
  int meta = (kev->state & Mod4Mask) != 0;
  return (!g_hotkey_want_ctrl || ctrl) &&
         (!g_hotkey_want_alt || alt) &&
         (!g_hotkey_want_shift || shift) &&
         (!g_hotkey_want_meta || meta);
}

void native_input_pump(void) {
  if (g_dpy) {
    while (XPending(g_dpy)) {
      XEvent ev;
      XNextEvent(g_dpy, &ev);
      if (ev.type == GenericEvent && g_xi_ready && !evdev_hotkey_complete() && !session_is_wayland()) {
        XGenericEventCookie *cookie = &ev.xcookie;
        if (cookie->extension == g_xi_opcode && XGetEventData(g_dpy, cookie)) {
          if (cookie->evtype == XI_RawKeyPress || cookie->evtype == XI_RawKeyRelease) {
            XIRawEvent *raw = (XIRawEvent *)cookie->data;
            if (g_xtest_keyboard < 0 || (int)raw->deviceid != g_xtest_keyboard)
              note_xi_key((int)raw->detail, cookie->evtype == XI_RawKeyPress);
          }
          XFreeEventData(g_dpy, cookie);
        }
        continue;
      }
      /* Evdev is the physical watch. Core KeyPress also sees XTest and XWayland echoes. */
      int honor_core = ev.type == KeyPress && x_event_matches_hotkey(&ev.xkey);
      if (g_capture_active || evdev_hotkey_complete() || g_xi_ready || session_is_wayland()) honor_core = 0;
      if (honor_core) {
        g_hotkey_fired = 1;
        capture_lock();
      }
      if (g_capture_active && g_capture_x11 && (ev.type == KeyPress || ev.type == KeyRelease)) {
        int linux_code = (int)ev.xkey.keycode - g_x_min_kc;
        note_linux_key(linux_code, ev.type == KeyPress ? 1 : 0);
      }
    }
  }
  if (g_capture_active && g_capture_x11) return;
  for (int i = 0; i < g_evdev_n; i++) {
    struct input_event ev;
    while (read(g_evdev_fds[i], &ev, sizeof(ev)) == (ssize_t)sizeof(ev)) {
      if (ev.type != EV_KEY) continue;
      note_linux_key((int)ev.code, ev.value);
    }
  }
}

int native_hotkey_poll(void) {
  int fired = g_hotkey_fired;
  g_hotkey_fired = 0;
  if (fired) capture_lock();
  return fired;
}

int native_hotkey_register(int ctrl, int alt, int shift, int meta, int key_escape) {
  (void)key_escape;
  g_hotkey_want_ctrl = ctrl;
  g_hotkey_want_alt = alt;
  g_hotkey_want_shift = shift;
  g_hotkey_want_meta = meta;
  if (g_evdev_n == 0) open_evdev();
  if (g_evdev_n > 0) g_hotkey_grabbed = 1;
  if (g_dpy) {
    native_hotkey_unregister();
    grab_x11_hotkey();
  }
  if (g_hotkey_grabbed || g_x11_hotkey_grabbed) return 1;
  if (g_wayland) return 0;
  return 0;
}

void native_hotkey_unregister(void) {
  if (g_dpy && g_x11_hotkey_grabbed) {
    Window root = DefaultRootWindow(g_dpy);
    KeyCode kc = XKeysymToKeycode(g_dpy, XK_Escape);
    if (kc) XUngrabKey(g_dpy, kc, AnyModifier, root);
    g_x11_hotkey_grabbed = 0;
  }
}

int native_keyboard_capture_start(void) {
  if (capture_is_locked()) return 0;
  if (g_capture_active) return 1;
  g_cap_head = g_cap_tail = 0;
  g_ctrl_down = g_alt_down = g_shift_down = g_meta_down = g_esc_down = 0;
  if (g_evdev_n == 0) open_evdev();
  if (g_evdev_n > 0) {
    int grabbed = 0;
    for (int i = 0; i < g_evdev_n; i++) {
      if (ioctl(g_evdev_fds[i], EVIOCGRAB, 1) == 0) grabbed = 1;
      else fprintf(stderr, "p2p.kiwi sidecar: EVIOCGRAB failed fd=%d errno=%d\n", g_evdev_fds[i], errno);
    }
    if (grabbed) {
      g_capture_evdev = 1;
      g_capture_active = 1;
      fprintf(stderr, "p2p.kiwi sidecar: keyboard capture evdev grab\n");
      return 1;
    }
  }
  /* XGrabKeyboard only sees X11 clients. On Wayland it would report success
   * while physical keys still go to the compositor / Electron. */
  if (g_dpy && !session_is_wayland()) {
    int rc = XGrabKeyboard(g_dpy, DefaultRootWindow(g_dpy), True, GrabModeAsync, GrabModeAsync, CurrentTime);
    if (rc == GrabSuccess) {
      g_capture_x11 = 1;
      g_capture_active = 1;
      fprintf(stderr, "p2p.kiwi sidecar: keyboard capture XGrabKeyboard\n");
      return 1;
    }
  }
  fprintf(stderr, "p2p.kiwi sidecar: keyboard capture failed evdev=%d wayland=%d\n",
          g_evdev_n, session_is_wayland());
  return 0;
}

void native_keyboard_capture_stop(void) {
  if (!g_capture_active) return;
  if (g_capture_evdev) {
    for (int i = 0; i < g_evdev_n; i++) ioctl(g_evdev_fds[i], EVIOCGRAB, 0);
    g_capture_evdev = 0;
  }
  if (g_capture_x11 && g_dpy) {
    XUngrabKeyboard(g_dpy, CurrentTime);
    XFlush(g_dpy);
    g_capture_x11 = 0;
  }
  g_capture_active = 0;
  g_cap_head = g_cap_tail = 0;
}

int native_pointer_move_for_source(const NativeSource *source, double nx, double ny) {
  int x = source ? source->x : 0;
  int y = source ? source->y : 0;
  int w = source && source->width > 0 ? source->width : 1;
  int h = source && source->height > 0 ? source->height : 1;
  double px = 0;
  double py = 0;
  if (nx < 0) nx = 0;
  if (nx > 1) nx = 1;
  if (ny < 0) ny = 0;
  if (ny > 1) ny = 1;
  if (g_wayland) {
    /* uinput absolute axes are -32768..32767, not pixels. */
    int ax = -32768 + (int)(nx * (32767 - (-32768)));
    int ay = -32768 + (int)(ny * (32767 - (-32768)));
    return native_pointer_move((double)ax, (double)ay);
  }
  if (source) native_display_rect(source, &x, &y, &w, &h);
  normalized_to_rect(nx, ny, x, y, w, h, &px, &py);
  return native_pointer_move(px, py);
}

int native_pointer_move(double x, double y) {
  if (g_wayland) {
    if (emit_uinput(EV_ABS, ABS_X, (int)x) != 0) return -1;
    if (emit_uinput(EV_ABS, ABS_Y, (int)y) != 0) return -1;
    return emit_uinput(EV_SYN, SYN_REPORT, 0);
  }
  if (!g_dpy || !g_xtest) return -1;
  XTestFakeMotionEvent(g_dpy, -1, (int)x, (int)y, CurrentTime);
  XFlush(g_dpy);
  return 0;
}

int native_pointer_button(int button, int down) {
  if (g_wayland) {
    int code = 0;
    if (button == 1) code = BTN_LEFT;
    else if (button == 2) code = BTN_MIDDLE;
    else if (button == 3) code = BTN_RIGHT;
    else if (button == 4) code = BTN_SIDE;
    else if (button == 5) code = BTN_EXTRA;
    else return -1;
    if (emit_uinput(EV_KEY, code, down ? 1 : 0) != 0) return -1;
    return emit_uinput(EV_SYN, SYN_REPORT, 0);
  }
  if (!g_dpy || !g_xtest) return -1;
  XTestFakeButtonEvent(g_dpy, button, down ? True : False, CurrentTime);
  XFlush(g_dpy);
  return 0;
}

int native_pointer_wheel(double dx, double dy) {
  if (g_wayland) {
    if (dy != 0) emit_uinput(EV_REL, REL_WHEEL, dy < 0 ? -1 : 1);
    if (dx != 0) emit_uinput(EV_REL, REL_HWHEEL, dx < 0 ? -1 : 1);
    return emit_uinput(EV_SYN, SYN_REPORT, 0);
  }
  if (!g_dpy || !g_xtest) return -1;
  if (dy != 0) {
    unsigned int b = dy < 0 ? 5 : 4;
    XTestFakeButtonEvent(g_dpy, b, True, CurrentTime);
    XTestFakeButtonEvent(g_dpy, b, False, CurrentTime);
  }
  if (dx != 0) {
    unsigned int b = dx < 0 ? 7 : 6;
    XTestFakeButtonEvent(g_dpy, b, True, CurrentTime);
    XTestFakeButtonEvent(g_dpy, b, False, CurrentTime);
  }
  XFlush(g_dpy);
  return 0;
}

int native_key_event(unsigned int key_code, int down, unsigned int modifiers) {
  (void)modifiers;
  if (g_wayland) {
    int code = linux_key_for_portable(key_code);
    if (!code) return -1;
    if (emit_uinput(EV_KEY, code, down ? 1 : 0) != 0) return -1;
    return emit_uinput(EV_SYN, SYN_REPORT, 0);
  }
  if (!g_dpy || !g_xtest) return -1;
  int kc = x_keycode_for_portable(key_code);
  if (!kc) return -1;
  XTestFakeKeyEvent(g_dpy, (KeyCode)kc, down ? True : False, CurrentTime);
  XFlush(g_dpy);
  return 0;
}

void native_input_activate_injection(void) {
  if (!session_is_wayland() || g_wayland || !g_dpy || !g_xtest) return;
  Window root = DefaultRootWindow(g_dpy);
  Window child = 0;
  int rx = 0, ry = 0, wx = 0, wy = 0;
  unsigned int mask = 0;
  if (!XQueryPointer(g_dpy, root, &root, &child, &rx, &ry, &wx, &wy, &mask)) return;
  /* Same point the pointer is already at. XWayland still asks Mutter. */
  XTestFakeMotionEvent(g_dpy, -1, rx, ry, CurrentTime);
  XFlush(g_dpy);
  fprintf(stderr, "p2p.kiwi sidecar: prompted wayland remote interaction via XTest\n");
}

int native_input_request_permission(int kind) {
  (void)kind;
  return 0;
}
