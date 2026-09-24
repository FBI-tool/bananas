#ifndef P2P_KIWI_CAPTURE_QUEUE_H
#define P2P_KIWI_CAPTURE_QUEUE_H

#include "input_native.h"

#define P2P_CAP_Q 256

#ifndef p2p_cap_lock
#define p2p_cap_lock() ((void)0)
#define p2p_cap_unlock() ((void)0)
#endif

static NativeCapturedKey g_cap_q[P2P_CAP_Q];
static int g_cap_head;
static int g_cap_tail;
static int g_capture_active;
#ifdef _WIN32
static volatile LONG g_capture_locked;
#else
static int g_capture_locked;
#endif

static void capture_lock(void) {
#ifdef _WIN32
  InterlockedExchange(&g_capture_locked, 1);
#else
  g_capture_locked = 1;
#endif
}

static int capture_is_locked(void) {
#ifdef _WIN32
  return InterlockedCompareExchange(&g_capture_locked, 0, 0) != 0;
#else
  return g_capture_locked;
#endif
}

void native_keyboard_capture_unlock(void) {
#ifdef _WIN32
  InterlockedExchange(&g_capture_locked, 0);
#else
  g_capture_locked = 0;
#endif
}

static void cap_push(
    unsigned int key_code,
    int down,
    unsigned int modifiers,
    int location,
    int repeat
) {
  p2p_cap_lock();
  if (!g_capture_active || key_code == 0) {
    p2p_cap_unlock();
    return;
  }
  int next = (g_cap_head + 1) % P2P_CAP_Q;
  if (next == g_cap_tail) g_cap_tail = (g_cap_tail + 1) % P2P_CAP_Q;
  g_cap_q[g_cap_head].key_code = key_code;
  g_cap_q[g_cap_head].down = down ? 1 : 0;
  g_cap_q[g_cap_head].modifiers = modifiers;
  g_cap_q[g_cap_head].location = location;
  g_cap_q[g_cap_head].repeat = repeat ? 1 : 0;
  g_cap_head = next;
  p2p_cap_unlock();
}

int native_keyboard_capture_poll(NativeCapturedKey *out) {
  if (!out) return 0;
  p2p_cap_lock();
  if (g_cap_tail == g_cap_head) {
    p2p_cap_unlock();
    return 0;
  }
  *out = g_cap_q[g_cap_tail];
  g_cap_tail = (g_cap_tail + 1) % P2P_CAP_Q;
  p2p_cap_unlock();
  return 1;
}

#endif
