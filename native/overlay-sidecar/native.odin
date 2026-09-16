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
	backend:                      [16]u8,
}

NativeCursor :: struct {
	id:    [128]u8,
	label: [64]u8,
	color: [16]u8,
	x:          f32,
	y:          f32,
	ping:       i32,
	ping_scale: f32,
}

NativeSource :: struct {
	display_id: [128]u8,
	x:          i32,
	y:          i32,
	width:      i32,
	height:     i32,
	scale:      f32,
	rotation:   i32,
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
} else {
	when ODIN_OS == .Windows {
		foreign import native_overlay {
			"dist/overlay_draw.obj",
			"dist/overlay_win32.obj",
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
	}
}
