#+build linux, darwin, freebsd
package main

import "core:c"
import "core:os"
import "core:strings"
import "core:sys/posix"

Ipc_Conn :: struct {
	fd: posix.FD,
}

ipc_connect :: proc(path: string) -> (Ipc_Conn, bool) {
	fd := posix.socket(.UNIX, .STREAM)
	if fd == -1 {
		return {}, false
	}
	addr: posix.sockaddr_un
	addr.sun_family = .UNIX
	n := min(len(path), len(addr.sun_path) - 1)
	for i in 0 ..< n {
		addr.sun_path[i] = c.char(path[i])
	}
	if posix.connect(fd, (^posix.sockaddr)(&addr), posix.socklen_t(size_of(addr))) != .OK {
		posix.close(fd)
		return {}, false
	}
	flags := posix.fcntl(fd, .GETFL)
	_ = posix.fcntl(fd, .SETFL, flags | i32(posix.O_NONBLOCK))
	return Ipc_Conn{fd = fd}, true
}

ipc_close :: proc(conn: ^Ipc_Conn) {
	if conn.fd != -1 {
		posix.close(conn.fd)
		conn.fd = -1
	}
}

ipc_write_all :: proc(conn: Ipc_Conn, data: []u8) -> bool {
	off := 0
	for off < len(data) {
		n := posix.write(conn.fd, raw_data(data[off:]), c.size_t(len(data[off:])))
		if n <= 0 {
			return false
		}
		off += int(n)
	}
	return true
}

ipc_read_some :: proc(conn: Ipc_Conn, buf: []u8) -> (int, bool) {
	n := posix.read(conn.fd, raw_data(buf), c.size_t(len(buf)))
	if n < 0 {
		err := posix.get_errno()
		if err == .EAGAIN || err == .EWOULDBLOCK {
			return 0, true
		}
		return 0, false
	}
	if n == 0 {
		return 0, false
	}
	return int(n), true
}

read_token_file :: proc(path: string) -> (string, bool) {
	data, err := os.read_entire_file(path, context.allocator)
	if err != nil {
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
