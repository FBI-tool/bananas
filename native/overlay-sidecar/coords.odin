package main

import "core:math"

Cocoa_Frame :: struct {
	x, y:              i32,
	width, height:     i32,
	bitmap_w, bitmap_h: i32,
}

// Electron display bounds are top-left, y-down DIP points. Cocoa window
// frames are bottom-left, y-up, relative to the primary display height.
// overlay_macos.m uses the same arithmetic.
cocoa_frame_from_top_left :: proc(qx, qy, qw, qh: i32, scale: f32, primary_height: i32) -> Cocoa_Frame {
	w := qw
	h := qh
	s := scale
	if w < 1 do w = 1
	if h < 1 do h = 1
	if s < 1 do s = 1
	bw := i32(math.round_f32(f32(w) * s))
	bh := i32(math.round_f32(f32(h) * s))
	if bw < 1 do bw = 1
	if bh < 1 do bh = 1
	return Cocoa_Frame{
		x = qx,
		y = primary_height - (qy + h),
		width = w,
		height = h,
		bitmap_w = bw,
		bitmap_h = bh,
	}
}
