import { describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { join } from 'node:path'
import net from 'node:net'
import type { ChildProcess } from 'node:child_process'
import { SidecarManager, defaultCapabilities, ipcPathForId } from './sidecarManager'
import { encodeEnvelope, FrameDecoder, SIDECAR_PROTOCOL_VERSION, type Envelope } from './protocol'

const sidecarBin = join(process.cwd(), 'native', 'overlay-sidecar', 'dist', 'p2p-kiwi-sidecar')

describe('SidecarManager', () => {
  it('resolves missing binaries without throwing', async () => {
    const mgr = new SidecarManager()
    await mgr.start()
    if (!existsSync(sidecarBin)) {
      expect(mgr.isAvailable()).toBe(false)
    }
    await mgr.stop()
  })

  it('handshakes with a packaged sidecar when present', async () => {
    if (!existsSync(sidecarBin)) return
    const mgr = new SidecarManager()
    await mgr.start()
    const caps = mgr.getCapabilities()
    expect(typeof caps.overlays).toBe('boolean')
    expect(caps.pointerInjection).toBe(false)
    expect(caps.keyboardInjection).toBe(false)
    await mgr.stop()
    expect(mgr.isAvailable()).toBe(false)
  }, 15000)

  it('builds runtime socket paths without throwing', () => {
    const path = ipcPathForId('abc123')
    expect(path.length).toBeGreaterThan(4)
    expect(defaultCapabilities().pointerInjection).toBe(false)
    expect(defaultCapabilities().keyboardInjection).toBe(false)
  })

  it('handshakes with a mock sidecar process and fails closed on version mismatch', async () => {
    const reply = (sock: net.Socket, frame: Envelope, type: string, payload: unknown): void => {
      sock.write(
        encodeEnvelope({
          protocolVersion: SIDECAR_PROTOCOL_VERSION,
          requestId: frame.requestId,
          type,
          payload,
        }),
      )
    }
    const spawn = vi.fn((_bin: string, args: readonly string[]) => {
      const path = args[args.indexOf('--socket') + 1] ?? ''
      const tokenFile = args[args.indexOf('--token-file') + 1] ?? ''
      const token = readFileSync(tokenFile, 'utf8')
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        pid: 4242,
        exitCode: null,
        kill: vi.fn(() => true),
      }) as unknown as ChildProcess
      setImmediate(() => {
        const sock = net.connect(path)
        const decoder = new FrameDecoder()
        sock.on('data', (chunk) => {
          const frames = decoder.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
          for (const frame of frames) {
            if (frame.type === 'handshake') {
              const payload = frame.payload as { token?: string }
              if (payload.token !== token) return
              reply(sock, frame, 'handshake-ok', {})
            }
            if (frame.type === 'get-capabilities') {
              reply(sock, frame, 'capabilities', {
                overlays: true,
                clickThrough: true,
                displayEnumeration: true,
                pointerInjection: true,
                keyboardInjection: true,
                globalPointerObservation: true,
                globalKeyboardObservation: true,
                permissions: { accessibility: 'unknown' },
              })
            }
            if (frame.type === 'heartbeat') reply(sock, frame, 'heartbeat-ack', {})
            if (frame.type === 'shutdown') reply(sock, frame, 'ok', {})
          }
        })
      })
      return child
    })

    const mgr = new SidecarManager({
      resolvePath: () => '/tmp/mock-sidecar',
      spawn: spawn as never,
    })
    await mgr.start()
    expect(mgr.isAvailable()).toBe(true)
    expect(mgr.getCapabilities().overlays).toBe(true)
    expect(mgr.getCapabilities().pointerInjection).toBe(false)
    expect(mgr.getCapabilities().keyboardInjection).toBe(false)
    await mgr.stop()
    expect(mgr.isAvailable()).toBe(false)
  }, 10000)

  it('fails closed when the sidecar speaks the wrong protocol version', async () => {
    const spawn = vi.fn((_bin: string, args: readonly string[]) => {
      const path = args[args.indexOf('--socket') + 1] ?? ''
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        pid: 7,
        exitCode: null,
        kill: vi.fn(() => true),
      }) as unknown as ChildProcess
      setImmediate(() => {
        const sock = net.connect(path)
        const decoder = new FrameDecoder()
        sock.on('data', (chunk) => {
          const frames = decoder.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
          for (const frame of frames) {
            sock.write(
              encodeEnvelope({
                protocolVersion: 99,
                requestId: frame.requestId,
                type: 'handshake-ok',
                payload: {},
              }),
            )
          }
        })
      })
      return child
    })
    const mgr = new SidecarManager({
      resolvePath: () => '/tmp/mock-sidecar',
      spawn: spawn as never,
    })
    await mgr.start()
    expect(mgr.isAvailable()).toBe(false)
    await mgr.stop()
  }, 10000)
})
