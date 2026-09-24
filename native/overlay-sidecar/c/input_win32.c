#include "input_native.h"
#include "portable_keys.h"

#include <stdio.h>
#include <string.h>
#include <windows.h>

static CRITICAL_SECTION g_cap_cs;
static volatile LONG g_cap_cs_ready;

static void cap_lock_impl(void) {
  if (g_cap_cs_ready) EnterCriticalSection(&g_cap_cs);
}

static void cap_unlock_impl(void) {
  if (g_cap_cs_ready) LeaveCriticalSection(&g_cap_cs);
}

#define p2p_cap_lock() cap_lock_impl()
#define p2p_cap_unlock() cap_unlock_impl()
#include "capture_queue.h"

#define KIWI_HOOK_SYNC (WM_APP + 1)
#define KIWI_HOOK_CAPTURE (WM_APP + 2)
#define KIWI_HOOK_STOP (WM_APP + 3)

static HWND g_hotkey_hwnd;
static volatile LONG g_hotkey_fired;
static volatile int g_hotkey_registered;
static int g_hotkey_want_installed;
static int g_hotkey_want_ctrl = 1;
static int g_hotkey_want_alt;
static int g_hotkey_want_shift;
static int g_hotkey_want_meta;
static int g_capture_want;
static int g_inited;
static HHOOK g_kb_hook;
static HHOOK g_emergency_hook;
static unsigned int g_win_mods;
static unsigned int g_phys_mods;
static HANDLE g_hook_thread;
static DWORD g_hook_tid;
static HANDLE g_hook_ready;
static unsigned short g_pk_by_vk[256];
static int g_pk_by_vk_ready;

#ifndef LLKHF_INJECTED
#define LLKHF_INJECTED 0x10
#endif
#ifndef LLKHF_LOWER_IL_INJECTED
#define LLKHF_LOWER_IL_INJECTED 0x02
#endif

static LRESULT CALLBACK emergency_ll(int ncode, WPARAM wparam, LPARAM lparam);
static LRESULT CALLBACK ll_keyboard(int ncode, WPARAM wparam, LPARAM lparam);
static DWORD WINAPI hook_thread_main(LPVOID param);
static LRESULT hook_send(UINT msg, WPARAM wparam);

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
  InitializeCriticalSection(&g_cap_cs);
  g_cap_cs_ready = 1;
  g_hook_ready = CreateEventA(NULL, TRUE, FALSE, NULL);
  if (!g_hook_ready) return 0;
  g_hook_thread = CreateThread(NULL, 0, hook_thread_main, NULL, 0, &g_hook_tid);
  if (!g_hook_thread) return 0;
  WaitForSingleObject(g_hook_ready, 3000);
  g_inited = g_hotkey_hwnd != NULL;
  if (!g_inited && g_hook_thread) {
    WaitForSingleObject(g_hook_thread, 1000);
    CloseHandle(g_hook_thread);
    g_hook_thread = NULL;
  }
  return g_inited;
}

void native_input_shutdown(void) {
  if (g_hotkey_hwnd) hook_send(KIWI_HOOK_STOP, 0);
  if (g_hook_thread) {
    WaitForSingleObject(g_hook_thread, 2000);
    CloseHandle(g_hook_thread);
    g_hook_thread = NULL;
  }
  if (g_hook_ready) {
    CloseHandle(g_hook_ready);
    g_hook_ready = NULL;
  }
  g_hotkey_hwnd = NULL;
  g_inited = 0;
  if (g_cap_cs_ready) {
    g_cap_cs_ready = 0;
    DeleteCriticalSection(&g_cap_cs);
  }
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
  /* Hook messages are pumped on the dedicated hook thread. */
}

int native_hotkey_poll(void) {
  LONG fired = InterlockedExchange(&g_hotkey_fired, 0);
  if (fired) capture_lock();
  return fired ? 1 : 0;
}

int native_hotkey_register(int ctrl, int alt, int shift, int meta, int key_escape) {
  (void)key_escape;
  if (!native_input_init()) return 0;
  g_hotkey_want_ctrl = ctrl;
  g_hotkey_want_alt = alt;
  g_hotkey_want_shift = shift;
  g_hotkey_want_meta = meta;
  g_phys_mods = 0;
  g_hotkey_want_installed = 1;
  return (int)hook_send(KIWI_HOOK_SYNC, 0);
}

void native_hotkey_unregister(void) {
  g_hotkey_want_installed = 0;
  if (g_hotkey_hwnd) hook_send(KIWI_HOOK_SYNC, 0);
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

int native_pointer_move_for_source(const NativeSource *source, double nx, double ny) {
  int x = 0;
  int y = 0;
  int w = 1;
  int h = 1;
  double px = 0;
  double py = 0;
  if (source) native_display_rect(source, &x, &y, &w, &h);
  normalized_to_rect(nx, ny, x, y, w, h, &px, &py);
  return native_pointer_move(px, py);
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

void native_input_activate_injection(void) {}

int native_input_request_permission(int kind) {
  (void)kind;
  return 0;
}

static void ensure_vk_table(void) {
  unsigned int pk;
  if (g_pk_by_vk_ready) return;
  for (pk = 1; pk <= (unsigned int)PK_COUNT; pk++) {
    int extended = 0;
    int vk = vk_for_portable(pk, &extended);
    if (vk > 0 && vk < 256 && g_pk_by_vk[vk] == 0) g_pk_by_vk[vk] = (unsigned short)pk;
  }
  g_pk_by_vk_ready = 1;
}

static unsigned int portable_from_vk(int vk) {
  ensure_vk_table();
  if (vk == VK_CONTROL) vk = VK_LCONTROL;
  if (vk == VK_MENU) vk = VK_LMENU;
  if (vk == VK_SHIFT) vk = VK_LSHIFT;
  if (vk < 0 || vk > 255) return 0;
  return g_pk_by_vk[vk];
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

static int win_injected(const KBDLLHOOKSTRUCT *info) {
  return info && (info->flags & (LLKHF_INJECTED | LLKHF_LOWER_IL_INJECTED)) != 0;
}

static void note_phys_mod(unsigned int pk, int down) {
  unsigned int bit = 0;
  if (pk == PK_CONTROL_LEFT || pk == PK_CONTROL_RIGHT) bit = 1;
  else if (pk == PK_ALT_LEFT || pk == PK_ALT_RIGHT) bit = 2;
  else if (pk == PK_SHIFT_LEFT || pk == PK_SHIFT_RIGHT) bit = 4;
  else if (pk == PK_META_LEFT || pk == PK_META_RIGHT) bit = 8;
  if (!bit) return;
  if (down) g_phys_mods |= bit;
  else g_phys_mods &= ~bit;
}

static LRESULT CALLBACK emergency_ll(int ncode, WPARAM wparam, LPARAM lparam) {
  if (ncode == HC_ACTION && !g_capture_active) {
    KBDLLHOOKSTRUCT *info = (KBDLLHOOKSTRUCT *)lparam;
    if (!win_injected(info)) {
      int down = (wparam == WM_KEYDOWN || wparam == WM_SYSKEYDOWN);
      unsigned int pk = portable_from_vk((int)info->vkCode);
      note_phys_mod(pk, down);
      if (down && info->vkCode == VK_ESCAPE && win_hotkey_match(g_phys_mods)) {
        InterlockedExchange(&g_hotkey_fired, 1);
        capture_lock();
        return 1;
      }
    }
  }
  return CallNextHookEx(g_emergency_hook, ncode, wparam, lparam);
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
    cap_push(pk, down, g_win_mods, location_from_pk(pk), 0);
    return 1;
  }
  return CallNextHookEx(g_kb_hook, ncode, wparam, lparam);
}

static void remove_hooks(void) {
  if (g_kb_hook) {
    UnhookWindowsHookEx(g_kb_hook);
    g_kb_hook = NULL;
  }
  if (g_emergency_hook) {
    UnhookWindowsHookEx(g_emergency_hook);
    g_emergency_hook = NULL;
  }
  g_hotkey_registered = 0;
  g_capture_active = 0;
}

static void sync_emergency_hook(void) {
  if (g_hotkey_want_installed) {
    if (!g_emergency_hook) {
      g_emergency_hook = SetWindowsHookExA(WH_KEYBOARD_LL, emergency_ll, GetModuleHandleA(NULL), 0);
    }
    g_hotkey_registered = g_emergency_hook ? 1 : 0;
    return;
  }
  if (g_emergency_hook) {
    UnhookWindowsHookEx(g_emergency_hook);
    g_emergency_hook = NULL;
  }
  g_hotkey_registered = 0;
}

static int sync_capture_hook(int want) {
  g_capture_want = want ? 1 : 0;
  if (g_capture_want) {
    if (g_capture_active && g_kb_hook) return 1;
    p2p_cap_lock();
    g_cap_head = g_cap_tail = 0;
    p2p_cap_unlock();
    g_win_mods = 0;
    if (!g_kb_hook) {
      g_kb_hook = SetWindowsHookExA(WH_KEYBOARD_LL, ll_keyboard, GetModuleHandleA(NULL), 0);
    }
    g_capture_active = g_kb_hook ? 1 : 0;
    return g_capture_active;
  }
  if (g_kb_hook) {
    UnhookWindowsHookEx(g_kb_hook);
    g_kb_hook = NULL;
  }
  g_capture_active = 0;
  p2p_cap_lock();
  g_cap_head = g_cap_tail = 0;
  p2p_cap_unlock();
  return 0;
}

static LRESULT CALLBACK hook_wnd_proc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
  if (msg == KIWI_HOOK_SYNC) {
    sync_emergency_hook();
    return g_hotkey_registered;
  }
  if (msg == KIWI_HOOK_CAPTURE) {
    return sync_capture_hook(wParam ? 1 : 0);
  }
  if (msg == KIWI_HOOK_STOP) {
    remove_hooks();
    DestroyWindow(hwnd);
    PostQuitMessage(0);
    return 0;
  }
  return DefWindowProcA(hwnd, msg, wParam, lParam);
}

static LRESULT hook_send(UINT msg, WPARAM wparam) {
  if (!g_hotkey_hwnd) return 0;
  return SendMessageA(g_hotkey_hwnd, msg, wparam, 0);
}

static DWORD WINAPI hook_thread_main(LPVOID param) {
  MSG msg;
  WNDCLASSEXA wc;
  (void)param;
  memset(&wc, 0, sizeof(wc));
  wc.cbSize = sizeof(wc);
  wc.lpfnWndProc = hook_wnd_proc;
  wc.hInstance = GetModuleHandle(NULL);
  wc.lpszClassName = "p2p.kiwi.input";
  RegisterClassExA(&wc);
  g_hotkey_hwnd = CreateWindowExA(
      0, wc.lpszClassName, "", 0, 0, 0, 0, 0, HWND_MESSAGE, NULL, wc.hInstance, NULL);
  if (!g_hotkey_hwnd) {
    if (g_hook_ready) SetEvent(g_hook_ready);
    return 0;
  }
  PeekMessageA(&msg, NULL, WM_USER, WM_USER, PM_NOREMOVE);
  if (g_hook_ready) SetEvent(g_hook_ready);
  while (GetMessageA(&msg, NULL, 0, 0) > 0) {
    TranslateMessage(&msg);
    DispatchMessageA(&msg);
  }
  g_hotkey_hwnd = NULL;
  return 0;
}

int native_keyboard_capture_start(void) {
  if (capture_is_locked()) return 0;
  if (!native_input_init()) return 0;
  return (int)hook_send(KIWI_HOOK_CAPTURE, 1);
}

void native_keyboard_capture_stop(void) {
  if (!g_hotkey_hwnd) {
    g_capture_active = 0;
    return;
  }
  hook_send(KIWI_HOOK_CAPTURE, 0);
}
