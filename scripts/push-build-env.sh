#!/usr/bin/env bash
# Send the app's public build-time keys to EAS.
#
# EXPO_PUBLIC_* values are inlined into the JavaScript bundle at build time, so
# the cloud builder needs them. It will not pick them up from your local .env:
# EAS uploads what git tracks, and .env is gitignored -- deliberately, because
# that is also where the Razorpay secret lives.
#
# So these are pushed once, to EAS, and stay there for every future build.
#
#   1. bash scripts/push-build-env.sh
#   2. npm run build:apk --workspace @taskdrop/mobile
#
# You will be asked to sign in to Expo once, if you have not.
#
# EXPO_PUBLIC_SUPABASE_* are *publishable* and end up readable in the shipped bundle:
#   EXPO_PUBLIC_SUPABASE_ANON_KEY  -- safe by design; RLS is what protects data.
#
# EXPO_GOOGLE_MAPS_API_KEY is pushed as an EAS *secret*, not plaintext. It is not
# EXPO_PUBLIC_, so it never enters the JS bundle; app.config.js reads it at build
# time for the Android manifest. It is still extractable from an APK's manifest,
# so restrict it in Google Cloud Console to the Maps SDK for Android and the
# com.taskdrop.app package + SHA-1.

set -euo pipefail

ENV_FILE="${1:-apps/mobile/.env}"
[ -f "$ENV_FILE" ] || ENV_FILE=".env"

if [ ! -f "$ENV_FILE" ]; then
  echo "No .env found. Run this from the repo root." >&2
  exit 1
fi

read_var() {
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1 | tr -d '\r' | sed 's/[[:space:]]*$//'
}

PUBLIC_KEYS="EXPO_PUBLIC_SUPABASE_URL EXPO_PUBLIC_SUPABASE_ANON_KEY"
SECRET_KEYS="EXPO_GOOGLE_MAPS_API_KEY"

missing=0
for key in $PUBLIC_KEYS $SECRET_KEYS; do
  value="$(read_var "$key")"
  case "$value" in
    ""|your_*|"<"*)
      echo "  MISSING  $key is not set in $ENV_FILE"
      missing=1
      ;;
    *)
      echo "  ok       $key (${#value} chars)"
      ;;
  esac
done

if [ "$missing" -ne 0 ]; then
  echo
  echo "Fill those in before building, or the app ships unable to reach Supabase." >&2
  exit 1
fi

cd apps/mobile

echo
push_var() {
  # $1 = name, $2 = visibility. --force overwrites an earlier value rather than
  # failing on the second run.
  npx --yes eas-cli env:create \
    --scope project \
    --name "$1" \
    --value "$(cd ../.. && read_var() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1 | tr -d '\r'; }; read_var "$1")" \
    --visibility "$2" \
    --environment production \
    --environment preview \
    --non-interactive \
    --force || echo "  (could not set $1 — set it in the EAS dashboard)"
}

echo "Pushing to EAS as plain-text build variables…"
for key in $PUBLIC_KEYS; do push_var "$key" plaintext; done

echo
echo "Pushing to EAS as secrets (never shown again, never in the JS bundle)…"
for key in $SECRET_KEYS; do push_var "$key" secret; done

echo
echo "Done. Now build:"
echo "  npm run build:apk --workspace @taskdrop/mobile"
