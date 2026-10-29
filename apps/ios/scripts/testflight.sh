#!/bin/zsh
# Archives the app and uploads it to TestFlight from this Mac.
#
# The archive signs automatically; the export re-signs with the "Apple Distribution" certificate
# in your keychain and the "Forecast App Store" profile (both in the team's developer account).
# Either sign in to Xcode with your Apple ID (Settings > Accounts),
# or pass an App Store Connect API key:
#   ASC_KEY_ID=XXXXXXXXXX ASC_ISSUER_ID=xxxxxxxx-... ASC_KEY_PATH=~/Downloads/AuthKey_XXXXXXXXXX.p8 scripts/testflight.sh
#
# EXPORT_SIGNING=automatic lets Apple sign the export with a cloud-managed distribution
# certificate instead, so a machine without the certificate (GitHub Actions) can upload.
# It needs the API key above, with the Admin role.
set -euo pipefail
cd "${0:A:h}/.."

export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
BUILD_NUMBER="${BUILD_NUMBER:-$(date +%Y%m%d%H%M)}"
OUT="$(mktemp -d)"

auth=()
if [[ -n "${ASC_KEY_ID:-}" ]]; then
  auth=(-authenticationKeyPath "${ASC_KEY_PATH:?}" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "${ASC_ISSUER_ID:?}")
fi

xcodebuild archive \
  -project Forecast.xcodeproj -scheme Forecast -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$OUT/Forecast.xcarchive" \
  -allowProvisioningUpdates "${auth[@]}" \
  CURRENT_PROJECT_VERSION="$BUILD_NUMBER"

if [[ "${EXPORT_SIGNING:-manual}" == automatic ]]; then
  signing="<key>signingStyle</key><string>automatic</string>"
else
  signing="<key>signingStyle</key><string>manual</string>
  <key>signingCertificate</key><string>Apple Distribution</string>
  <key>provisioningProfiles</key>
  <dict><key>com.connortp.forecast</key><string>Forecast App Store</string></dict>"
fi

cat > "$OUT/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  $signing
  <key>teamID</key><string>ZUADR84P7U</string>
  <key>uploadSymbols</key><true/>
</dict>
</plist>
PLIST

xcodebuild -exportArchive \
  -archivePath "$OUT/Forecast.xcarchive" -exportOptionsPlist "$OUT/ExportOptions.plist" -exportPath "$OUT/export" \
  -allowProvisioningUpdates "${auth[@]}"

echo "Uploaded build $BUILD_NUMBER. It shows up in TestFlight after Apple finishes processing (usually 5 to 15 minutes)."
