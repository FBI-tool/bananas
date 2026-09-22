#include <stdio.h>
#import "input_native.h"
#import "portable_keys.h"
#import "capture_queue.h"

#import <ApplicationServices/ApplicationServices.h>
#import <Carbon/Carbon.h>
#import <Foundation/Foundation.h>
#include <unistd.h>

static int g_hotkey_fired;
static int g_hotkey_registered;
static int g_hotkey_want_ctrl = 1;
static int g_hotkey_want_alt;
static int g_hotkey_want_shift;
static int g_hotkey_want_meta;
static int g_inited;
static int g_post_requested;
static int g_listen_requested;
static int g_emergency_dead;
static int g_held_buttons;
static CFMachPortRef g_tap;
static CFRunLoopSourceRef g_tap_src;
static CFMachPortRef g_emergency_tap;
static CFRunLoopSourceRef g_emergency_src;
static CGEventFlags g_mac_last_flags;

static unsigned int mods_from_flags(CGEventFlags flags);
static int mac_hotkey_match(unsigned int mods);

static CGKeyCode cg_for_portable(unsigned int code) {
  if (code == PK_ESCAPE) return kVK_Escape;
  if (code >= PK_DIGIT0 && code <= PK_DIGIT9) {
    static const CGKeyCode digits[] = {
        kVK_ANSI_0, kVK_ANSI_1, kVK_ANSI_2, kVK_ANSI_3, kVK_ANSI_4,
        kVK_ANSI_5, kVK_ANSI_6, kVK_ANSI_7, kVK_ANSI_8, kVK_ANSI_9};
    return digits[code - PK_DIGIT0];
  }
  if (code >= PK_A && code <= PK_Z) {
    static const CGKeyCode letters[] = {
        kVK_ANSI_A, kVK_ANSI_B, kVK_ANSI_C, kVK_ANSI_D, kVK_ANSI_E, kVK_ANSI_F, kVK_ANSI_G,
        kVK_ANSI_H, kVK_ANSI_I, kVK_ANSI_J, kVK_ANSI_K, kVK_ANSI_L, kVK_ANSI_M, kVK_ANSI_N,
        kVK_ANSI_O, kVK_ANSI_P, kVK_ANSI_Q, kVK_ANSI_R, kVK_ANSI_S, kVK_ANSI_T, kVK_ANSI_U,
        kVK_ANSI_V, kVK_ANSI_W, kVK_ANSI_X, kVK_ANSI_Y, kVK_ANSI_Z};
    return letters[code - PK_A];
  }
  switch (code) {
    case PK_F1: return kVK_F1;
    case PK_F2: return kVK_F2;
    case PK_F3: return kVK_F3;
    case PK_F4: return kVK_F4;
    case PK_F5: return kVK_F5;
    case PK_F6: return kVK_F6;
    case PK_F7: return kVK_F7;
    case PK_F8: return kVK_F8;
    case PK_F9: return kVK_F9;
    case PK_F10: return kVK_F10;
    case PK_F11: return kVK_F11;
    case PK_F12: return kVK_F12;
    case PK_SHIFT_LEFT: return kVK_Shift;
    case PK_SHIFT_RIGHT: return kVK_RightShift;
    case PK_CONTROL_LEFT: return kVK_Control;
    case PK_CONTROL_RIGHT: return kVK_RightControl;
    case PK_ALT_LEFT: return kVK_Option;
    case PK_ALT_RIGHT: return kVK_RightOption;
    case PK_META_LEFT: return kVK_Command;
    case PK_META_RIGHT: return kVK_RightCommand;
    case PK_ENTER: return kVK_Return;
    case PK_SPACE: return kVK_Space;
    case PK_TAB: return kVK_Tab;
    case PK_BACKSPACE: return kVK_Delete;
    case PK_DELETE: return kVK_ForwardDelete;
    case PK_HOME: return kVK_Home;
    case PK_END: return kVK_End;
    case PK_PAGE_UP: return kVK_PageUp;
    case PK_PAGE_DOWN: return kVK_PageDown;
    case PK_ARROW_UP: return kVK_UpArrow;
    case PK_ARROW_DOWN: return kVK_DownArrow;
    case PK_ARROW_LEFT: return kVK_LeftArrow;
    case PK_ARROW_RIGHT: return kVK_RightArrow;
    case PK_CAPS_LOCK: return kVK_CapsLock;
    case PK_MINUS: return kVK_ANSI_Minus;
    case PK_EQUAL: return kVK_ANSI_Equal;
    case PK_BRACKET_LEFT: return kVK_ANSI_LeftBracket;
    case PK_BRACKET_RIGHT: return kVK_ANSI_RightBracket;
    case PK_BACKSLASH: return kVK_ANSI_Backslash;
    case PK_SEMICOLON: return kVK_ANSI_Semicolon;
    case PK_QUOTE: return kVK_ANSI_Quote;
    case PK_BACKQUOTE: return kVK_ANSI_Grave;
    case PK_COMMA: return kVK_ANSI_Comma;
    case PK_PERIOD: return kVK_ANSI_Period;
    case PK_SLASH: return kVK_ANSI_Slash;
    default: return (CGKeyCode)0xFFFF;
  }
}

static int post_granted(void) {
  return CGPreflightPostEventAccess() && AXIsProcessTrusted();
}

static int post_state(void) {
  int post = CGPreflightPostEventAccess() ? 1 : 0;
  int ax = AXIsProcessTrusted() ? 1 : 0;
  if (post && ax) return 1;
  if (post || ax || g_post_requested) return 4;
  return 0;
}

static int listen_state(void) {
  if (CGPreflightListenEventAccess()) return 1;
  if (g_listen_requested) return 4;
  return 0;
}

static int injection_allowed(void) {
  if (IsSecureEventInputEnabled()) return 0;
  return post_granted();
}

int native_input_init(void) {
  native_macos_ensure_app();
  g_inited = 1;
  return 1;
}

void native_input_shutdown(void) {
  native_keyboard_capture_stop();
  native_hotkey_unregister();
  g_held_buttons = 0;
  g_inited = 0;
}

void native_input_query_caps(NativeCaps *out) {
  if (!out) return;
  int post = post_state();
  int listen = listen_state();
  out->accessibility = post;
  out->input_monitoring = listen;
  out->pointer_injection = post_granted();
  out->keyboard_injection = post_granted();
  out->keyboard_capture = post_granted();
  out->emergency_hotkey = listen == 1 && g_hotkey_registered && !g_emergency_dead;
  out->global_keyboard_observation = out->emergency_hotkey;
  if (!post_granted()) {
    snprintf(out->unavailable_reason, sizeof(out->unavailable_reason), "accessibility-permission");
  } else if (listen != 1) {
    snprintf(out->unavailable_reason, sizeof(out->unavailable_reason), "input-monitoring-permission");
  } else if (!g_hotkey_registered || g_emergency_dead) {
    snprintf(out->unavailable_reason, sizeof(out->unavailable_reason), "hotkey-registration-failed");
  } else {
    out->unavailable_reason[0] = 0;
  }
}

void native_input_pump(void) {
  if (g_tap || g_emergency_tap) CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.001, true);
}

int native_hotkey_poll(void) {
  if (g_emergency_dead) {
    g_emergency_dead = 0;
    g_hotkey_registered = 0;
    return 2;
  }
  int fired = g_hotkey_fired;
  g_hotkey_fired = 0;
  if (fired) capture_lock();
  return fired;
}

static void emergency_tap_stop(void) {
  if (g_emergency_tap) CGEventTapEnable(g_emergency_tap, false);
  if (g_emergency_src) {
    CFRunLoopRemoveSource(CFRunLoopGetCurrent(), g_emergency_src, kCFRunLoopCommonModes);
    CFRelease(g_emergency_src);
    g_emergency_src = NULL;
  }
  if (g_emergency_tap) {
    CFRelease(g_emergency_tap);
    g_emergency_tap = NULL;
  }
  g_hotkey_registered = 0;
}

static CGEventRef emergency_tap_callback(CGEventTapProxy proxy, CGEventType type, CGEventRef event, void *ref) {
  (void)proxy;
  (void)ref;
  if (type == kCGEventTapDisabledByTimeout || type == kCGEventTapDisabledByUserInput) {
    g_emergency_dead = 1;
    if (g_emergency_tap) CGEventTapEnable(g_emergency_tap, false);
    return event;
  }
  if (type != kCGEventKeyDown) return event;
  int64_t pid = CGEventGetIntegerValueField(event, kCGEventSourceUnixProcessID);
  if (pid > 0 && pid == (int64_t)getpid()) return event;
  CGKeyCode kc = (CGKeyCode)CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode);
  int repeat = (int)CGEventGetIntegerValueField(event, kCGKeyboardEventAutorepeat);
  if (repeat || kc != kVK_Escape) return event;
  unsigned int mods = mods_from_flags(CGEventGetFlags(event));
  if (mac_hotkey_match(mods)) g_hotkey_fired = 1;
  return event;
}

int native_hotkey_register(int ctrl, int alt, int shift, int meta, int key_escape) {
  (void)key_escape;
  native_macos_ensure_app();
  native_hotkey_unregister();
  g_hotkey_want_ctrl = ctrl;
  g_hotkey_want_alt = alt;
  g_hotkey_want_shift = shift;
  g_hotkey_want_meta = meta;
  g_emergency_dead = 0;
  if (!CGPreflightListenEventAccess()) {
    g_hotkey_registered = 0;
    return 0;
  }
  CGEventMask mask = CGEventMaskBit(kCGEventKeyDown);
  g_emergency_tap = CGEventTapCreate(
      kCGSessionEventTap,
      kCGHeadInsertEventTap,
      kCGEventTapOptionListenOnly,
      mask,
      emergency_tap_callback,
      NULL);
  if (!g_emergency_tap) return 0;
  g_emergency_src = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, g_emergency_tap, 0);
  CFRunLoopAddSource(CFRunLoopGetCurrent(), g_emergency_src, kCFRunLoopCommonModes);
  CGEventTapEnable(g_emergency_tap, true);
  g_hotkey_registered = 1;
  return 1;
}

void native_hotkey_unregister(void) {
  emergency_tap_stop();
}

int native_pointer_move(double x, double y) {
  if (!injection_allowed()) return -1;
  CGEventType type = kCGEventMouseMoved;
  CGMouseButton btn = kCGMouseButtonLeft;
  if (g_held_buttons & (1 << 1)) {
    type = kCGEventLeftMouseDragged;
    btn = kCGMouseButtonLeft;
  } else if (g_held_buttons & (1 << 3)) {
    type = kCGEventRightMouseDragged;
    btn = kCGMouseButtonRight;
  } else if (g_held_buttons & (1 << 2)) {
    type = kCGEventOtherMouseDragged;
    btn = kCGMouseButtonCenter;
  }
  CGEventRef e = CGEventCreateMouseEvent(NULL, type, CGPointMake(x, y), btn);
  if (!e) return -1;
  CGEventPost(kCGHIDEventTap, e);
  CFRelease(e);
  return 0;
}

int native_pointer_button(int button, int down) {
  if (!injection_allowed()) return -1;
  CGEventType type;
  CGMouseButton btn;
  if (button == 1) {
    type = down ? kCGEventLeftMouseDown : kCGEventLeftMouseUp;
    btn = kCGMouseButtonLeft;
  } else if (button == 2) {
    type = down ? kCGEventOtherMouseDown : kCGEventOtherMouseUp;
    btn = kCGMouseButtonCenter;
  } else if (button == 3) {
    type = down ? kCGEventRightMouseDown : kCGEventRightMouseUp;
    btn = kCGMouseButtonRight;
  } else {
    return -1;
  }
  CGEventRef loc = CGEventCreate(NULL);
  CGPoint pt = loc ? CGEventGetLocation(loc) : CGPointZero;
  if (loc) CFRelease(loc);
  CGEventRef e = CGEventCreateMouseEvent(NULL, type, pt, btn);
  if (!e) return -1;
  CGEventPost(kCGHIDEventTap, e);
  CFRelease(e);
  if (button >= 1 && button <= 31) {
    if (down) g_held_buttons |= 1 << button;
    else g_held_buttons &= ~(1 << button);
  }
  return 0;
}

int native_pointer_wheel(double dx, double dy) {
  if (!injection_allowed()) return -1;
  CGEventRef e = CGEventCreateScrollWheelEvent(NULL, kCGScrollEventUnitPixel, 2, (int32_t)(-dy), (int32_t)dx);
  if (!e) return -1;
  CGEventPost(kCGHIDEventTap, e);
  CFRelease(e);
  return 0;
}

int native_key_event(unsigned int key_code, int down, unsigned int modifiers) {
  if (!injection_allowed()) return -1;
  CGKeyCode vk = cg_for_portable(key_code);
  if (vk == (CGKeyCode)0xFFFF) return -1;
  CGEventRef e = CGEventCreateKeyboardEvent(NULL, vk, down ? true : false);
  if (!e) return -1;
  CGEventFlags flags = 0;
  if (modifiers & 1) flags |= kCGEventFlagMaskControl;
  if (modifiers & 2) flags |= kCGEventFlagMaskAlternate;
  if (modifiers & 4) flags |= kCGEventFlagMaskShift;
  if (modifiers & 8) flags |= kCGEventFlagMaskCommand;
  CGEventSetFlags(e, flags);
  CGEventPost(kCGHIDEventTap, e);
  CFRelease(e);
  return 0;
}

void native_input_activate_injection(void) {}

int native_input_request_permission(int kind) {
  native_macos_ensure_app();
  if (kind == 2) {
    g_listen_requested = 1;
    CGRequestListenEventAccess();
    return 0;
  }
  g_post_requested = 1;
  NSDictionary *opts = @{(__bridge NSString *)kAXTrustedCheckOptionPrompt : @YES};
  AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)opts);
  CGRequestPostEventAccess();
  return 0;
}

static unsigned int portable_from_cg(CGKeyCode key) {
  unsigned int pk;
  for (pk = 1; pk <= (unsigned int)PK_COUNT; pk++) {
    if (cg_for_portable(pk) == key) return pk;
  }
  return 0;
}

static int location_from_pk(unsigned int pk) {
  if (pk == PK_SHIFT_LEFT || pk == PK_CONTROL_LEFT || pk == PK_ALT_LEFT || pk == PK_META_LEFT) return 1;
  if (pk == PK_SHIFT_RIGHT || pk == PK_CONTROL_RIGHT || pk == PK_ALT_RIGHT || pk == PK_META_RIGHT) return 2;
  return 0;
}

static unsigned int mods_from_flags(CGEventFlags flags) {
  unsigned int mods = 0;
  if (flags & kCGEventFlagMaskControl) mods |= 1;
  if (flags & kCGEventFlagMaskAlternate) mods |= 2;
  if (flags & kCGEventFlagMaskShift) mods |= 4;
  if (flags & kCGEventFlagMaskCommand) mods |= 8;
  return mods;
}

static int mac_hotkey_match(unsigned int mods) {
  return (!g_hotkey_want_ctrl || (mods & 1)) &&
         (!g_hotkey_want_alt || (mods & 2)) &&
         (!g_hotkey_want_shift || (mods & 4)) &&
         (!g_hotkey_want_meta || (mods & 8));
}

static CGEventRef tap_callback(CGEventTapProxy proxy, CGEventType type, CGEventRef event, void *ref) {
  (void)proxy;
  (void)ref;
  if (type == kCGEventTapDisabledByTimeout || type == kCGEventTapDisabledByUserInput) {
    g_emergency_dead = 1;
    if (g_tap) CGEventTapEnable(g_tap, false);
    return event;
  }
  if (!g_capture_active) return event;
  if (g_hotkey_fired) return NULL;
  if (type == kCGEventKeyDown || type == kCGEventKeyUp) {
    CGKeyCode kc = (CGKeyCode)CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode);
    int down = type == kCGEventKeyDown;
    int repeat = (int)CGEventGetIntegerValueField(event, kCGKeyboardEventAutorepeat);
    unsigned int pk = portable_from_cg(kc);
    unsigned int mods = mods_from_flags(CGEventGetFlags(event));
    cap_push(pk, down, mods, location_from_pk(pk), repeat);
    return NULL;
  }
  if (type == kCGEventFlagsChanged) {
    CGEventFlags flags = CGEventGetFlags(event);
    CGEventFlags changed = flags ^ g_mac_last_flags;
    g_mac_last_flags = flags;
    unsigned int mods = mods_from_flags(flags);
    if (changed & kCGEventFlagMaskControl) {
      cap_push(PK_CONTROL_LEFT, (flags & kCGEventFlagMaskControl) ? 1 : 0, mods, 1, 0);
    }
    if (changed & kCGEventFlagMaskAlternate) {
      cap_push(PK_ALT_LEFT, (flags & kCGEventFlagMaskAlternate) ? 1 : 0, mods, 1, 0);
    }
    if (changed & kCGEventFlagMaskShift) {
      cap_push(PK_SHIFT_LEFT, (flags & kCGEventFlagMaskShift) ? 1 : 0, mods, 1, 0);
    }
    if (changed & kCGEventFlagMaskCommand) {
      cap_push(PK_META_LEFT, (flags & kCGEventFlagMaskCommand) ? 1 : 0, mods, 1, 0);
    }
    return NULL;
  }
  return event;
}

int native_keyboard_capture_start(void) {
  if (g_capture_locked) return 0;
  if (g_capture_active) return 1;
  if (!AXIsProcessTrusted()) return 0;
  g_cap_head = g_cap_tail = 0;
  CGEventMask mask =
      CGEventMaskBit(kCGEventKeyDown) | CGEventMaskBit(kCGEventKeyUp) | CGEventMaskBit(kCGEventFlagsChanged);
  g_tap = CGEventTapCreate(
      kCGSessionEventTap,
      kCGHeadInsertEventTap,
      kCGEventTapOptionDefault,
      mask,
      tap_callback,
      NULL);
  if (!g_tap) return 0;
  g_tap_src = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, g_tap, 0);
  CFRunLoopAddSource(CFRunLoopGetCurrent(), g_tap_src, kCFRunLoopCommonModes);
  CGEventTapEnable(g_tap, true);
  g_mac_last_flags = CGEventSourceFlagsState(kCGEventSourceStateCombinedSessionState);
  g_capture_active = 1;
  return 1;
}

void native_keyboard_capture_stop(void) {
  if (g_tap) CGEventTapEnable(g_tap, false);
  if (g_tap_src) {
    CFRunLoopRemoveSource(CFRunLoopGetCurrent(), g_tap_src, kCFRunLoopCommonModes);
    CFRelease(g_tap_src);
    g_tap_src = NULL;
  }
  if (g_tap) {
    CFRelease(g_tap);
    g_tap = NULL;
  }
  g_capture_active = 0;
  g_cap_head = g_cap_tail = 0;
}
