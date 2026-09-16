package main

import "core:encoding/json"
import "core:strings"

PROTOCOL_VERSION :: 1
MAX_FRAME_BYTES :: 1024 * 1024

REMOTE_INPUT_TYPES :: []string{
	"request-control",
	"grant-control",
	"revoke-control",
	"pointer-event",
	"keyboard-event",
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

is_remote_input :: proc(type: string) -> bool {
	for t in REMOTE_INPUT_TYPES {
		if t == type do return true
	}
	return false
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
	obj["globalPointerObservation"] = false
	obj["globalKeyboardObservation"] = false
	obj["pointerInjection"] = false
	obj["keyboardInjection"] = false
	obj["displayEnumeration"] = caps.display_enumeration != 0
	obj["permissions"] = perms
	return obj
}
