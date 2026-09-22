'use strict'

const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const FORBIDDEN_HELPER_ENTITLEMENTS = [
  'com.apple.security.cs.allow-jit',
  'com.apple.security.cs.allow-unsigned-executable-memory',
  'com.apple.security.cs.allow-dyld-environment-variables',
  'com.apple.security.device.camera',
  'com.apple.security.device.audio-input',
]

const requireCmd = (command, args, label) => {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.status !== 0) {
    const output = `${result.stdout || ''}${result.stderr || ''}`.trim()
    throw new Error(`${label} failed: ${output || `${command} exited ${result.status}`}`)
  }
  return result
}

const commandOutput = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  return {
    status: result.status,
    output: `${result.stdout || ''}\n${result.stderr || ''}`,
  }
}

/**
 * Re-signs the nested helper with its own entitlements, then the outer app.
 * electron-builder's inherited entitlements would otherwise give the helper
 * Electron's JIT and device exceptions.
 *
 * @param {import('app-builder-lib').AfterPackContext} context
 */
exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') {
    return
  }

  const appName = context.packager.appInfo.productFilename
  const appPath = path.join(context.appOutDir, `${appName}.app`)
  const helperApp = path.join(appPath, 'Contents', 'Helpers', 'p2p.kiwi Sidecar.app')
  const sidecar = path.join(helperApp, 'Contents', 'MacOS', 'p2p-kiwi-sidecar')
  const root = path.join(__dirname, '..')
  const helperEntitlements = path.join(root, 'build', 'entitlements.mac.sidecar.plist')
  const appEntitlements = path.join(root, 'build', 'entitlements.mac.plist')

  if (!fs.existsSync(sidecar)) {
    throw new Error(`sidecar missing from signed app: ${sidecar}`)
  }

  const archs = requireCmd('lipo', ['-archs', sidecar], 'lipo -archs').stdout.trim()
  if (!/(^|\s)arm64(\s|$)/.test(archs) || !/(^|\s)x86_64(\s|$)/.test(archs)) {
    throw new Error(`sidecar is not universal (arm64 + x86_64): ${archs}`)
  }

  const described = commandOutput('codesign', ['-dv', '--verbose=4', appPath])
  const authority = described.output.match(/^Authority=(.*)$/m)?.[1]
  const identity = process.env.CSC_NAME || authority || '-'
  const signArgs = ['--force', '--options', 'runtime', '--sign', identity]
  if (identity !== '-') signArgs.push('--timestamp')

  requireCmd(
    'codesign',
    [...signArgs, '--entitlements', helperEntitlements, helperApp],
    'codesign helper',
  )
  requireCmd(
    'codesign',
    [...signArgs, '--entitlements', appEntitlements, appPath],
    'codesign app',
  )

  requireCmd('codesign', ['--verify', '--strict', sidecar], 'codesign --verify sidecar')
  requireCmd(
    'codesign',
    ['--verify', '--deep', '--strict', '--verbose=2', appPath],
    'codesign --verify app',
  )

  const display = requireCmd(
    'codesign',
    ['--display', '--verbose=2', sidecar],
    'codesign --display sidecar',
  )
  const displayOut = `${display.stdout}\n${display.stderr}`
  if (!/\(runtime\)/.test(displayOut)) {
    throw new Error(`sidecar is not signed with hardened runtime:\n${displayOut}`)
  }

  const entitlements = commandOutput('codesign', ['-d', '--entitlements', '-', sidecar])
  for (const key of FORBIDDEN_HELPER_ENTITLEMENTS) {
    if (entitlements.output.includes(key)) {
      throw new Error(`sidecar entitlements must not contain ${key}`)
    }
  }
}
