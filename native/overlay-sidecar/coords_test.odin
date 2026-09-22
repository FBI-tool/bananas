package main

import "core:testing"

@(test)
test_cocoa_frame_flips_y :: proc(t: ^testing.T) {
	frame := cocoa_frame_from_top_left(0, 100, 800, 600, 1, 1080)
	testing.expect_value(t, frame.x, i32(0))
	testing.expect_value(t, frame.y, i32(380))
	testing.expect_value(t, frame.width, i32(800))
	testing.expect_value(t, frame.height, i32(600))
	testing.expect_value(t, frame.bitmap_w, i32(800))
	testing.expect_value(t, frame.bitmap_h, i32(600))
}

@(test)
test_cocoa_frame_keeps_negative_origin :: proc(t: ^testing.T) {
	frame := cocoa_frame_from_top_left(-1920, 0, 1920, 1080, 1, 1080)
	testing.expect_value(t, frame.x, i32(-1920))
	testing.expect_value(t, frame.y, i32(0))
	above := cocoa_frame_from_top_left(0, -1080, 1920, 1080, 1, 1080)
	testing.expect_value(t, above.y, i32(1080))
}

@(test)
test_cocoa_frame_retina_bitmap :: proc(t: ^testing.T) {
	frame := cocoa_frame_from_top_left(0, 0, 200, 100, 2, 100)
	testing.expect_value(t, frame.width, i32(200))
	testing.expect_value(t, frame.height, i32(100))
	testing.expect_value(t, frame.bitmap_w, i32(400))
	testing.expect_value(t, frame.bitmap_h, i32(200))
	testing.expect_value(t, frame.y, i32(0))
}
