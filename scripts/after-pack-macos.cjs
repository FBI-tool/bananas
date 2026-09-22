'use strict'

const fs = require('node:fs')
const path = require('node:path')

const HELPER_NAME = 'p2p.kiwi Sidecar.app'

const infoPlist = (version) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>kiwi.p2p.desktop.sidecar</string>
  <key>CFBundleName</key>
  <string>p2p.kiwi Sidecar</string>
  <key>CFBundleDisplayName</key>
  <string>p2p.kiwi Sidecar</string>
  <key>CFBundleExecutable</key>
  <string>p2p-kiwi-sidecar</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleVersion</key>
  <string>${version}</string>
  <key>CFBundleShortVersionString</key>
  <string>${version}</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>LSMinimumSystemVersion</key>
  <string>11.0</string>
  <key>LSUIElement</key>
  <true/>
</dict>
</plist>
`

/**
 * Wraps the universal sidecar in a nested helper app before signing.
 * LSBackgroundOnly is omitted: Apple does not show windows for those apps.
 *
 * @param {import('app-builder-lib').AfterPackContext} context
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appName = context.packager.appInfo.productFilename
  const appPath = path.join(context.appOutDir, `${appName}.app`)
  const helperRoot = path.join(appPath, 'Contents', 'Helpers', HELPER_NAME)
  const helperBin = path.join(helperRoot, 'Contents', 'MacOS', 'p2p-kiwi-sidecar')
  // Universal builds pack x64 and arm64 first. afterPack runs for each of
  // those apps, then again on the merged app after the per-arch Resources
  // copy has already been moved into the helper.
  if (fs.existsSync(helperBin)) return

  const packaged = path.join(appPath, 'Contents', 'Resources', 'sidecar', 'p2p-kiwi-sidecar')
  const built = path.join(__dirname, '..', 'native', 'overlay-sidecar', 'dist', 'p2p-kiwi-sidecar')
  const source = [packaged, built].find((candidate) => fs.existsSync(candidate))
  if (!source) {
    throw new Error(`sidecar missing before helper assembly: ${packaged}`)
  }

  const version = context.packager.appInfo.version || '1.0.0'
  const macOSDir = path.dirname(helperBin)
  fs.mkdirSync(macOSDir, { recursive: true })
  fs.copyFileSync(source, helperBin)
  fs.chmodSync(helperBin, 0o755)
  fs.writeFileSync(path.join(helperRoot, 'Contents', 'Info.plist'), infoPlist(version))
  if (source === packaged) {
    fs.rmSync(path.dirname(packaged), { recursive: true, force: true })
  }
}
