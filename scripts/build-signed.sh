#!/bin/sh
# Builds the macOS app signed (and notarized if Apple ID credentials are set).
# Secrets come from the git-ignored .env.signing file or the environment, never from tracked files.
set -e
cd "$(dirname "$0")/.."
if [ -f .env.signing ]; then
  set -a
  . ./.env.signing
  set +a
fi
if [ -z "$APPLE_SIGNING_IDENTITY" ]; then
  echo "APPLE_SIGNING_IDENTITY is not set. Copy .env.signing.example to .env.signing and fill it in." >&2
  exit 1
fi
if [ -z "$APPLE_ID" ] || [ -z "$APPLE_PASSWORD" ] || [ -z "$APPLE_TEAM_ID" ]; then
  echo "Note: APPLE_ID / APPLE_PASSWORD / APPLE_TEAM_ID not all set, building signed but without notarization." >&2
  unset APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID
fi
exec npx tauri build
