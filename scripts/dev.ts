import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { isWaylandSession, linuxGpuCliArgs } from '../src/main/linuxGpuFlags.ts'

process.env.ELECTRON_CLI_ARGS = JSON.stringify(
  linuxGpuCliArgs({
    wayland: isWaylandSession(),
    vaapi: true,
  }),
)

const electronVite = fileURLToPath(new URL('../node_modules/.bin/electron-vite', import.meta.url))
const child = spawn(electronVite, ['dev', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 1)
})
