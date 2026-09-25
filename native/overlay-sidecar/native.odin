package main

NativeCaps :: struct {
	overlays:                     i32,
	click_through:                i32,
	display_enumeration:          i32,
	global_pointer_observation:   i32,
	global_keyboard_observation:  i32,
	pointer_injection:            i32,
	keyboard_injection:           i32,
	accessibility:                i32,
	screen_recording:             i32,
	input_monitoring:             i32,
	emergency_hotkey:             i32,
	keyboard_capture:             i32,
	unavailable_reason:           [64]u8,
	backend:                      [16]u8,
}

NativeCursor :: struct {
	id:         [128]u8,
	label:      [64]u8,
	foreground: [16]u8,
	background: [16]u8,
	x:          f32,
	y:          f32,
	ping:       i32,
	ping_scale: f32,
}

NativeSource :: struct {
	display_id:   [128]u8,
	x:            i32,
	y:            i32,
	width:        i32,
	height:       i32,
	scale:        f32,
	rotation:     i32,
	has_capture:  i32,
	cap_x:        i32,
	cap_y:        i32,
	cap_w:        i32,
	cap_h:        i32,
	window_share: i32,
	window_id:    [64]u8,
}

NativeCapturedKey :: struct {
	key_code:   u32,
	down:       i32,
	modifiers:  u32,
	location:   i32,
	repeat:     i32,
}

copy_cstr :: proc(dst: []u8, src: string) {
	n := min(len(src), len(dst) - 1)
	for i in 0 ..< n {
		dst[i] = src[i]
	}
	if n < len(dst) {
		dst[n] = 0
	}
}

when ODIN_TEST {
	native_query_caps :: proc(out: ^NativeCaps) {
		if out == nil do return
		out^ = {}
		out.overlays = 1
		out.click_through = 1
		out.display_enumeration = 1
	}
	native_overlay_create :: proc(source: ^NativeSource) -> i32 {
		_ = source
		return 1
	}
	native_overlay_update :: proc(overlay_id: i32, source: ^NativeSource, cursors: [^]NativeCursor, n: i32) -> i32 {
		_ = overlay_id
		_ = source
		_ = cursors
		_ = n
		return 1
	}
	native_overlay_destroy :: proc(overlay_id: i32) { _ = overlay_id }
	native_overlay_pump :: proc() {}
	native_shutdown :: proc() {}
	native_input_init :: proc() -> i32 { return 1 }
	native_input_shutdown :: proc() {}
	native_input_query_caps :: proc(out: ^NativeCaps) { _ = out }
	native_input_pump :: proc() {}
	native_hotkey_poll :: proc() -> i32 { return 0 }
	native_hotkey_register :: proc(ctrl, alt, shift, meta, key_escape: i32) -> i32 {
		_ = ctrl; _ = alt; _ = shift; _ = meta; _ = key_escape
		return 1
	}
	native_hotkey_unregister :: proc() {}
	native_input_activate_injection :: proc() {}
	native_pointer_move :: proc(x, y: f64) -> i32 { _ = x; _ = y; return 0 }
	native_pointer_move_for_source :: proc(source: ^NativeSource, nx, ny: f64) -> i32 {
		_ = source; _ = nx; _ = ny
		return 0
	}
	native_pointer_button :: proc(button, down: i32) -> i32 { _ = button; _ = down; return 0 }
	native_pointer_wheel :: proc(dx, dy: f64) -> i32 { _ = dx; _ = dy; return 0 }
	native_key_event :: proc(key_code: u32, down: i32, modifiers: u32) -> i32 {
		_ = key_code; _ = down; _ = modifiers
		return 0
	}
	native_input_request_permission :: proc(kind: i32) -> i32 { _ = kind; return 0 }
	native_keyboard_capture_start :: proc() -> i32 { return 1 }
	native_keyboard_capture_stop :: proc() {}
	native_keyboard_capture_unlock :: proc() {}
	native_keyboard_capture_poll :: proc(out: ^NativeCapturedKey) -> i32 {
		_ = out
		return 0
	}
} else {
	when ODIN_OS == .Windows {
		foreign import native_overlay {
			"dist/overlay_draw.obj",
			"dist/overlay_win32.obj",
			"dist/input_win32.obj",
			"system:gdi32.lib",
			"system:user32.lib",
			"system:dwmapi.lib",
		}
	} else {
		foreign import native_overlay "system:c"
	}

	@(default_calling_convention = "c")
	foreign native_overlay {
		native_query_caps :: proc(out: ^NativeCaps) ---
		native_overlay_create :: proc(source: ^NativeSource) -> i32 ---
		native_overlay_update :: proc(overlay_id: i32, source: ^NativeSource, cursors: [^]NativeCursor, n: i32) -> i32 ---
		native_overlay_destroy :: proc(overlay_id: i32) ---
		native_overlay_pump :: proc() ---
		native_shutdown :: proc() ---
		native_input_init :: proc() -> i32 ---
		native_input_shutdown :: proc() ---
		native_input_query_caps :: proc(out: ^NativeCaps) ---
		native_input_pump :: proc() ---
		native_hotkey_poll :: proc() -> i32 ---
		native_hotkey_register :: proc(ctrl, alt, shift, meta, key_escape: i32) -> i32 ---
		native_hotkey_unregister :: proc() ---
		native_input_activate_injection :: proc() ---
		native_pointer_move :: proc(x, y: f64) -> i32 ---
		native_pointer_move_for_source :: proc(source: ^NativeSource, nx, ny: f64) -> i32 ---
		native_pointer_button :: proc(button, down: i32) -> i32 ---
		native_pointer_wheel :: proc(dx, dy: f64) -> i32 ---
		native_key_event :: proc(key_code: u32, down: i32, modifiers: u32) -> i32 ---
		native_input_request_permission :: proc(kind: i32) -> i32 ---
		native_keyboard_capture_start :: proc() -> i32 ---
		native_keyboard_capture_stop :: proc() ---
		native_keyboard_capture_unlock :: proc() ---
		native_keyboard_capture_poll :: proc(out: ^NativeCapturedKey) -> i32 ---
	}
}
