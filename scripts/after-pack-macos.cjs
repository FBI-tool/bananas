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
  const source = path.join(appPath, 'Contents', 'Resources', 'sidecar', 'p2p-kiwi-sidecar')
  if (!fs.existsSync(source)) {
    throw new Error(`sidecar missing before helper assembly: ${source}`)
  }

  const version = context.packager.appInfo.version || '1.0.0'
  const helperRoot = path.join(appPath, 'Contents', 'Helpers', HELPER_NAME)
  const macOSDir = path.join(helperRoot, 'Contents', 'MacOS')
  const helperBin = path.join(macOSDir, 'p2p-kiwi-sidecar')
  fs.mkdirSync(macOSDir, { recursive: true })
  fs.copyFileSync(source, helperBin)
  fs.chmodSync(helperBin, 0o755)
  fs.writeFileSync(path.join(helperRoot, 'Contents', 'Info.plist'), infoPlist(version))
  fs.rmSync(path.join(appPath, 'Contents', 'Resources', 'sidecar'), { recursive: true, force: true })
}
