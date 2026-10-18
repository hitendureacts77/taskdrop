# Pictures and files: ImageKit

Phase 6 of [UPGRADE_PLAN.md](UPGRADE_PLAN.md). **Pictures** are stored in ImageKit and shown through its CDN, at
the size each screen needs. **Videos and documents** stay in Supabase Storage. Every file, in either place, has
a row in the `media` table.

## How a picture travels

```
app            api (Edge Function)                         ImageKit              Postgres
 |  createUpload {purpose, kind:image, mime}                                          |
 |------------------>|  media_begin  ---------------------------------------------->  | pending row
 |<------------------|  signed upload token (30 min), folder, file name               |
 |  POST the file ----------------------------------------------------->| stored (private)
 |  attachMedia {id, fileId}                                                          |
 |------------------>|  GET file details ---------------------------->|              |
 |                   |  same path? private? a picture? under 15 MB?                   |
 |                   |  media_attach  ----------------------------------------------> | attached
 |<------------------|  { ref: "media:<id>" }                                         |
 |  save the ref on the task / profile / proof / chat message (the server checks it is yours)
 |  signMedia {paths:[ref], size:"card"}                                              |
 |------------------>|  media_resolve (may this person open it?) ------------------> |
 |<------------------|  signed CDN URL, valid 1 to 2 hours
```

* The **private key never leaves the server.** The app receives only the public key and a one-time token.
* The server chooses the folder and file name: `/<env>/u/<user id>/<media id>.<ext>`. The app cannot choose where a
  file goes, and `attachMedia` refuses any file that is not at exactly that path.
* Every picture is uploaded **private**, so ImageKit refuses an unsigned URL whatever the account settings say.
* A signed URL is rounded to the clock hour: everyone who asks within the same hour gets the same URL, so the app
  and the browser can keep the picture (expo-image caches it under the URL without its signature).
* Sizes: `thumb` 200, `card` 640, `full` 1600 pixels (fitted inside the box, never enlarged, automatic format).
  An older app sends no size and gets `full`.

## What a `media:<id>` may be used for

`createTask` (`media.path`), `updateProfile` (`avatarUrl`), `submitProof` (a file's `path`) and `sendMessage`
(`::media::media:<id>`) accept a reference only if it is the caller's own, finished upload, made for that purpose.
Anyone may open a reference that is attached to something they may see (an open task, their own work, a
profile photo, a chat they are in); `private.can_read_task_media` decides, and the answer is the same one the old
storage paths always got.

## Life of a file (`media.status`)

| Status | Meaning | Becomes |
|---|---|---|
| `pending` | upload token issued, file may not exist yet | `attached`, or `deleted` after 24 hours |
| `attached` | ImageKit confirmed the file | `hidden` (moderation) or `deleted` |
| `hidden` | nobody but an admin can open it | `attached` again, or `deleted` |
| `deleted` | to be removed from ImageKit | `purged_at` is set when it is gone |

The Inngest function **`media-purge`** (every 10 minutes) expires unfinished uploads and removes deleted pictures
from ImageKit in batches, with retries. **`account-files`** also marks a deleted account's pictures deleted, except
those a kept record still needs (the same rule as for storage files). Takedowns keep their meaning: a notice
detaches the file from the task or profile and the file stays, readable only by its owner and admins.

Videos and documents are recorded as `provider = 'supabase'`, `attached` from the start, and are still referred to by
their storage path.

## Setting it up (you)

1. **Rotate the private key.** If it was ever pasted into a chat, an issue or a commit, treat it as exposed:
   ImageKit dashboard, Developer options, API keys, create a new private key, delete the old one.
2. In the ImageKit dashboard: under Settings, Images, set "Restrict unsigned image URLs" to *Restrict all requests*
   (belt and braces; the files are private already). Check the account's maximum upload size is at least 15 MB.
3. Set the secrets (names only here; put the values in your own terminal):

   ```bash
   supabase secrets set IMAGEKIT_PUBLIC_KEY=... IMAGEKIT_PRIVATE_KEY=... IMAGEKIT_URL_ENDPOINT=https://ik.imagekit.io/<your id> IMAGEKIT_ENV=local
   ```

   `IMAGEKIT_ENV` is the top folder: `local`, `beta`, later `prod`. Never put these in `secrets.ts` (that file is for test
   keys only) or in an `EXPO_PUBLIC_` variable.
4. Apply migration `109_media_registry.sql`, then deploy the `api` and `inngest` functions, then run the Inngest sync.
   Apply the migration **first**: the new functions call `media_begin` and `media_resolve`.
5. Try it: post a task with a photo, open it from a second account, change the profile photo, send a chat photo.

Until step 3 is done nothing changes for anyone: without the keys, `createUpload` falls back to Supabase Storage
exactly as before, and `media-purge` waits. Old app builds keep uploading to Supabase and keep working.

## Limits, on purpose

* ImageKit's upload token is bound to a token and an expiry, **not** to a folder or file name. A person who tampers
  with the request can put a file anywhere in the account for 30 minutes, but it can never be attached to anything
  (the server checks the exact path), so it is only clutter. A bulk clean-up of stray files in ImageKit is a later job.
* A person can hold at most 100 unfinished uploads; uploads and attaches share the 20-a-minute upload limit.
* The server accepts JPEG, PNG, WebP, HEIC and HEIF, up to 15 MB. SVG is refused.

## Web security headers (CSP)

The user app has no `vercel.json` yet (Phase 3 item "`vercel.json`: SPA rewrites and security headers"). When its Content-Security-Policy
is written it must allow pictures and uploads:

```
img-src     'self' data: blob: https://ik.imagekit.io
connect-src 'self' https://upload.imagekit.io   (plus the Supabase and other hosts already needed)
```

## Still to check by hand

* iPhone: camera and library uploads, including a HEIC photo (the picker usually re-encodes to JPEG; confirm).
* Android: camera and gallery uploads; images load quickly on mobile data.
* Web: the file picker upload. **Drag and drop is not built.** Long lists still use a plain scroll view, not a virtualised
  list: both are follow-ups.
