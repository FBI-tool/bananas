#ifndef P2P_KIWI_PIPEWIRE_CROP_H
#define P2P_KIWI_PIPEWIRE_CROP_H

/* Monitor-local pixels of the active portal window stream, from SPA_META_VideoCrop.
   Returns 0 when no screencast node is visible. */
int pipewire_video_crop(int *x, int *y, int *w, int *h);
/* Window-local pointer from SPA_META_Cursor. Returns 0 when the pointer is not
   over the shared window on this buffer. */
int pipewire_stream_cursor(int *x, int *y);
/* 1 after a crop has been visible for a while and no cursor metadata arrived. */
int pipewire_cursor_metadata_missing(void);
void pipewire_crop_shutdown(void);

#endif
