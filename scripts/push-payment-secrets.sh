#!/usr/bin/env bash
# Push the Razorpay secrets from your local .env up to Supabase.
#
# Everything that could be automated already has been. What is left needs
# credentials that only exist in your Razorpay dashboard, so this script reads
# them from .env (which is gitignored) and sends them — the values never pass
# through a chat, a commit, or your shell history.
#
#   1. Razorpay → Settings → API Keys → Generate Key
#   2. Put them in .env:
#        RAZORPAY_KEY_ID=rzp_live_...
#        RAZORPAY_KEY_SECRET=...
#      (RAZORPAY_WEBHOOK_SECRET is already generated for you.)
#   3. bash scripts/push-payment-secrets.sh
#   4. npm run check:payments
#
# You will be asked to sign in to the Supabase CLI once, if you have not.

set -euo pipefail

PROJECT="${SUPABASE_PROJECT_REF:-wjxvingpfbfvkfqhrguj}"
ENV_FILE="${1:-.env}"

if [ ! -f "$ENV_FILE" ]; then
  echo "No $ENV_FILE found. Run this from the repo root." >&2
  exit 1
fi

read_var() {
  # Last match wins, trailing whitespace trimmed, no 'export ' prefix assumed.
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1 | tr -d '\r' | sed 's/[[:space:]]*$//'
}

missing=0
for key in RAZORPAY_KEY_ID RAZORPAY_KEY_SECRET RAZORPAY_WEBHOOK_SECRET; do
  value="$(read_var "$key")"
  case "$value" in
    ""|your_*|"<"*)
      echo "  MISSING  $key is still a placeholder in $ENV_FILE"
      missing=1
      ;;
    *)
      echo "  ok       $key (${#value} chars)"
      ;;
  esac
done

if [ "$missing" -ne 0 ]; then
  echo
  echo "Fill those in first — see docs/GOING_LIVE.md step 1." >&2
  exit 1
fi

echo
echo "Sending to project $PROJECT…"
npx --yes supabase secrets set \
  "RAZORPAY_KEY_ID=$(read_var RAZORPAY_KEY_ID)" \
  "RAZORPAY_KEY_SECRET=$(read_var RAZORPAY_KEY_SECRET)" \
  "RAZORPAY_WEBHOOK_SECRET=$(read_var RAZORPAY_WEBHOOK_SECRET)" \
  --project-ref "$PROJECT"

echo
echo "Done. Now register the webhook in Razorpay:"
echo "  URL    https://$PROJECT.supabase.co/functions/v1/razorpay-webhook"
echo "  Event  payment_link.paid"
echo "  Secret the RAZORPAY_WEBHOOK_SECRET value in your .env"
echo
echo "Then: npm run check:payments"
