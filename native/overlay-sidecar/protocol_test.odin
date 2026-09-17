package main

import "core:encoding/json"
import "core:testing"

@(test)
test_frame_roundtrip :: proc(t: ^testing.T) {
	payload := json.Object{}
	payload["token"] = "abc"
	env := Envelope {
		type       = "handshake",
		request_id = "r1",
		payload    = payload,
	}
	frame, err := encode_frame(env)
	testing.expect(t, err == .None)
	testing.expect(t, len(frame) > 4)
	size := int(read_u32le(frame[:4]))
	testing.expect_value(t, size, len(frame) - 4)
	got, derr := decode_payload(frame[4:])
	testing.expect(t, derr == .None)
	testing.expect_value(t, got.type, "handshake")
	testing.expect_value(t, got.request_id, "r1")
}

@(test)
test_oversized_frame_rejected :: proc(t: ^testing.T) {
	testing.expect(t, MAX_FRAME_BYTES == 1024 * 1024)
	header := write_u32le(u32(MAX_FRAME_BYTES + 1))
	testing.expect(t, read_u32le(header[:]) > u32(MAX_FRAME_BYTES))
}

@(test)
test_zero_size_invalid :: proc(t: ^testing.T) {
	header := write_u32le(0)
	testing.expect_value(t, read_u32le(header[:]), u32(0))
}

@(test)
test_version_mismatch :: proc(t: ^testing.T) {
	obj := json.Object{}
	obj["protocolVersion"] = i64(99)
	obj["type"] = "handshake"
	obj["payload"] = json.Object{}
	data, _ := json.marshal(obj)
	_, err := decode_payload(data)
	testing.expect_value(t, err, Frame_Error.Version_Mismatch)
}

@(test)
test_remote_input_types_are_flagged :: proc(t: ^testing.T) {
	testing.expect(t, is_remote_control("pointer-move"))
	testing.expect(t, is_remote_control("keyboard-event"))
	testing.expect(t, is_remote_control("keyboard-capture-arm"))
	testing.expect(t, is_remote_control("keyboard-capture-disarm"))
	testing.expect(t, !is_remote_control("update-overlay"))
	testing.expect(t, !is_remote_control("captured-key"))
}

@(test)
test_malformed_json :: proc(t: ^testing.T) {
	_, err := decode_payload(transmute([]u8)string("{not-json"))
	testing.expect_value(t, err, Frame_Error.Bad_Json)
}
