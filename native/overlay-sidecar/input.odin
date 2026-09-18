package main

Input_Error :: enum {
	None,
	Not_Armed,
	Pointer_Denied,
	Keyboard_Denied,
	Native_Failed,
}

MAX_TRACKED_KEYS :: 160

Input_State :: struct {
	armed:               bool,
	allow_pointer:       bool,
	allow_keyboard:      bool,
	emergency_triggered: bool,
	held_buttons:        u32,
	held_keys:           [MAX_TRACKED_KEYS]bool,
}

input_reset :: proc(state: ^Input_State) {
	state^ = {}
}

// Stale in-flight arm requests carry the previous generation (or 0) and
// must not clear the emergency latch.
emergency_generation_matches :: proc(current, payload: i64) -> bool {
	return payload == current
}

input_arm :: proc(state: ^Input_State, pointer: bool, keyboard: bool) -> Input_Error {
	// Emergency is a one-way off switch until this explicit new arm.
	state.emergency_triggered = false
	state.armed = pointer || keyboard
	state.allow_pointer = pointer
	state.allow_keyboard = keyboard
	if !state.armed {
		return .Not_Armed
	}
	return .None
}

input_disarm :: proc(state: ^Input_State) {
	state.armed = false
	state.allow_pointer = false
	state.allow_keyboard = false
	input_release_all(state)
}

input_emergency_disable :: proc(state: ^Input_State) {
	state.armed = false
	state.allow_pointer = false
	state.allow_keyboard = false
	state.emergency_triggered = true
	input_release_all(state)
}

input_pointer_move :: proc(state: ^Input_State, x: f64, y: f64) -> Input_Error {
	if !state.armed do return .Not_Armed
	if !state.allow_pointer do return .Pointer_Denied
	if native_pointer_move(x, y) != 0 do return .Native_Failed
	return .None
}

input_pointer_button :: proc(state: ^Input_State, button: i32, down: bool) -> Input_Error {
	if !state.armed do return .Not_Armed
	if !state.allow_pointer do return .Pointer_Denied
	if native_pointer_button(button, down ? 1 : 0) != 0 do return .Native_Failed
	if button >= 1 && button <= 31 {
		bit := u32(1) << u32(button)
		if down {
			state.held_buttons |= bit
		} else {
			state.held_buttons &~= bit
		}
	}
	return .None
}

input_wheel :: proc(state: ^Input_State, dx: f64, dy: f64) -> Input_Error {
	if !state.armed do return .Not_Armed
	if !state.allow_pointer do return .Pointer_Denied
	if native_pointer_wheel(dx, dy) != 0 do return .Native_Failed
	return .None
}

// 1-based ids matching native/overlay-sidecar/c/portable_keys.h
PK_SHIFT_LEFT :: u32(62)
PK_SHIFT_RIGHT :: u32(63)
PK_CONTROL_LEFT :: u32(64)
PK_CONTROL_RIGHT :: u32(65)
PK_ALT_LEFT :: u32(66)
PK_ALT_RIGHT :: u32(67)
PK_META_LEFT :: u32(68)
PK_META_RIGHT :: u32(69)
PK_C :: u32(14)
PK_SEMICOLON :: u32(111)

key_is_held :: proc(state: ^Input_State, code: u32) -> bool {
	return code > 0 && int(code) < MAX_TRACKED_KEYS && state.held_keys[code]
}

set_held_key :: proc(state: ^Input_State, code: u32, down: bool) {
	if code == 0 || int(code) >= MAX_TRACKED_KEYS do return
	if state.held_keys[code] == down do return
	_ = native_key_event(code, down ? 1 : 0, 0)
	state.held_keys[code] = down
}

sync_modifier_pair :: proc(state: ^Input_State, left, right: u32, want: bool) {
	have := key_is_held(state, left) || key_is_held(state, right)
	if want && !have {
		set_held_key(state, left, true)
	} else if !want && have {
		set_held_key(state, left, false)
		set_held_key(state, right, false)
	}
}

input_sync_modifiers :: proc(state: ^Input_State, modifiers: u32) {
	sync_modifier_pair(state, PK_CONTROL_LEFT, PK_CONTROL_RIGHT, modifiers & 1 != 0)
	sync_modifier_pair(state, PK_ALT_LEFT, PK_ALT_RIGHT, modifiers & 2 != 0)
	sync_modifier_pair(state, PK_SHIFT_LEFT, PK_SHIFT_RIGHT, modifiers & 4 != 0)
	sync_modifier_pair(state, PK_META_LEFT, PK_META_RIGHT, modifiers & 8 != 0)
}

key_is_modifier :: proc(code: u32) -> bool {
	return code >= PK_SHIFT_LEFT && code <= PK_META_RIGHT
}

input_keyboard :: proc(state: ^Input_State, key_code: u32, down: bool, modifiers: u32) -> Input_Error {
	if !state.armed do return .Not_Armed
	if !state.allow_keyboard do return .Keyboard_Denied
	if !key_is_modifier(key_code) {
		input_sync_modifiers(state, modifiers)
	}
	already_held := down && key_is_held(state, key_code)
	if !already_held {
		if native_key_event(key_code, down ? 1 : 0, modifiers) != 0 do return .Native_Failed
	}
	if key_code > 0 && int(key_code) < MAX_TRACKED_KEYS {
		state.held_keys[key_code] = down
	}
	return .None
}

input_release_all :: proc(state: ^Input_State) {
	for button in 1 ..= 31 {
		bit := u32(1) << u32(button)
		if state.held_buttons & bit != 0 {
			_ = native_pointer_button(i32(button), 0)
		}
	}
	state.held_buttons = 0
	for code in 0 ..< MAX_TRACKED_KEYS {
		if state.held_keys[code] {
			_ = native_key_event(u32(code), 0, 0)
			state.held_keys[code] = false
		}
	}
}
