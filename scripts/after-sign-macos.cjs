'use strict'

const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const requireCmd = (command, args, label) => {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.status !== 0) {
    const output = `${result.stdout || ''}${result.stderr || ''}`.trim()
    throw new Error(`${label} failed: ${output || `${command} exited ${result.status}`}`)
  }
  return result
}

/**
 * Fails the macOS pack if the overlay sidecar is missing, not universal, or unsigned.
 *
 * @param {import('app-builder-lib').AfterPackContext} context
 */
exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') {
    return
  }

  const appName = context.packager.appInfo.productFilename
  const appPath = path.join(context.appOutDir, `${appName}.app`)
  const sidecar = path.join(appPath, 'Contents', 'Resources', 'sidecar', 'p2p-kiwi-sidecar')

  if (!fs.existsSync(sidecar)) {
    throw new Error(`sidecar missing from signed app: ${sidecar}`)
  }

  const archs = requireCmd('lipo', ['-archs', sidecar], 'lipo -archs').stdout.trim()
  if (!/(^|\s)arm64(\s|$)/.test(archs) || !/(^|\s)x86_64(\s|$)/.test(archs)) {
    throw new Error(`sidecar is not universal (arm64 + x86_64): ${archs}`)
  }

  requireCmd('codesign', ['--verify', '--strict', sidecar], 'codesign --verify sidecar')

  const display = requireCmd(
    'codesign',
    ['--display', '--verbose=2', sidecar],
    'codesign --display sidecar',
  )
  const displayOut = `${display.stdout}\n${display.stderr}`
  if (!/\(runtime\)/.test(displayOut)) {
    throw new Error(`sidecar is not signed with hardened runtime:\n${displayOut}`)
  }
}
