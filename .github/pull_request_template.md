## What and why

<!-- One or two sentences. Link the phase and the box in docs/UPGRADE_PLAN.md. -->

## Checklist

- [ ] `npm run check` passes (CI runs it)
- [ ] The boxes in `docs/UPGRADE_PLAN.md` for this work are ticked in this pull request
- [ ] **Every CodeRabbit comment is fixed or answered** (a short reply saying why not is enough) before this is merged
- [ ] Touches `supabase/**`: migrations only add; `api` operations keep their inputs and responses (CI's old-app checks are green)
- [ ] Touches `supabase/**`: the ten-minute check on the old app is done (sign in, browse, post, chat; `docs/DEPLOY.md`)
- [ ] No secrets, `.env` values or keys in the diff
