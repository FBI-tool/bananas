#include <stdio.h>
#import "input_native.h"
#import "portable_keys.h"
#import "capture_queue.h"

#import <ApplicationServices/ApplicationServices.h>
#import <Carbon/Carbon.h>
#import <Foundation/Foundation.h>

static EventHandlerRef g_hotkey_handler;
static EventHotKeyRef g_hotkey_ref;
static int g_hotkey_fired;
static int g_hotkey_registered;
static int g_hotkey_want_ctrl = 1;
static int g_hotkey_want_alt;
static int g_hotkey_want_shift;
static int g_hotkey_want_meta;
static int g_inited;
static CFMachPortRef g_tap;
static CFRunLoopSourceRef g_tap_src;
static unsigned int g_mac_mods;
static CGEventFlags g_mac_last_flags;

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

static OSStatus hotkey_callback(EventHandlerCallRef call, EventRef event, void *user) {
  (void)call;
  (void)event;
  (void)user;
  g_hotkey_fired = 1;
  capture_lock();
  return noErr;
}

int native_input_init(void) {
  g_inited = 1;
  return 1;
}

void native_input_shutdown(void) {
  native_keyboard_capture_stop();
  native_hotkey_unregister();
  g_inited = 0;
}

void native_input_query_caps(NativeCaps *out) {
  if (!out) return;
  int trusted = AXIsProcessTrusted() ? 1 : 0;
  out->accessibility = trusted ? 1 : 2;
  out->pointer_injection = trusted;
  out->keyboard_injection = trusted;
  out->emergency_hotkey = trusted && g_hotkey_registered;
  out->keyboard_capture = trusted;
  out->global_keyboard_observation = out->emergency_hotkey;
  if (!trusted) {
    snprintf(out->unavailable_reason, sizeof(out->unavailable_reason), "accessibility-permission");
  } else if (!g_hotkey_registered) {
    snprintf(out->unavailable_reason, sizeof(out->unavailable_reason), "hotkey-registration-failed");
  } else {
    out->unavailable_reason[0] = 0;
  }
}

void native_input_pump(void) {
  if (g_tap) CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.001, true);
}

int native_hotkey_poll(void) {
  int fired = g_hotkey_fired;
  g_hotkey_fired = 0;
  if (fired) capture_lock();
  return fired;
}

int native_hotkey_register(int ctrl, int alt, int shift, int meta, int key_escape) {
  (void)key_escape;
  native_hotkey_unregister();
  g_hotkey_want_ctrl = ctrl;
  g_hotkey_want_alt = alt;
  g_hotkey_want_shift = shift;
  g_hotkey_want_meta = meta;
  EventTypeSpec spec = {kEventClassKeyboard, kEventHotKeyPressed};
  if (!g_hotkey_handler) {
    InstallApplicationEventHandler(NewEventHandlerUPP(hotkey_callback), 1, &spec, NULL, &g_hotkey_handler);
  }
  UInt32 mods = 0;
  if (ctrl) mods |= controlKey;
  if (alt) mods |= optionKey;
  if (shift) mods |= shiftKey;
  if (meta) mods |= cmdKey;
  EventHotKeyID hid = { 'p2pk', 1 };
  OSStatus st = RegisterEventHotKey(kVK_Escape, mods, hid, GetApplicationEventTarget(), 0, &g_hotkey_ref);
  g_hotkey_registered = st == noErr;
  return g_hotkey_registered;
}

void native_hotkey_unregister(void) {
  if (g_hotkey_ref) {
    UnregisterEventHotKey(g_hotkey_ref);
    g_hotkey_ref = NULL;
  }
  g_hotkey_registered = 0;
}

int native_pointer_move(double x, double y) {
  CGEventRef e = CGEventCreateMouseEvent(NULL, kCGEventMouseMoved, CGPointMake(x, y), kCGMouseButtonLeft);
  if (!e) return -1;
  CGEventPost(kCGHIDEventTap, e);
  CFRelease(e);
  return 0;
}

int native_pointer_button(int button, int down) {
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
  return 0;
}

int native_pointer_wheel(double dx, double dy) {
  CGEventRef e = CGEventCreateScrollWheelEvent(NULL, kCGScrollEventUnitPixel, 2, (int32_t)(-dy), (int32_t)dx);
  if (!e) return -1;
  CGEventPost(kCGHIDEventTap, e);
  CFRelease(e);
  return 0;
}

int native_key_event(unsigned int key_code, int down, unsigned int modifiers) {
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

int native_input_request_permission(void) {
  NSDictionary *opts = @{(__bridge NSString *)kAXTrustedCheckOptionPrompt : @YES};
  AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)opts);
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
    if (g_tap) CGEventTapEnable(g_tap, true);
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
    if (down && kc == kVK_Escape && mac_hotkey_match(mods)) {
      g_hotkey_fired = 1;
      capture_lock();
      return NULL;
    }
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
