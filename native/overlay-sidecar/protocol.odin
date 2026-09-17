package main

import "core:encoding/json"
import "core:strings"

PROTOCOL_VERSION :: 2
MAX_FRAME_BYTES :: 1024 * 1024

REMOTE_CONTROL_TYPES :: []string{
	"remote-control-arm",
	"remote-control-disarm",
	"pointer-move",
	"pointer-button",
	"pointer-wheel",
	"keyboard-event",
	"release-all",
	"set-emergency-hotkey",
	"request-input-permission",
	"keyboard-capture-arm",
	"keyboard-capture-disarm",
}

is_remote_control :: proc(type: string) -> bool {
	for t in REMOTE_CONTROL_TYPES {
		if t == type do return true
	}
	return false
}

Envelope :: struct {
	protocol_version: i64,
	request_id:       string,
	type:             string,
	payload:          json.Value,
}

Frame_Error :: enum {
	None,
	Too_Large,
	Zero_Size,
	Bad_Json,
	Bad_Envelope,
	Version_Mismatch,
}

write_u32le :: proc(n: u32) -> [4]u8 {
	return {u8(n), u8(n >> 8), u8(n >> 16), u8(n >> 24)}
}

read_u32le :: proc(b: []u8) -> u32 {
	return u32(b[0]) | u32(b[1]) << 8 | u32(b[2]) << 16 | u32(b[3]) << 24
}

encode_frame :: proc(env: Envelope, allocator := context.allocator) -> ([]u8, Frame_Error) {
	obj := json.Object{}
	obj["protocolVersion"] = i64(PROTOCOL_VERSION)
	obj["type"] = env.type
	if env.request_id != "" {
		obj["requestId"] = env.request_id
	}
	obj["payload"] = env.payload
	data, err := json.marshal(obj, allocator = allocator)
	if err != nil {
		return nil, .Bad_Json
	}
	if len(data) == 0 || len(data) > MAX_FRAME_BYTES {
		delete(data)
		return nil, .Too_Large
	}
	header := write_u32le(u32(len(data)))
	out := make([]u8, 4 + len(data), allocator)
	copy(out[0:4], header[:])
	copy(out[4:], data)
	delete(data)
	return out, .None
}

parse_envelope_value :: proc(value: json.Value) -> (Envelope, Frame_Error) {
	obj, ok := value.(json.Object)
	if !ok {
		return {}, .Bad_Envelope
	}
	ver, vok := obj["protocolVersion"].(json.Integer)
	if !vok || i64(ver) != PROTOCOL_VERSION {
		return {}, .Version_Mismatch
	}
	type, tok := obj["type"].(json.String)
	if !tok || len(type) == 0 {
		return {}, .Bad_Envelope
	}
	payload, pok := obj["payload"]
	if !pok {
		return {}, .Bad_Envelope
	}
	req := ""
	if rid, rok := obj["requestId"].(json.String); rok {
		req = strings.clone(string(rid))
	}
	return Envelope{
		protocol_version = PROTOCOL_VERSION,
		request_id = req,
		type = strings.clone(string(type)),
		payload = payload,
	}, .None
}

decode_payload :: proc(payload: []u8) -> (Envelope, Frame_Error) {
	value, err := json.parse(payload, parse_integers = true)
	if err != nil {
		return {}, .Bad_Json
	}
	return parse_envelope_value(value)
}

object_string :: proc(obj: json.Object, key: string) -> (string, bool) {
	if v, ok := obj[key].(json.String); ok {
		return string(v), true
	}
	return "", false
}

object_int :: proc(obj: json.Object, key: string) -> (i64, bool) {
	if v, ok := obj[key].(json.Integer); ok {
		return i64(v), true
	}
	if v, ok := obj[key].(json.Float); ok {
		return i64(v), true
	}
	return 0, false
}

object_f64 :: proc(obj: json.Object, key: string) -> (f64, bool) {
	if v, ok := obj[key].(json.Float); ok {
		return f64(v), true
	}
	if v, ok := obj[key].(json.Integer); ok {
		return f64(v), true
	}
	return 0, false
}

object_bool :: proc(obj: json.Object, key: string) -> (bool, bool) {
	if v, ok := obj[key].(json.Boolean); ok {
		return bool(v), true
	}
	return false, false
}

json_null :: proc() -> json.Value {
	return json.Null{}
}

json_object :: proc() -> json.Object {
	return json.Object{}
}

make_ok_payload :: proc() -> json.Value {
	obj := json.Object{}
	obj["ok"] = true
	return obj
}

make_error_payload :: proc(code: string, message: string) -> json.Value {
	obj := json.Object{}
	obj["code"] = code
	obj["message"] = message
	return obj
}

make_handshake_ok :: proc() -> json.Value {
	obj := json.Object{}
	obj["protocolVersion"] = i64(PROTOCOL_VERSION)
	return obj
}

make_capabilities_payload :: proc(caps: NativeCaps) -> json.Value {
	perm_name :: proc(v: i32) -> string {
		switch v {
		case 1:
			return "granted"
		case 2:
			return "denied"
		case:
			return "unknown"
		}
	}
	perms := json.Object{}
	perms["accessibility"] = perm_name(caps.accessibility)
	perms["screenRecording"] = perm_name(caps.screen_recording)
	perms["inputMonitoring"] = perm_name(caps.input_monitoring)
	obj := json.Object{}
	obj["overlays"] = caps.overlays != 0
	obj["clickThrough"] = caps.click_through != 0
	obj["globalPointerObservation"] = caps.global_pointer_observation != 0
	obj["globalKeyboardObservation"] = caps.global_keyboard_observation != 0
	obj["pointerInjection"] = caps.pointer_injection != 0
	obj["keyboardInjection"] = caps.keyboard_injection != 0
	obj["emergencyHotkey"] = caps.emergency_hotkey != 0
	obj["keyboardCapture"] = caps.keyboard_capture != 0
	obj["displayEnumeration"] = caps.display_enumeration != 0
	reason := caps.unavailable_reason
	if reason[0] != 0 {
		n := 0
		for b, i in reason {
			if b == 0 { break }
			n = i + 1
		}
		obj["unavailableReason"] = strings.clone(string(reason[:n]))
	}
	obj["permissions"] = perms
	backend := caps.backend
	if backend[0] != 0 {
		n := 0
		for b, i in backend {
			if b == 0 { break }
			n = i + 1
		}
		obj["backend"] = strings.clone(string(backend[:n]))
	}
	return obj
}
