#ifndef P2P_KIWI_OVERLAY_NATIVE_H
#define P2P_KIWI_OVERLAY_NATIVE_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
  int overlays;
  int click_through;
  int display_enumeration;
  int global_pointer_observation;
  int global_keyboard_observation;
  int pointer_injection;
  int keyboard_injection;
  int accessibility;     /* 0 unknown, 1 granted, 2 denied, 3 unavailable, 4 restart-required */
  int screen_recording;
  int input_monitoring;
  int emergency_hotkey;
  int keyboard_capture;
  char unavailable_reason[64];
  char backend[16]; /* "wayland", "x11", or "none" */
} NativeCaps;

typedef struct {
  char id[128];
  char label[64];
  char color[16];
  float x;
  float y;
  int ping;
  float ping_scale;
} NativeCursor;

typedef struct {
  char display_id[128];
  int x;
  int y;
  int width;
  int height;
  float scale;
  int rotation;
} NativeSource;

void native_query_caps(NativeCaps *out);
int native_overlay_create(const NativeSource *source);
int native_overlay_update(int overlay_id, const NativeSource *source, const NativeCursor *cursors, int n);
void native_overlay_destroy(int overlay_id);
void native_overlay_pump(void);
void native_shutdown(void);
void native_macos_ensure_app(void);

#ifdef __cplusplus
}
#endif

#endif
