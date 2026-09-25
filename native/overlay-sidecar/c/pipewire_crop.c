#define _GNU_SOURCE
#include "pipewire_crop.h"

#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#ifdef HAVE_PIPEWIRE

#include <pipewire/pipewire.h>
#include <spa/buffer/buffer.h>
#include <spa/buffer/meta.h>
#include <spa/param/buffers.h>
#include <spa/param/video/format-utils.h>
#include <spa/pod/builder.h>

enum { CURSOR_META_BYTES = (int)sizeof(struct spa_meta_cursor) + (int)sizeof(struct spa_meta_bitmap) + 256 * 256 * 4 };

static struct pw_thread_loop *g_loop;
static struct pw_context *g_context;
static struct pw_core *g_core;
static struct pw_registry *g_registry;
static struct spa_hook g_registry_listener;
static struct pw_stream *g_stream;
static int g_started;
static uint32_t g_node_id;
static uint64_t g_bound_serial;
static int g_bound_cast;
static atomic_int g_crop_ok;
static atomic_int g_crop_x;
static atomic_int g_crop_y;
static atomic_int g_crop_w;
static atomic_int g_crop_h;
static atomic_int g_cursor_ok;
static atomic_int g_cursor_x;
static atomic_int g_cursor_y;
static atomic_int g_cursor_meta_present;
static atomic_long g_crop_ready_ms;
static int g_logged_missing;
static struct timespec g_started_at;

static long mono_ms(void) {
  struct timespec now;
  clock_gettime(CLOCK_MONOTONIC, &now);
  return (long)now.tv_sec * 1000 + now.tv_nsec / 1000000;
}

static int contains_token(const char *text) {
  if (!text) return 0;
  if (strcasestr(text, "portal")) return 1;
  if (strcasestr(text, "screencast")) return 1;
  if (strcasestr(text, "screen-cast")) return 1;
  if (strcasestr(text, "mutter")) return 1;
  return 0;
}

static int is_cast_name(const char *text) {
  if (!text) return 0;
  return strcasestr(text, "screencast") != NULL || strcasestr(text, "screen-cast") != NULL;
}

static int is_screencast_node(const struct spa_dict *props) {
  if (!props) return 0;
  if (contains_token(spa_dict_lookup(props, PW_KEY_NODE_NAME))) return 1;
  if (contains_token(spa_dict_lookup(props, PW_KEY_APP_NAME))) return 1;
  if (contains_token(spa_dict_lookup(props, PW_KEY_MEDIA_NAME))) return 1;
  if (contains_token(spa_dict_lookup(props, PW_KEY_NODE_DESCRIPTION))) return 1;
  return 0;
}

static void clear_samples(void) {
  atomic_store_explicit(&g_crop_ok, 0, memory_order_relaxed);
  atomic_store_explicit(&g_cursor_ok, 0, memory_order_relaxed);
  atomic_store_explicit(&g_cursor_meta_present, 0, memory_order_relaxed);
  atomic_store_explicit(&g_crop_ready_ms, 0, memory_order_relaxed);
}

static void on_process(void *userdata) {
  struct pw_buffer *buffer;
  struct spa_meta_region *crop;
  struct spa_meta_cursor *cursor;
  (void)userdata;
  if (!g_stream) return;
  buffer = pw_stream_dequeue_buffer(g_stream);
  if (!buffer) return;
  crop = spa_buffer_find_meta_data(buffer->buffer, SPA_META_VideoCrop, sizeof(*crop));
  if (crop && spa_meta_region_is_valid(crop) && crop->region.size.width > 0 && crop->region.size.height > 0) {
    atomic_store_explicit(&g_crop_x, crop->region.position.x, memory_order_relaxed);
    atomic_store_explicit(&g_crop_y, crop->region.position.y, memory_order_relaxed);
    atomic_store_explicit(&g_crop_w, (int)crop->region.size.width, memory_order_relaxed);
    atomic_store_explicit(&g_crop_h, (int)crop->region.size.height, memory_order_relaxed);
    if (atomic_load_explicit(&g_crop_ready_ms, memory_order_relaxed) == 0) {
      atomic_store_explicit(&g_crop_ready_ms, mono_ms(), memory_order_relaxed);
    }
  }
  cursor = spa_buffer_find_meta_data(buffer->buffer, SPA_META_Cursor, sizeof(*cursor));
  if (cursor) {
    atomic_store_explicit(&g_cursor_meta_present, 1, memory_order_relaxed);
    if (cursor->id != 0) {
      atomic_store_explicit(&g_cursor_x, cursor->position.x, memory_order_relaxed);
      atomic_store_explicit(&g_cursor_y, cursor->position.y, memory_order_relaxed);
      atomic_store_explicit(&g_cursor_ok, 1, memory_order_relaxed);
    } else {
      atomic_store_explicit(&g_cursor_ok, 0, memory_order_relaxed);
    }
  }
  if (crop && spa_meta_region_is_valid(crop) && crop->region.size.width > 0 && crop->region.size.height > 0) {
    atomic_store_explicit(&g_crop_ok, 1, memory_order_release);
  }
  pw_stream_queue_buffer(g_stream, buffer);
}

static void on_state_changed(void *userdata, enum pw_stream_state old, enum pw_stream_state state, const char *error) {
  (void)userdata;
  (void)old;
  if (state == PW_STREAM_STATE_ERROR) {
    fprintf(stderr, "p2p.kiwi sidecar: pipewire crop stream failed%s%s\n", error ? ": " : "", error ? error : "");
  }
}

static const struct pw_stream_events g_stream_events = {
    PW_VERSION_STREAM_EVENTS,
    .process = on_process,
    .state_changed = on_state_changed,
};

static void connect_node(uint32_t id, const char *target, uint64_t serial, int cast) {
  uint8_t pod_buffer[2048];
  struct spa_pod_builder builder = SPA_POD_BUILDER_INIT(pod_buffer, sizeof(pod_buffer));
  const struct spa_pod *params[3];
  struct pw_properties *props;
  if (!g_loop || !target || !target[0]) return;
  if (g_stream) {
    pw_stream_destroy(g_stream);
    g_stream = NULL;
  }
  clear_samples();
  props = pw_properties_new(
      PW_KEY_MEDIA_TYPE, "Video",
      PW_KEY_MEDIA_CATEGORY, "Capture",
      PW_KEY_MEDIA_ROLE, "Screen",
      PW_KEY_TARGET_OBJECT, target,
      NULL);
  g_stream = pw_stream_new_simple(
      pw_thread_loop_get_loop(g_loop), "p2p-kiwi-crop", props, &g_stream_events, NULL);
  if (!g_stream) return;
  params[0] = spa_pod_builder_add_object(
      &builder,
      SPA_TYPE_OBJECT_Format,
      SPA_PARAM_EnumFormat,
      SPA_FORMAT_mediaType,
      SPA_POD_Id(SPA_MEDIA_TYPE_video),
      SPA_FORMAT_mediaSubtype,
      SPA_POD_Id(SPA_MEDIA_SUBTYPE_raw),
      SPA_FORMAT_VIDEO_format,
      SPA_POD_CHOICE_ENUM_Id(3, SPA_VIDEO_FORMAT_BGRA, SPA_VIDEO_FORMAT_BGRA, SPA_VIDEO_FORMAT_BGRx));
  params[1] = spa_pod_builder_add_object(
      &builder,
      SPA_TYPE_OBJECT_ParamMeta,
      SPA_PARAM_Meta,
      SPA_PARAM_META_type,
      SPA_POD_Id(SPA_META_VideoCrop),
      SPA_PARAM_META_size,
      SPA_POD_Int(sizeof(struct spa_meta_region)));
  params[2] = spa_pod_builder_add_object(
      &builder,
      SPA_TYPE_OBJECT_ParamMeta,
      SPA_PARAM_Meta,
      SPA_PARAM_META_type,
      SPA_POD_Id(SPA_META_Cursor),
      SPA_PARAM_META_size,
      SPA_POD_Int(CURSOR_META_BYTES));
  if (!params[0] || !params[1] || !params[2] ||
      pw_stream_connect(
          g_stream,
          PW_DIRECTION_INPUT,
          PW_ID_ANY,
          PW_STREAM_FLAG_AUTOCONNECT | PW_STREAM_FLAG_MAP_BUFFERS,
          params,
          3) < 0) {
    pw_stream_destroy(g_stream);
    g_stream = NULL;
    fprintf(stderr, "p2p.kiwi sidecar: pipewire crop connect failed for %s\n", target);
    return;
  }
  g_node_id = id;
  g_bound_serial = serial;
  g_bound_cast = cast;
  fprintf(stderr, "p2p.kiwi sidecar: pipewire crop watching %s\n", target);
}

static void on_global(
    void *data,
    uint32_t id,
    uint32_t permissions,
    const char *type,
    uint32_t version,
    const struct spa_dict *props) {
  const char *serial_s;
  const char *name;
  const char *target;
  uint64_t serial = 0;
  int cast;
  (void)data;
  (void)permissions;
  (void)version;
  if (!type || strcmp(type, PW_TYPE_INTERFACE_Node) != 0) return;
  if (!is_screencast_node(props)) return;
  name = spa_dict_lookup(props, PW_KEY_NODE_NAME);
  cast = is_cast_name(name) || is_cast_name(spa_dict_lookup(props, PW_KEY_MEDIA_NAME));
  if (g_bound_cast && !cast) return;
  serial_s = spa_dict_lookup(props, PW_KEY_OBJECT_SERIAL);
  if (serial_s && serial_s[0]) serial = strtoull(serial_s, NULL, 10);
  if (g_stream && cast == g_bound_cast && serial && serial <= g_bound_serial) return;
  target = (serial_s && serial_s[0]) ? serial_s : name;
  connect_node(id, target, serial, cast);
}

static void on_global_remove(void *data, uint32_t id) {
  (void)data;
  if (!g_node_id || id != g_node_id) return;
  if (g_stream) pw_stream_destroy(g_stream);
  g_stream = NULL;
  g_node_id = 0;
  g_bound_serial = 0;
  g_bound_cast = 0;
  clear_samples();
}

static const struct pw_registry_events g_registry_events = {
    PW_VERSION_REGISTRY_EVENTS,
    .global = on_global,
    .global_remove = on_global_remove,
};

static void pipewire_ensure(void) {
  if (g_started) return;
  g_started = 1;
  clock_gettime(CLOCK_MONOTONIC, &g_started_at);
  pw_init(NULL, NULL);
  g_loop = pw_thread_loop_new("p2p-kiwi-crop", NULL);
  if (!g_loop) return;
  pw_thread_loop_lock(g_loop);
  g_context = pw_context_new(pw_thread_loop_get_loop(g_loop), NULL, 0);
  g_core = g_context ? pw_context_connect(g_context, NULL, 0) : NULL;
  if (!g_core) {
    fprintf(stderr, "p2p.kiwi sidecar: pipewire is not available; window share stays on the display\n");
    pw_thread_loop_unlock(g_loop);
    g_logged_missing = 1;
    return;
  }
  g_registry = pw_core_get_registry(g_core, PW_VERSION_REGISTRY, 0);
  if (g_registry) pw_registry_add_listener(g_registry, &g_registry_listener, &g_registry_events, NULL);
  pw_thread_loop_unlock(g_loop);
  pw_thread_loop_start(g_loop);
}

static int waited_long_enough(void) {
  struct timespec now;
  long elapsed_ms;
  clock_gettime(CLOCK_MONOTONIC, &now);
  elapsed_ms = (now.tv_sec - g_started_at.tv_sec) * 1000 + (now.tv_nsec - g_started_at.tv_nsec) / 1000000;
  return elapsed_ms >= 1500;
}

int pipewire_video_crop(int *x, int *y, int *w, int *h) {
  if (!x || !y || !w || !h) return 0;
  pipewire_ensure();
  if (!atomic_load_explicit(&g_crop_ok, memory_order_acquire)) {
    if (!g_logged_missing && g_core && waited_long_enough()) {
      fprintf(
          stderr,
          "p2p.kiwi sidecar: pipewire screencast crop is not visible; window share stays on the display\n");
      g_logged_missing = 1;
    }
    return 0;
  }
  *x = atomic_load_explicit(&g_crop_x, memory_order_relaxed);
  *y = atomic_load_explicit(&g_crop_y, memory_order_relaxed);
  *w = atomic_load_explicit(&g_crop_w, memory_order_relaxed);
  *h = atomic_load_explicit(&g_crop_h, memory_order_relaxed);
  if (*w < 1 || *h < 1) return 0;
  return 1;
}

int pipewire_stream_cursor(int *x, int *y) {
  if (!x || !y) return 0;
  if (!atomic_load_explicit(&g_cursor_ok, memory_order_acquire)) return 0;
  *x = atomic_load_explicit(&g_cursor_x, memory_order_relaxed);
  *y = atomic_load_explicit(&g_cursor_y, memory_order_relaxed);
  return 1;
}

int pipewire_cursor_metadata_missing(void) {
  long ready;
  if (atomic_load_explicit(&g_cursor_meta_present, memory_order_acquire)) return 0;
  if (!atomic_load_explicit(&g_crop_ok, memory_order_acquire)) return 0;
  ready = atomic_load_explicit(&g_crop_ready_ms, memory_order_relaxed);
  if (!ready) return 0;
  return mono_ms() - ready >= 1500;
}

void pipewire_crop_shutdown(void) {
  if (!g_started) return;
  if (g_loop) pw_thread_loop_lock(g_loop);
  if (g_stream) pw_stream_destroy(g_stream);
  g_stream = NULL;
  g_node_id = 0;
  g_bound_serial = 0;
  g_bound_cast = 0;
  if (g_registry) pw_proxy_destroy((struct pw_proxy *)g_registry);
  g_registry = NULL;
  if (g_core) pw_core_disconnect(g_core);
  g_core = NULL;
  if (g_context) pw_context_destroy(g_context);
  g_context = NULL;
  if (g_loop) {
    pw_thread_loop_unlock(g_loop);
    pw_thread_loop_stop(g_loop);
    pw_thread_loop_destroy(g_loop);
  }
  g_loop = NULL;
  g_started = 0;
  clear_samples();
}

#else

int pipewire_video_crop(int *x, int *y, int *w, int *h) {
  (void)x;
  (void)y;
  (void)w;
  (void)h;
  return 0;
}

int pipewire_stream_cursor(int *x, int *y) {
  (void)x;
  (void)y;
  return 0;
}

int pipewire_cursor_metadata_missing(void) { return 0; }

void pipewire_crop_shutdown(void) {}

#endif
