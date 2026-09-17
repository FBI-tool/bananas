package main

import "core:encoding/json"
import "core:os"
import "core:strings"
import "core:time"

heartbeat_interval :: 2 * time.Second

Session :: struct {
	conn:           Ipc_Conn,
	token:          string,
	authed:         bool,
	caps:           NativeCaps,
	overlay_id:     i32,
	running:        bool,
	read_buf:       [8192]u8,
	pending:        [dynamic]u8,
	input:          Input_State,
	emergency_generation: i64,
}

arg_value :: proc(flag: string) -> string {
	for i in 0 ..< len(os.args) - 1 {
		if os.args[i] == flag {
			return os.args[i + 1]
		}
	}
	return ""
}

send_env :: proc(session: ^Session, type: string, request_id: string, payload: json.Value) -> bool {
	frame, err := encode_frame(Envelope{type = type, request_id = request_id, payload = payload})
	if err != .None {
		return false
	}
	defer delete(frame)
	return ipc_write_all(session.conn, frame)
}

parse_source :: proc(obj: json.Object) -> NativeSource {
	src: NativeSource
	if id, ok := object_string(obj, "displayId"); ok {
		copy_cstr(src.display_id[:], id)
	}
	if bounds, ok := obj["bounds"].(json.Object); ok {
		if v, vok := object_f64(bounds, "x"); vok do src.x = i32(v)
		if v, vok := object_f64(bounds, "y"); vok do src.y = i32(v)
		if v, vok := object_f64(bounds, "width"); vok do src.width = i32(v)
		if v, vok := object_f64(bounds, "height"); vok do src.height = i32(v)
	}
	if v, ok := object_f64(obj, "scaleFactor"); ok {
		src.scale = f32(v)
	} else {
		src.scale = 1
	}
	if v, ok := object_int(obj, "rotation"); ok {
		src.rotation = i32(v)
	}
	return src
}

parse_cursors :: proc(content: json.Object, cursors: []NativeCursor) -> i32 {
	arr, ok := content["cursors"].(json.Array)
	if !ok {
		return 0
	}
	n := i32(0)
	for item in arr {
		if n >= i32(len(cursors)) do break
		obj, is_obj := item.(json.Object)
		if !is_obj do continue
		cur := NativeCursor{}
		cur.ping_scale = 1
		if id, iok := object_string(obj, "peerId"); iok {
			copy_cstr(cur.id[:], id)
		}
		if label, lok := object_string(obj, "label"); lok {
			copy_cstr(cur.label[:], label)
		}
		if appearance, aok := obj["appearance"].(json.Object); aok {
			if color, cok := object_string(appearance, "color"); cok {
				copy_cstr(cur.color[:], color)
			}
		}
		if pos, pok := obj["normalizedPosition"].(json.Object); pok {
			if x, xok := object_f64(pos, "x"); xok do cur.x = f32(x)
			if y, yok := object_f64(pos, "y"); yok do cur.y = f32(y)
		}
		if ping, ping_ok := object_bool(obj, "ping"); ping_ok && ping {
			cur.ping = 1
		}
		if scale, scale_ok := object_f64(obj, "pingScale"); scale_ok {
			s := f32(scale)
			if s < 1 do s = 1
			if s > 2 do s = 2
			cur.ping_scale = s
		}
		cursors[n] = cur
		n += 1
	}
	return n
}

refresh_caps :: proc(session: ^Session) {
	native_query_caps(&session.caps)
	native_input_query_caps(&session.caps)
}

emit_remote_disabled :: proc(session: ^Session, reason: string) {
	obj := json.Object{}
	obj["reason"] = reason
	obj["generation"] = session.emergency_generation
	_ = send_env(session, "remote-control-disabled", "", obj)
}

payload_emergency_generation :: proc(payload: json.Object) -> i64 {
	gen, ok := object_int(payload, "emergencyGeneration")
	if ok do return gen
	return 0
}

reject_stale_emergency_arm :: proc(session: ^Session, env: Envelope, payload: json.Object) -> bool {
	if emergency_generation_matches(session.emergency_generation, payload_emergency_generation(payload)) {
		return false
	}
	_ = send_env(session, "error", env.request_id, make_error_payload("emergency-latched", "stale arm after emergency stop"))
	return true
}

apply_emergency :: proc(session: ^Session) {
	session.emergency_generation += 1
	input_emergency_disable(&session.input)
	native_keyboard_capture_stop()
	emit_remote_disabled(session, "emergency-hotkey")
}

emit_captured_key :: proc(session: ^Session, cap: NativeCapturedKey) {
	mods := json.Object{}
	mods["ctrl"] = cap.modifiers & 1 != 0
	mods["alt"] = cap.modifiers & 2 != 0
	mods["shift"] = cap.modifiers & 4 != 0
	mods["meta"] = cap.modifiers & 8 != 0
	obj := json.Object{}
	obj["keyCode"] = i64(cap.key_code)
	obj["down"] = cap.down != 0
	obj["repeat"] = cap.repeat != 0
	obj["location"] = i64(cap.location)
	obj["modifiers"] = mods
	_ = send_env(session, "captured-key", "", obj)
}

handle_remote_control :: proc(session: ^Session, env: Envelope) {
	payload_obj, _ := env.payload.(json.Object)
	switch env.type {
	case "remote-control-arm":
		if reject_stale_emergency_arm(session, env, payload_obj) do return
		mouse, _ := object_bool(payload_obj, "mouse")
		keyboard, _ := object_bool(payload_obj, "keyboard")
		refresh_caps(session)
		if session.caps.emergency_hotkey == 0 {
			_ = send_env(session, "error", env.request_id, make_error_payload("not-armed", "emergency hotkey is not available"))
			return
		}
		if mouse && session.caps.pointer_injection == 0 {
			_ = send_env(session, "error", env.request_id, make_error_payload("not-armed", "pointer injection is not available"))
			return
		}
		if keyboard && session.caps.keyboard_injection == 0 {
			_ = send_env(session, "error", env.request_id, make_error_payload("not-armed", "keyboard injection is not available"))
			return
		}
		err := input_arm(&session.input, mouse, keyboard)
		if err != .None {
			_ = send_env(session, "error", env.request_id, make_error_payload("not-armed", "remote control is not armed"))
			return
		}
		_ = send_env(session, "ok", env.request_id, make_ok_payload())
	case "remote-control-disarm":
		input_disarm(&session.input)
		_ = send_env(session, "ok", env.request_id, make_ok_payload())
	case "pointer-move":
		x, _ := object_f64(payload_obj, "x")
		y, _ := object_f64(payload_obj, "y")
		err := input_pointer_move(&session.input, x, y)
		if err != .None {
			_ = send_env(session, "error", env.request_id, make_error_payload("not-armed", "pointer move rejected"))
			return
		}
		_ = send_env(session, "ok", env.request_id, make_ok_payload())
	case "pointer-button":
		button, _ := object_int(payload_obj, "button")
		down_i, _ := object_int(payload_obj, "down")
		err := input_pointer_button(&session.input, i32(button), down_i != 0)
		if err != .None {
			_ = send_env(session, "error", env.request_id, make_error_payload("not-armed", "pointer button rejected"))
			return
		}
		_ = send_env(session, "ok", env.request_id, make_ok_payload())
	case "pointer-wheel":
		dx, _ := object_f64(payload_obj, "deltaX")
		dy, _ := object_f64(payload_obj, "deltaY")
		err := input_wheel(&session.input, dx, dy)
		if err != .None {
			_ = send_env(session, "error", env.request_id, make_error_payload("not-armed", "wheel rejected"))
			return
		}
		_ = send_env(session, "ok", env.request_id, make_ok_payload())
	case "keyboard-event":
		code, _ := object_int(payload_obj, "keyCode")
		down_i, _ := object_int(payload_obj, "down")
		mods: u32 = 0
		if m, ok := payload_obj["modifiers"].(json.Object); ok {
			if v, vok := object_bool(m, "ctrl"); vok && v do mods |= 1
			if v, vok := object_bool(m, "alt"); vok && v do mods |= 2
			if v, vok := object_bool(m, "shift"); vok && v do mods |= 4
			if v, vok := object_bool(m, "meta"); vok && v do mods |= 8
		}
		err := input_keyboard(&session.input, u32(code), down_i != 0, mods)
		if err != .None {
			_ = send_env(session, "error", env.request_id, make_error_payload("not-armed", "key rejected"))
			return
		}
		_ = send_env(session, "ok", env.request_id, make_ok_payload())
	case "release-all":
		input_release_all(&session.input)
		_ = send_env(session, "ok", env.request_id, make_ok_payload())
	case "set-emergency-hotkey":
		ctrl, _ := object_bool(payload_obj, "ctrl")
		alt, _ := object_bool(payload_obj, "alt")
		shift, _ := object_bool(payload_obj, "shift")
		meta, _ := object_bool(payload_obj, "meta")
		ok := native_hotkey_register(ctrl ? 1 : 0, alt ? 1 : 0, shift ? 1 : 0, meta ? 1 : 0, 1)
		if ok == 0 {
			_ = send_env(session, "error", env.request_id, make_error_payload("hotkey-registration-failed", "could not register emergency hotkey"))
			return
		}
		refresh_caps(session)
		_ = send_env(session, "ok", env.request_id, make_ok_payload())
	case "request-input-permission":
		_ = native_input_request_permission()
		refresh_caps(session)
		_ = send_env(session, "capabilities", env.request_id, make_capabilities_payload(session.caps))
	case "keyboard-capture-arm":
		if reject_stale_emergency_arm(session, env, payload_obj) do return
		if native_keyboard_capture_start() == 0 {
			_ = send_env(session, "error", env.request_id, make_error_payload("not-armed", "keyboard capture is not available"))
			return
		}
		_ = send_env(session, "ok", env.request_id, make_ok_payload())
	case "keyboard-capture-disarm":
		native_keyboard_capture_stop()
		native_keyboard_capture_unlock()
		_ = send_env(session, "ok", env.request_id, make_ok_payload())
	}
}

handle_message :: proc(session: ^Session, env: Envelope) {
	if is_remote_control(env.type) {
		if !session.authed {
			_ = send_env(session, "error", env.request_id, make_error_payload("auth", "handshake required"))
			return
		}
		handle_remote_control(session, env)
		return
	}
	payload_obj, _ := env.payload.(json.Object)
	switch env.type {
	case "handshake":
		token, _ := object_string(payload_obj, "token")
		if token == "" || token != session.token {
			_ = send_env(session, "handshake-error", env.request_id, make_error_payload("auth", "invalid bootstrap token"))
			session.running = false
			return
		}
		session.authed = true
		_ = send_env(session, "handshake-ok", env.request_id, make_handshake_ok())
	case "get-capabilities":
		if !session.authed {
			_ = send_env(session, "error", env.request_id, make_error_payload("auth", "handshake required"))
			return
		}
		native_query_caps(&session.caps)
		native_input_query_caps(&session.caps)
		_ = send_env(session, "capabilities", env.request_id, make_capabilities_payload(session.caps))
	case "create-overlay":
		if !session.authed {
			_ = send_env(session, "error", env.request_id, make_error_payload("auth", "handshake required"))
			return
		}
		src := parse_source(payload_obj)
		id := native_overlay_create(&src)
		if id == 0 {
			_ = send_env(session, "error", env.request_id, make_error_payload("overlay", "failed to create overlay"))
			return
		}
		session.overlay_id = id
		obj := json.Object{}
		obj["id"] = i64(id)
		_ = send_env(session, "overlay-created", env.request_id, obj)
	case "update-overlay":
		if !session.authed {
			_ = send_env(session, "error", env.request_id, make_error_payload("auth", "handshake required"))
			return
		}
		src := parse_source(payload_obj)
		cursors: [32]NativeCursor
		n: i32 = 0
		if content, ok := payload_obj["content"].(json.Object); ok {
			n = parse_cursors(content, cursors[:])
		} else if content, ok := payload_obj["scene"].(json.Object); ok {
			n = parse_cursors(content, cursors[:])
		}
		id := session.overlay_id
		if v, ok := object_int(payload_obj, "id"); ok {
			id = i32(v)
		}
		if native_overlay_update(id, &src, raw_data(cursors[:]), n) == 0 {
			_ = send_env(session, "error", env.request_id, make_error_payload("overlay", "update failed"))
			return
		}
		_ = send_env(session, "ok", env.request_id, make_ok_payload())
	case "destroy-overlay":
		if session.overlay_id != 0 {
			native_overlay_destroy(session.overlay_id)
			session.overlay_id = 0
		}
		_ = send_env(session, "ok", env.request_id, make_ok_payload())
	case "heartbeat":
		_ = send_env(session, "heartbeat-ack", env.request_id, make_ok_payload())
	case "shutdown":
		session.running = false
		_ = send_env(session, "ok", env.request_id, make_ok_payload())
	case:
		_ = send_env(session, "error", env.request_id, make_error_payload("unknown", "unsupported message type"))
	}
}

when !ODIN_TEST {
main :: proc() {
	socket_path := arg_value("--socket")
	token_path := arg_value("--token-file")
	if socket_path == "" || token_path == "" {
		os.exit(2)
	}
	token, tok_ok := read_token_file(token_path)
	if !tok_ok {
		os.exit(3)
	}
	conn, cok := ipc_connect(socket_path)
	if !cok {
		os.exit(4)
	}
	session := Session {
		conn    = conn,
		token   = token,
		running = true,
		pending = make([dynamic]u8),
	}
	native_query_caps(&session.caps)
	_ = native_input_init()
	native_input_query_caps(&session.caps)
	last_beat := time.now()
	for session.running {
		native_overlay_pump()
		native_input_pump()
		if native_hotkey_poll() != 0 {
			apply_emergency(&session)
		}
		cap: NativeCapturedKey
		for native_keyboard_capture_poll(&cap) != 0 {
			emit_captured_key(&session, cap)
		}
		n, rok := ipc_read_some(session.conn, session.read_buf[:])
		if !rok {
			input_disarm(&session.input)
			native_keyboard_capture_stop()
			break
		}
		if n > 0 {
			append(&session.pending, ..session.read_buf[:n])
			for len(session.pending) >= 4 {
				size := int(read_u32le(session.pending[:4]))
				if size <= 0 || size > MAX_FRAME_BYTES {
					session.running = false
					break
				}
				if len(session.pending) < 4 + size {
					break
				}
				payload := session.pending[4:4 + size]
				env, err := decode_payload(payload)
				remain := len(session.pending) - 4 - size
				if remain > 0 {
					copy(session.pending[:remain], session.pending[4 + size:])
				}
				resize(&session.pending, remain)
				if err != .None {
					session.running = false
					break
				}
				handle_message(&session, env)
			}
		}
		if time.since(last_beat) > heartbeat_interval {
			last_beat = time.now()
		}
		time.sleep(8 * time.Millisecond)
	}
	input_disarm(&session.input)
	if session.overlay_id != 0 {
		native_overlay_destroy(session.overlay_id)
	}
	native_input_shutdown()
	native_shutdown()
	ipc_close(&session.conn)
}
}
