#!/bin/sh
# Uploads the .pkg built by build-appstore.sh to App Store Connect (APPLE_ID + app-specific password from .env.signing).
set -e
cd "$(dirname "$0")/.."
if [ -f .env.signing ]; then
  set -a
  . ./.env.signing
  set +a
fi
NAME=$(node -p "require('./src-tauri/tauri.conf.json').productName")
PKG="src-tauri/gen/appstore/$NAME.pkg"
if [ ! -f "$PKG" ]; then echo "$PKG not found, run npm run app:appstore first." >&2; exit 1; fi
if [ -z "$APPLE_ID" ] || [ -z "$APPLE_PASSWORD" ]; then echo "APPLE_ID and APPLE_PASSWORD (app-specific) must be set." >&2; exit 1; fi
export APPLE_PASSWORD
xcrun altool --upload-app --type macos --file "$PKG" --username "$APPLE_ID" --password @env:APPLE_PASSWORD
