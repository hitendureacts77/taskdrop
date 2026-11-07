#!/usr/bin/env bash
# Push the Razorpay secrets from the master file `.env.all-secrets` up to Supabase
# as Edge Function secrets (plan task 2.17, "one home per secret").
#
# The values never pass through a chat, a commit, your shell history or a command line:
# they go to the Supabase CLI in a private temporary --env-file that is deleted straight
# after. Only names are printed, never a value or a length.
#
#   1. Razorpay -> Settings -> API Keys -> Generate Key
#   2. Put them in .env.all-secrets:
#        RAZORPAY_KEY_ID=rzp_...
#        RAZORPAY_KEY_SECRET=...
#        RAZORPAY_WEBHOOK_SECRET=...
#   3. bash scripts/push-payment-secrets.sh                  (staging, project wjxvingpfbfvkfqhrguj)
#      bash scripts/push-payment-secrets.sh --production     (reads PROD_<NAME>, project in
#                                                             PROD_SUPABASE_PROJECT_ID; Step 5 only)
#   4. npm run check:payments
#
# Options: --file <path> uses another secrets file (or set SECRETS_FILE). You will be asked to
# sign in to the Supabase CLI once, unless SUPABASE_ACCESS_TOKEN (PROD_ one for --production) is in the file.
#
# Where the other function secrets go: scripts/set-function-secrets.mjs. These three are kept apart
# because supabase/functions/_shared/secrets.ts reads a function secret first, then Supabase Vault,
# so each Razorpay name must live in exactly one of the two. This script uses the function secret.

set -euo pipefail

STAGING_PROJECT="wjxvingpfbfvkfqhrguj"
NAMES="RAZORPAY_KEY_ID RAZORPAY_KEY_SECRET RAZORPAY_WEBHOOK_SECRET"

production=0
file_arg=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --production) production=1 ;;
    --file) shift; file_arg="${1:-}" ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done

# Find the master file: --file, SECRETS_FILE, here, then the main checkout (a git worktree has no
# copy of the git-ignored file).
ENV_FILE=""
candidates=()
[ -n "$file_arg" ] && candidates+=("$file_arg")
[ -n "${SECRETS_FILE:-}" ] && candidates+=("$SECRETS_FILE")
candidates+=(".env.all-secrets")
if common="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"; then
  candidates+=("$(dirname "$common")/.env.all-secrets")
fi
for c in "${candidates[@]}"; do
  if [ -f "$c" ]; then ENV_FILE="$c"; break; fi
done
if [ -z "$ENV_FILE" ]; then
  echo "No .env.all-secrets found (use --file or SECRETS_FILE). Run this from the repo root." >&2
  exit 1
fi

read_var() {
  # Last match wins; optional 'export '; surrounding quotes and trailing whitespace trimmed.
  sed -n -E "s/^(export[[:space:]]+)?$1[[:space:]]*=[[:space:]]*//p" "$ENV_FILE" \
    | tail -n 1 | tr -d '\r' | sed -E 's/[[:space:]]+$//; s/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/'
}

prefix=""
token_name="SUPABASE_ACCESS_TOKEN"
PROJECT="$STAGING_PROJECT"
label="staging"
if [ "$production" -eq 1 ]; then
  prefix="PROD_"
  token_name="PROD_SUPABASE_ACCESS_TOKEN"
  label="production"
  PROJECT="$(read_var PROD_SUPABASE_PROJECT_ID)"
  if [ -z "$PROJECT" ]; then
    echo "PROD_SUPABASE_PROJECT_ID is not in the secrets file (the production project does not exist yet; Step 5)." >&2
    exit 1
  fi
  if ! printf '%s' "$PROJECT" | grep -Eq '^[a-z0-9]{20}$'; then
    echo "PROD_SUPABASE_PROJECT_ID is not a Supabase project ref (20 lowercase letters and digits)." >&2
    exit 1
  fi
  if [ "$PROJECT" = "$STAGING_PROJECT" ]; then
    echo "PROD_SUPABASE_PROJECT_ID is the staging project. Production and staging must stay separate." >&2
    exit 1
  fi
fi

echo "Target: $label project $PROJECT (values from the secrets file; none are printed)"

tmp_dir=""
cleanup() { [ -n "$tmp_dir" ] && rm -rf "$tmp_dir"; }
trap cleanup EXIT
tmp_dir="$(mktemp -d)"
chmod 700 "$tmp_dir"
env_out="$tmp_dir/payments.env"
( umask 077; : > "$env_out" )

missing=0
for key in $NAMES; do
  value="$(read_var "${prefix}${key}")"
  case "$value" in
    ""|your_*|"<"*)
      echo "  MISSING  ${prefix}${key} is blank or a placeholder in $(basename "$ENV_FILE")"
      missing=1
      ;;
    *)
      case "$value" in
        *$'\n'*) echo "  MISSING  ${prefix}${key} holds a line break"; missing=1; continue ;;
      esac
      escaped="$(printf '%s' "$value" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"
      printf '%s="%s"\n' "$key" "$escaped" >> "$env_out"
      echo "  ok       ${prefix}${key}"
      ;;
  esac
done

if [ "$missing" -ne 0 ]; then
  echo >&2
  echo "Fill those in first - see docs/GOING_LIVE.md step 1. Nothing was sent." >&2
  exit 1
fi

token="$(read_var "$token_name")"
echo
echo "Sending to project $PROJECT..."
if [ -n "$token" ]; then
  SUPABASE_ACCESS_TOKEN="$token" npx --yes supabase@2 secrets set --env-file "$env_out" --project-ref "$PROJECT"
else
  npx --yes supabase@2 secrets set --env-file "$env_out" --project-ref "$PROJECT"
fi

echo
echo "Done. Now register the webhook in Razorpay:"
echo "  URL    https://$PROJECT.supabase.co/functions/v1/razorpay-webhook"
echo "  Event  payment_link.paid"
echo "  Secret the RAZORPAY_WEBHOOK_SECRET value in the secrets file"
echo
echo "Then: npm run check:payments"
