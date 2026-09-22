package main

import "core:testing"

@(test)
test_input_arm_mouse_only :: proc(t: ^testing.T) {
	state: Input_State
	testing.expect_value(t, input_arm(&state, true, false), Input_Error.None)
	testing.expect(t, state.armed)
	testing.expect(t, state.allow_pointer)
	testing.expect(t, !state.allow_keyboard)
}

@(test)
test_input_arm_keyboard_only :: proc(t: ^testing.T) {
	state: Input_State
	testing.expect_value(t, input_arm(&state, false, true), Input_Error.None)
	testing.expect(t, state.allow_keyboard)
	testing.expect(t, !state.allow_pointer)
}

@(test)
test_input_arm_both_and_disarm :: proc(t: ^testing.T) {
	state: Input_State
	testing.expect_value(t, input_arm(&state, true, true), Input_Error.None)
	testing.expect_value(t, input_pointer_move(&state, 10, 20), Input_Error.None)
	input_disarm(&state)
	testing.expect(t, !state.armed)
	testing.expect_value(t, input_pointer_move(&state, 10, 20), Input_Error.Not_Armed)
	testing.expect_value(t, input_keyboard(&state, 12, true, 0), Input_Error.Not_Armed)
}

@(test)
test_input_denied_when_wrong_grant :: proc(t: ^testing.T) {
	state: Input_State
	_ = input_arm(&state, true, false)
	testing.expect_value(t, input_keyboard(&state, 12, true, 0), Input_Error.Keyboard_Denied)
	input_disarm(&state)
	_ = input_arm(&state, false, true)
	testing.expect_value(t, input_pointer_button(&state, 1, true), Input_Error.Pointer_Denied)
}

@(test)
test_input_tracks_and_releases_keys :: proc(t: ^testing.T) {
	state: Input_State
	_ = input_arm(&state, true, true)
	testing.expect_value(t, input_keyboard(&state, 12, true, 0), Input_Error.None)
	testing.expect(t, state.held_keys[12])
	testing.expect_value(t, input_pointer_button(&state, 1, true), Input_Error.None)
	testing.expect(t, state.held_buttons & 2 != 0)
	testing.expect_value(t, input_keyboard(&state, 12, false, 0), Input_Error.None)
	testing.expect(t, !state.held_keys[12])
	_ = input_pointer_button(&state, 2, true)
	input_release_all(&state)
	testing.expect_value(t, state.held_buttons, u32(0))
	testing.expect(t, !state.held_keys[12])
}

@(test)
test_emergency_disable_is_one_way :: proc(t: ^testing.T) {
	state: Input_State
	_ = input_arm(&state, true, true)
	_ = input_keyboard(&state, 1, true, 0)
	input_emergency_disable(&state)
	testing.expect(t, !state.armed)
	testing.expect(t, state.emergency_triggered)
	testing.expect(t, !state.held_keys[1])
	testing.expect_value(t, input_pointer_move(&state, 1, 1), Input_Error.Not_Armed)
	testing.expect_value(t, input_arm(&state, true, true), Input_Error.None)
	testing.expect(t, !state.emergency_triggered)
	testing.expect_value(t, input_pointer_move(&state, 1, 1), Input_Error.None)
}

@(test)
test_disconnect_cleanup :: proc(t: ^testing.T) {
	state: Input_State
	_ = input_arm(&state, true, true)
	_ = input_pointer_button(&state, 3, true)
	_ = input_keyboard(&state, 70, true, 0)
	input_disarm(&state)
	testing.expect(t, !state.armed)
	testing.expect_value(t, state.held_buttons, u32(0))
	testing.expect(t, !state.held_keys[70])
}

@(test)
test_ctrl_chord_syncs_then_releases_before_next_key :: proc(t: ^testing.T) {
	state: Input_State
	_ = input_arm(&state, false, true)
	// Ctrl+B without a prior ControlLeft event still latches Control.
	testing.expect_value(t, input_keyboard(&state, 13, true, 1), Input_Error.None)
	testing.expect(t, key_is_held(&state, PK_CONTROL_LEFT))
	testing.expect(t, state.held_keys[13])
	testing.expect_value(t, input_keyboard(&state, 13, false, 1), Input_Error.None)
	testing.expect(t, key_is_held(&state, PK_CONTROL_LEFT))
	// Following `c` with ctrl up must drop Control so the host sees `c`, not Ctrl+C.
	testing.expect_value(t, input_keyboard(&state, 14, true, 0), Input_Error.None)
	testing.expect(t, !key_is_held(&state, PK_CONTROL_LEFT))
	testing.expect(t, state.held_keys[14])
}

@(test)
test_ctrl_c_chord_repeats_then_fully_releases :: proc(t: ^testing.T) {
	state: Input_State
	_ = input_arm(&state, false, true)
	testing.expect_value(t, input_keyboard(&state, PK_CONTROL_LEFT, true, 1), Input_Error.None)
	testing.expect_value(t, input_keyboard(&state, PK_C, true, 1), Input_Error.None)
	testing.expect(t, key_is_held(&state, PK_CONTROL_LEFT))
	testing.expect(t, key_is_held(&state, PK_C))
	testing.expect_value(t, input_keyboard(&state, PK_C, true, 1), Input_Error.None)
	testing.expect_value(t, input_keyboard(&state, PK_C, true, 1), Input_Error.None)
	testing.expect(t, key_is_held(&state, PK_C))
	testing.expect_value(t, input_keyboard(&state, PK_C, false, 1), Input_Error.None)
	testing.expect(t, !key_is_held(&state, PK_C))
	testing.expect(t, key_is_held(&state, PK_CONTROL_LEFT))
	testing.expect_value(t, input_keyboard(&state, PK_CONTROL_LEFT, false, 0), Input_Error.None)
	testing.expect(t, !key_is_held(&state, PK_CONTROL_LEFT))
	testing.expect(t, !key_is_held(&state, PK_C))
}

@(test)
test_shift_semicolon_chord_repeats_then_fully_releases :: proc(t: ^testing.T) {
	state: Input_State
	_ = input_arm(&state, false, true)
	testing.expect_value(t, input_keyboard(&state, PK_SHIFT_LEFT, true, 4), Input_Error.None)
	testing.expect_value(t, input_keyboard(&state, PK_SEMICOLON, true, 4), Input_Error.None)
	testing.expect(t, key_is_held(&state, PK_SHIFT_LEFT))
	testing.expect(t, key_is_held(&state, PK_SEMICOLON))
	testing.expect_value(t, input_keyboard(&state, PK_SEMICOLON, true, 4), Input_Error.None)
	testing.expect_value(t, input_keyboard(&state, PK_SEMICOLON, true, 4), Input_Error.None)
	testing.expect(t, key_is_held(&state, PK_SEMICOLON))
	testing.expect_value(t, input_keyboard(&state, PK_SEMICOLON, false, 4), Input_Error.None)
	testing.expect(t, !key_is_held(&state, PK_SEMICOLON))
	testing.expect(t, key_is_held(&state, PK_SHIFT_LEFT))
	testing.expect_value(t, input_keyboard(&state, PK_SHIFT_LEFT, false, 0), Input_Error.None)
	testing.expect(t, !key_is_held(&state, PK_SHIFT_LEFT))
	testing.expect(t, !key_is_held(&state, PK_SEMICOLON))
}

@(test)
test_stale_emergency_generation_is_rejected :: proc(t: ^testing.T) {
	testing.expect(t, emergency_generation_matches(0, 0))
	testing.expect(t, emergency_generation_matches(2, 2))
	testing.expect(t, !emergency_generation_matches(1, 0))
	testing.expect(t, !emergency_generation_matches(2, 1))
}

@(test)
test_pointer_hold_repeats_then_fully_releases :: proc(t: ^testing.T) {
	state: Input_State
	_ = input_arm(&state, true, false)
	testing.expect_value(t, input_pointer_button(&state, 1, true), Input_Error.None)
	testing.expect(t, state.held_buttons & 2 != 0)
	testing.expect_value(t, input_pointer_button(&state, 1, true), Input_Error.None)
	testing.expect_value(t, input_pointer_button(&state, 1, true), Input_Error.None)
	testing.expect(t, state.held_buttons & 2 != 0)
	testing.expect_value(t, input_pointer_button(&state, 1, false), Input_Error.None)
	testing.expect_value(t, state.held_buttons, u32(0))
}

@(test)
test_grant_scope_rejects_stale_epoch_and_other_peer :: proc(t: ^testing.T) {
	scope := Grant_Scope{active = true, session_id = "room", peer_id = "alice", epoch = 4}
	testing.expect(t, grant_event_allowed(scope, "room", "alice", 4, true))
	testing.expect(t, !grant_event_allowed(scope, "room", "alice", 3, true))
	testing.expect(t, !grant_event_allowed(scope, "room", "bob", 4, true))
	testing.expect(t, !grant_event_allowed(scope, "other", "alice", 4, true))
	testing.expect(t, !grant_event_allowed(scope, "", "", 0, false))
	legacy: Grant_Scope
	testing.expect(t, grant_event_allowed(legacy, "", "", 0, false))
}

@(test)
test_mouse_only_grant_rejects_keyboard :: proc(t: ^testing.T) {
	state: Input_State
	_ = input_arm(&state, true, false)
	testing.expect_value(t, input_pointer_move(&state, 1, 1), Input_Error.None)
	testing.expect_value(t, input_keyboard(&state, 12, true, 0), Input_Error.Keyboard_Denied)
	input_emergency_disable(&state)
	testing.expect_value(t, input_pointer_move(&state, 1, 1), Input_Error.Not_Armed)
	testing.expect(t, state.emergency_triggered)
	_ = input_arm(&state, true, false)
	testing.expect(t, !state.emergency_triggered)
}
