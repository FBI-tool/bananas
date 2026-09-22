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
int native_pointer_move(double x, double y);
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
