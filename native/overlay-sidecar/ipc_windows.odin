#+build windows
package main

import "core:os"
import "core:strings"
import win "core:sys/windows"
import "core:unicode/utf16"

Ipc_Conn :: struct {
	handle: win.HANDLE,
}

ipc_connect :: proc(path: string) -> (Ipc_Conn, bool) {
	wpath := make([]u16, len(path) + 1)
	defer delete(wpath)
	n, _ := utf16.encode_string(wpath, path)
	wpath[n] = 0
	handle := win.CreateFileW(
		raw_data(wpath),
		win.GENERIC_READ | win.GENERIC_WRITE,
		0,
		nil,
		win.OPEN_EXISTING,
		0,
		nil,
	)
	if handle == win.INVALID_HANDLE {
		return {}, false
	}
	return Ipc_Conn{handle = handle}, true
}

ipc_close :: proc(conn: ^Ipc_Conn) {
	if conn.handle != nil && conn.handle != win.INVALID_HANDLE {
		win.CloseHandle(conn.handle)
		conn.handle = win.INVALID_HANDLE
	}
}

ipc_write_all :: proc(conn: Ipc_Conn, data: []u8) -> bool {
	off := 0
	for off < len(data) {
		written: win.DWORD
		ok := win.WriteFile(conn.handle, raw_data(data[off:]), win.DWORD(len(data) - off), &written, nil)
		if !ok || written == 0 {
			return false
		}
		off += int(written)
	}
	return true
}

ipc_read_some :: proc(conn: Ipc_Conn, buf: []u8) -> (int, bool) {
	n: win.DWORD
	ok := win.ReadFile(conn.handle, raw_data(buf), win.DWORD(len(buf)), &n, nil)
	if !ok {
		return 0, false
	}
	return int(n), true
}

read_token_file :: proc(path: string) -> (string, bool) {
	data, ok := os.read_entire_file(path)
	if !ok {
		return "", false
	}
	_ = os.remove(path)
	text := strings.trim_space(string(data))
	if len(text) < 32 {
		delete(data)
		return "", false
	}
	cloned := strings.clone(text)
	delete(data)
	return cloned, true
}
