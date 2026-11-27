# Own skills and categories (task 1.19 row E) — build spec

Agreed design: https://claude.ai/artifact/QWtGJoWmvoGsq97tuGXjSJ (v2). Owner answers: none given, so the defaults hold:
the small "My skill is something different" link stays (hidden when the match came from a phrase), and the top 12 show before "Show all".

## What the owner asked for
- ONE list of skills (and one of categories), ranked by use: skills by how many workers have them, categories by how many tasks use them. Most used first. No "Others" group and no "added by workers" label in the app.
- A worker (or poster, for categories) can add a missing one. It is shared with everyone and climbs the list as more people use it.
- If what they type is already covered ("Teaching maths" -> Tutoring), ask them to pick the existing one.
- Bad words, phone numbers, emails and links are refused. At most 10 new terms per person a day.
- Admin page "Skills & categories": the ranked list; rename, add phrase, merge into…, hide/unhide.

## Database (migration 226, `supabase/migrations/20261126180000_226_own_skills.sql`)
- `public.catalog_terms(id, kind 'skill'|'category', label, norm_key, source 'builtin'|'user', builtin_order, status 'live'|'hidden'|'merged', merged_into, created_by, created_at, updated_at, embedding vector(384))`
- `public.catalog_phrases(id, term_id, kind, phrase, norm_key)`: words that mean an existing term ("teaching maths" -> Tutoring).
- No direct table access; everything goes through these RPCs (all `security definer`):
  - `catalog_list(p_kind text) -> jsonb` array of `{id, label, uses, source}`, live only, ranked.
  - Service role only, called by the api for the signed-in caller (migration 228; 226's `catalog_check` / `catalog_add` are kept but no app role can run them):
    - `catalog_check_for(p_user uuid, p_kind text, p_text text, p_embedding text default null) -> jsonb`
    - `catalog_add_for(p_user uuid, p_kind text, p_text text, p_embedding text default null, p_force boolean default false) -> jsonb`
  - `p_embedding` is a pgvector literal string `'[0.01,-0.2,...]'` (384 numbers) or null, always computed by the api, never sent by the app.
  - The "same meaning" threshold is one row, `private.catalog_settings.min_meaning` (default 0.88). Tune it with `update private.catalog_settings set min_meaning = 0.9, updated_at = now();`
  - Result shape (check and add):
    - `{result:'exact', term:{id,label,uses}}`: it already exists, just pick it.
    - `{result:'covered', via:'phrase'|'spelling'|'meaning', term:{id,label,uses}, canForce:boolean}`: ask to pick `term`. `canForce` is false for `phrase`.
    - `{result:'refused', reason:'length'|'letters'|'contact'|'rude'|'hidden'}`
    - `{result:'new', label}` (check only): nothing covers it.
    - `{result:'added', term:{id,label,uses:0}}` (add only).
  - Daily cap: `catalog_add_for` raises `'catalog_daily_limit'` after 10 adds in 24 h.
  - Service role only: `catalog_embedding_todo(p_limit int) -> table(id uuid, text text)` and `catalog_set_embedding(p_id uuid, p_embedding text)`.
  - Staff only (`private.require_people_staff()`): `admin_catalog_list(p_kind)`, `admin_catalog_rename(p_id, p_label)`, `admin_catalog_merge(p_from, p_to)`, `admin_catalog_set_hidden(p_id, p_hidden boolean)`, `admin_catalog_add_phrase(p_id, p_phrase)`, `admin_catalog_remove_phrase(p_phrase_id)`.
  - `admin_catalog_list` row: `{id, label, status, source, uses, rank, created_by_name, created_at, phrases:[{id, phrase}], merged_labels:[text]}`. `rank` is null for rows that aren't live.
- A trigger registers skills typed by older app builds, so they are counted. Since 228 they are added `hidden` (they skipped the api's checks) until staff unhide them, and not at all past 10 new terms a day for that person. Merging or renaming rewrites `profiles.skills` and `tasks.category`.

## Api (group `catalog`)
- `catalog/listCatalog {kind}` (read) -> catalog_list
- `catalog/checkCatalogTerm {kind, text}` (read) -> embeds `text` with gte-small when available, then catalog_check_for. Adds `message` for refusals.
- `catalog/addCatalogTerm {kind, text, force?}` (write) -> same, then catalog_add_for. Turns `catalog_daily_limit` into "You can add up to 10 new skills or categories a day. Try again tomorrow."
- Refusal messages:
  - length: "Keep it between 2 and 30 letters."
  - letters: "Type the skill in English letters."
  - contact / rude: "A skill can't have a phone number, email, link or rude words. Type just the skill."
  - hidden: "That one can't be used. Pick another."
  - For categories, swap "skill" for "category".

## App
- `data/catalog.ts`: the three calls. The list is cached for 5 minutes. It falls back to the built-in lists (SKILL_OPTIONS / CATEGORIES) when the call fails, so guests and an old server still get a working picker.
- `components/SkillPicker.tsx` (skills, multi-select up to 8), used in Onboarding, ProfileEdit and WorkerSetup.
- Category picking (post form `CategoryPicker`, `ListingEditScreen`) uses the same ranked list and the same add / covered flow.
- Earn screens are royal blue and Hire screens are jade (use the theme's role colours, never hard-coded).
