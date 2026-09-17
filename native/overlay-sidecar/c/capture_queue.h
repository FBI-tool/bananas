#ifndef P2P_KIWI_CAPTURE_QUEUE_H
#define P2P_KIWI_CAPTURE_QUEUE_H

#include "input_native.h"

#define P2P_CAP_Q 256

static NativeCapturedKey g_cap_q[P2P_CAP_Q];
static int g_cap_head;
static int g_cap_tail;
static int g_capture_active;
static int g_capture_locked;

static void capture_lock(void) {
  g_capture_locked = 1;
}

void native_keyboard_capture_unlock(void) {
  g_capture_locked = 0;
}

static void cap_push(
    unsigned int key_code,
    int down,
    unsigned int modifiers,
    int location,
    int repeat
) {
  if (!g_capture_active || key_code == 0) return;
  int next = (g_cap_head + 1) % P2P_CAP_Q;
  if (next == g_cap_tail) g_cap_tail = (g_cap_tail + 1) % P2P_CAP_Q;
  g_cap_q[g_cap_head].key_code = key_code;
  g_cap_q[g_cap_head].down = down ? 1 : 0;
  g_cap_q[g_cap_head].modifiers = modifiers;
  g_cap_q[g_cap_head].location = location;
  g_cap_q[g_cap_head].repeat = repeat ? 1 : 0;
  g_cap_head = next;
}

int native_keyboard_capture_poll(NativeCapturedKey *out) {
  if (!out || g_cap_tail == g_cap_head) return 0;
  *out = g_cap_q[g_cap_tail];
  g_cap_tail = (g_cap_tail + 1) % P2P_CAP_Q;
  return 1;
}

#endif
