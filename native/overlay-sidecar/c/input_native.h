#ifndef P2P_KIWI_INPUT_NATIVE_H
#define P2P_KIWI_INPUT_NATIVE_H

#include "overlay_native.h"

#ifdef __cplusplus
extern "C" {
#endif

int native_input_init(void);
void native_input_shutdown(void);
void native_input_query_caps(NativeCaps *out);
void native_input_pump(void);
int native_hotkey_poll(void);
int native_hotkey_register(int ctrl, int alt, int shift, int meta, int key_escape);
void native_hotkey_unregister(void);
/* Wayland: post one XTest event so XWayland opens the Remote Desktop prompt. */
void native_input_activate_injection(void);
int native_pointer_move(double x, double y);
int native_pointer_move_for_source(const NativeSource *source, double nx, double ny);
static inline void normalized_to_rect(
    double nx, double ny, int x, int y, int w, int h, double *ox, double *oy) {
  if (nx < 0) nx = 0;
  if (nx > 1) nx = 1;
  if (ny < 0) ny = 0;
  if (ny > 1) ny = 1;
  if (w < 1) w = 1;
  if (h < 1) h = 1;
  *ox = (double)x + nx * (double)(w - 1);
  *oy = (double)y + ny * (double)(h - 1);
}
int native_pointer_button(int button, int down);
int native_pointer_wheel(double dx, double dy);
int native_key_event(unsigned int key_code, int down, unsigned int modifiers);
/* kind: 1 = post/accessibility, 2 = listen/input monitoring */
int native_input_request_permission(int kind);

typedef struct {
  unsigned int key_code;
  int down;
  unsigned int modifiers; /* ctrl=1 alt=2 shift=4 meta=8 */
  int location;           /* 0 standard, 1 left, 2 right, 3 numpad */
  int repeat;
} NativeCapturedKey;

int native_keyboard_capture_start(void);
void native_keyboard_capture_stop(void);
void native_keyboard_capture_unlock(void);
int native_keyboard_capture_poll(NativeCapturedKey *out);

#ifdef __cplusplus
}
#endif

#endif
