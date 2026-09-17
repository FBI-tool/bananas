#include "input_native.h"
#include "portable_keys.h"
#include "capture_queue.h"

#include <stdio.h>
#include <string.h>
#include <windows.h>

static HWND g_hotkey_hwnd;
static int g_hotkey_fired;
static int g_hotkey_registered;
static int g_hotkey_want_ctrl = 1;
static int g_hotkey_want_alt;
static int g_hotkey_want_shift;
static int g_hotkey_want_meta;
static int g_inited;
static HHOOK g_kb_hook;
static unsigned int g_win_mods;

static LRESULT CALLBACK hotkey_proc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
  if (msg == WM_HOTKEY) {
    g_hotkey_fired = 1;
    capture_lock();
    return 0;
  }
  return DefWindowProcA(hwnd, msg, wParam, lParam);
}

static int vk_for_portable(unsigned int code, int *extended) {
  *extended = 0;
  if (code == PK_ESCAPE) return VK_ESCAPE;
  if (code >= PK_DIGIT0 && code <= PK_DIGIT9) return '0' + (int)(code - PK_DIGIT0);
  if (code >= PK_A && code <= PK_Z) return 'A' + (int)(code - PK_A);
  if (code >= PK_F1 && code <= PK_F24) return VK_F1 + (int)(code - PK_F1);
  switch (code) {
    case PK_SHIFT_LEFT: return VK_LSHIFT;
    case PK_SHIFT_RIGHT: return VK_RSHIFT;
    case PK_CONTROL_LEFT: return VK_LCONTROL;
    case PK_CONTROL_RIGHT: *extended = 1; return VK_RCONTROL;
    case PK_ALT_LEFT: return VK_LMENU;
    case PK_ALT_RIGHT: *extended = 1; return VK_RMENU;
    case PK_META_LEFT: return VK_LWIN;
    case PK_META_RIGHT: return VK_RWIN;
    case PK_ENTER: return VK_RETURN;
    case PK_SPACE: return VK_SPACE;
    case PK_TAB: return VK_TAB;
    case PK_BACKSPACE: return VK_BACK;
    case PK_DELETE: *extended = 1; return VK_DELETE;
    case PK_INSERT: *extended = 1; return VK_INSERT;
    case PK_HOME: *extended = 1; return VK_HOME;
    case PK_END: *extended = 1; return VK_END;
    case PK_PAGE_UP: *extended = 1; return VK_PRIOR;
    case PK_PAGE_DOWN: *extended = 1; return VK_NEXT;
    case PK_ARROW_UP: *extended = 1; return VK_UP;
    case PK_ARROW_DOWN: *extended = 1; return VK_DOWN;
    case PK_ARROW_LEFT: *extended = 1; return VK_LEFT;
    case PK_ARROW_RIGHT: *extended = 1; return VK_RIGHT;
    case PK_CAPS_LOCK: return VK_CAPITAL;
    case PK_NUM_LOCK: return VK_NUMLOCK;
    case PK_SCROLL_LOCK: return VK_SCROLL;
    case PK_PAUSE: return VK_PAUSE;
    case PK_PRINT_SCREEN: *extended = 1; return VK_SNAPSHOT;
    case PK_CONTEXT_MENU: *extended = 1; return VK_APPS;
    case PK_NUMPAD0: return VK_NUMPAD0;
    case PK_NUMPAD1: return VK_NUMPAD1;
    case PK_NUMPAD2: return VK_NUMPAD2;
    case PK_NUMPAD3: return VK_NUMPAD3;
    case PK_NUMPAD4: return VK_NUMPAD4;
    case PK_NUMPAD5: return VK_NUMPAD5;
    case PK_NUMPAD6: return VK_NUMPAD6;
    case PK_NUMPAD7: return VK_NUMPAD7;
    case PK_NUMPAD8: return VK_NUMPAD8;
    case PK_NUMPAD9: return VK_NUMPAD9;
    case PK_NUMPAD_ADD: return VK_ADD;
    case PK_NUMPAD_SUBTRACT: return VK_SUBTRACT;
    case PK_NUMPAD_MULTIPLY: return VK_MULTIPLY;
    case PK_NUMPAD_DIVIDE: *extended = 1; return VK_DIVIDE;
    case PK_NUMPAD_DECIMAL: return VK_DECIMAL;
    case PK_NUMPAD_ENTER: *extended = 1; return VK_RETURN;
    case PK_MINUS: return VK_OEM_MINUS;
    case PK_EQUAL: return VK_OEM_PLUS;
    case PK_BRACKET_LEFT: return VK_OEM_4;
    case PK_BRACKET_RIGHT: return VK_OEM_6;
    case PK_BACKSLASH: return VK_OEM_5;
    case PK_SEMICOLON: return VK_OEM_1;
    case PK_QUOTE: return VK_OEM_7;
    case PK_BACKQUOTE: return VK_OEM_3;
    case PK_COMMA: return VK_OEM_COMMA;
    case PK_PERIOD: return VK_OEM_PERIOD;
    case PK_SLASH: return VK_OEM_2;
    case PK_VOLUME_MUTE: return VK_VOLUME_MUTE;
    case PK_VOLUME_DOWN: return VK_VOLUME_DOWN;
    case PK_VOLUME_UP: return VK_VOLUME_UP;
    case PK_MEDIA_NEXT: return VK_MEDIA_NEXT_TRACK;
    case PK_MEDIA_PREV: return VK_MEDIA_PREV_TRACK;
    case PK_MEDIA_PLAY: return VK_MEDIA_PLAY_PAUSE;
    case PK_MEDIA_STOP: return VK_MEDIA_STOP;
    default: return 0;
  }
}

int native_input_init(void) {
  if (g_inited) return 1;
  WNDCLASSEXA wc;
  memset(&wc, 0, sizeof(wc));
  wc.cbSize = sizeof(wc);
  wc.lpfnWndProc = hotkey_proc;
  wc.hInstance = GetModuleHandle(NULL);
  wc.lpszClassName = "p2p.kiwi.input";
  RegisterClassExA(&wc);
  g_hotkey_hwnd = CreateWindowExA(0, wc.lpszClassName, "", 0, 0, 0, 0, 0, HWND_MESSAGE, NULL, wc.hInstance, NULL);
  g_inited = g_hotkey_hwnd != NULL;
  return g_inited;
}

void native_input_shutdown(void) {
  native_keyboard_capture_stop();
  native_hotkey_unregister();
  if (g_hotkey_hwnd) DestroyWindow(g_hotkey_hwnd);
  g_hotkey_hwnd = NULL;
  g_inited = 0;
}

void native_input_query_caps(NativeCaps *out) {
  if (!out) return;
  out->pointer_injection = 1;
  out->keyboard_injection = 1;
  out->global_keyboard_observation = g_hotkey_registered ? 1 : 0;
  out->emergency_hotkey = g_hotkey_registered ? 1 : 0;
  out->keyboard_capture = 1;
  if (!g_hotkey_registered) {
    snprintf(out->unavailable_reason, sizeof(out->unavailable_reason), "hotkey-registration-failed");
  } else {
    out->unavailable_reason[0] = 0;
  }
}

void native_input_pump(void) {
  MSG msg;
  HWND target = g_capture_active ? NULL : g_hotkey_hwnd;
  while (PeekMessageA(&msg, target, 0, 0, PM_REMOVE)) {
    TranslateMessage(&msg);
    DispatchMessageA(&msg);
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
  if (!native_input_init()) return 0;
  native_hotkey_unregister();
  g_hotkey_want_ctrl = ctrl;
  g_hotkey_want_alt = alt;
  g_hotkey_want_shift = shift;
  g_hotkey_want_meta = meta;
  UINT mods = 0;
  if (ctrl) mods |= MOD_CONTROL;
  if (alt) mods |= MOD_ALT;
  if (shift) mods |= MOD_SHIFT;
  if (meta) mods |= MOD_WIN;
  mods |= MOD_NOREPEAT;
  g_hotkey_registered = RegisterHotKey(g_hotkey_hwnd, 1, mods, VK_ESCAPE) ? 1 : 0;
  return g_hotkey_registered;
}

void native_hotkey_unregister(void) {
  if (g_hotkey_hwnd && g_hotkey_registered) UnregisterHotKey(g_hotkey_hwnd, 1);
  g_hotkey_registered = 0;
}

int native_pointer_move(double x, double y) {
  INPUT in;
  memset(&in, 0, sizeof(in));
  in.type = INPUT_MOUSE;
  int vs_w = GetSystemMetrics(SM_CXVIRTUALSCREEN);
  int vs_h = GetSystemMetrics(SM_CYVIRTUALSCREEN);
  int vs_x = GetSystemMetrics(SM_XVIRTUALSCREEN);
  int vs_y = GetSystemMetrics(SM_YVIRTUALSCREEN);
  if (vs_w <= 1) vs_w = 2;
  if (vs_h <= 1) vs_h = 2;
  in.mi.dx = (LONG)(((x - vs_x) * 65535.0) / (vs_w - 1));
  in.mi.dy = (LONG)(((y - vs_y) * 65535.0) / (vs_h - 1));
  in.mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK;
  return SendInput(1, &in, sizeof(INPUT)) == 1 ? 0 : -1;
}

int native_pointer_button(int button, int down) {
  INPUT in;
  memset(&in, 0, sizeof(in));
  in.type = INPUT_MOUSE;
  DWORD flags = 0;
  DWORD data = 0;
  if (button == 1) flags = down ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_LEFTUP;
  else if (button == 2) flags = down ? MOUSEEVENTF_MIDDLEDOWN : MOUSEEVENTF_MIDDLEUP;
  else if (button == 3) flags = down ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_RIGHTUP;
  else if (button == 4 || button == 5) {
    flags = down ? MOUSEEVENTF_XDOWN : MOUSEEVENTF_XUP;
    data = button == 4 ? XBUTTON1 : XBUTTON2;
  } else {
    return -1;
  }
  in.mi.dwFlags = flags;
  in.mi.mouseData = data;
  return SendInput(1, &in, sizeof(INPUT)) == 1 ? 0 : -1;
}

int native_pointer_wheel(double dx, double dy) {
  int ok = 0;
  if (dy != 0) {
    INPUT in;
    memset(&in, 0, sizeof(in));
    in.type = INPUT_MOUSE;
    in.mi.dwFlags = MOUSEEVENTF_WHEEL;
    in.mi.mouseData = (DWORD)(dy > 0 ? 120 : (dy < 0 ? -120 : 0) * (dy > 400 || dy < -400 ? 2 : 1));
    if (dy > 0) in.mi.mouseData = (DWORD)WHEEL_DELTA;
    else in.mi.mouseData = (DWORD)(-(int)WHEEL_DELTA);
    ok |= SendInput(1, &in, sizeof(INPUT)) == 1;
  }
  if (dx != 0) {
    INPUT in;
    memset(&in, 0, sizeof(in));
    in.type = INPUT_MOUSE;
    in.mi.dwFlags = MOUSEEVENTF_HWHEEL;
    in.mi.mouseData = dx > 0 ? (DWORD)WHEEL_DELTA : (DWORD)(-(int)WHEEL_DELTA);
    ok |= SendInput(1, &in, sizeof(INPUT)) == 1;
  }
  return ok ? 0 : -1;
}

int native_key_event(unsigned int key_code, int down, unsigned int modifiers) {
  (void)modifiers;
  int extended = 0;
  int vk = vk_for_portable(key_code, &extended);
  if (!vk) return -1;
  INPUT in;
  memset(&in, 0, sizeof(in));
  in.type = INPUT_KEYBOARD;
  in.ki.wVk = 0;
  in.ki.wScan = (WORD)MapVirtualKeyA((UINT)vk, MAPVK_VK_TO_VSC);
  in.ki.dwFlags = KEYEVENTF_SCANCODE;
  if (extended) in.ki.dwFlags |= KEYEVENTF_EXTENDEDKEY;
  if (!down) in.ki.dwFlags |= KEYEVENTF_KEYUP;
  return SendInput(1, &in, sizeof(INPUT)) == 1 ? 0 : -1;
}

int native_input_request_permission(void) { return 0; }

static unsigned int portable_from_vk(int vk) {
  int extended = 0;
  unsigned int pk;
  if (vk == VK_CONTROL) vk = VK_LCONTROL;
  if (vk == VK_MENU) vk = VK_LMENU;
  if (vk == VK_SHIFT) vk = VK_LSHIFT;
  for (pk = 1; pk <= (unsigned int)PK_COUNT; pk++) {
    if (vk_for_portable(pk, &extended) == vk) return pk;
  }
  return 0;
}

static int location_from_pk(unsigned int pk) {
  if (pk == PK_SHIFT_LEFT || pk == PK_CONTROL_LEFT || pk == PK_ALT_LEFT || pk == PK_META_LEFT) return 1;
  if (pk == PK_SHIFT_RIGHT || pk == PK_CONTROL_RIGHT || pk == PK_ALT_RIGHT || pk == PK_META_RIGHT) return 2;
  if (pk >= PK_NUMPAD0 && pk <= PK_NUMPAD_ENTER) return 3;
  return 0;
}

static int win_hotkey_match(unsigned int mods) {
  return (!g_hotkey_want_ctrl || (mods & 1)) &&
         (!g_hotkey_want_alt || (mods & 2)) &&
         (!g_hotkey_want_shift || (mods & 4)) &&
         (!g_hotkey_want_meta || (mods & 8));
}

static LRESULT CALLBACK ll_keyboard(int ncode, WPARAM wparam, LPARAM lparam) {
  if (ncode == HC_ACTION && g_capture_active) {
    KBDLLHOOKSTRUCT *info = (KBDLLHOOKSTRUCT *)lparam;
    int down = (wparam == WM_KEYDOWN || wparam == WM_SYSKEYDOWN);
    unsigned int pk = portable_from_vk((int)info->vkCode);
    if (pk == PK_CONTROL_LEFT || pk == PK_CONTROL_RIGHT) {
      if (down) g_win_mods |= 1; else g_win_mods &= ~1u;
    } else if (pk == PK_ALT_LEFT || pk == PK_ALT_RIGHT) {
      if (down) g_win_mods |= 2; else g_win_mods &= ~2u;
    } else if (pk == PK_SHIFT_LEFT || pk == PK_SHIFT_RIGHT) {
      if (down) g_win_mods |= 4; else g_win_mods &= ~4u;
    } else if (pk == PK_META_LEFT || pk == PK_META_RIGHT) {
      if (down) g_win_mods |= 8; else g_win_mods &= ~8u;
    }
    if (down && info->vkCode == VK_ESCAPE && win_hotkey_match(g_win_mods)) {
      g_hotkey_fired = 1;
      capture_lock();
      return 1;
    }
    if (g_hotkey_fired) return 1;
    cap_push(pk, down, g_win_mods, location_from_pk(pk), 0);
    return 1;
  }
  return CallNextHookEx(g_kb_hook, ncode, wparam, lparam);
}

int native_keyboard_capture_start(void) {
  if (g_capture_locked) return 0;
  if (g_capture_active) return 1;
  if (!native_input_init()) return 0;
  g_cap_head = g_cap_tail = 0;
  g_win_mods = 0;
  g_kb_hook = SetWindowsHookExA(WH_KEYBOARD_LL, ll_keyboard, GetModuleHandleA(NULL), 0);
  if (!g_kb_hook) return 0;
  g_capture_active = 1;
  return 1;
}

void native_keyboard_capture_stop(void) {
  if (g_kb_hook) {
    UnhookWindowsHookEx(g_kb_hook);
    g_kb_hook = NULL;
  }
  g_capture_active = 0;
  g_cap_head = g_cap_tail = 0;
}
