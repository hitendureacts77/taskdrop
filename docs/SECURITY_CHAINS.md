# Chain review: what the small finds add up to

Task 2.18 part F, 6 November 2026. Each find alone was rated on its own. This page asks which two or three together reach someone's money, data or account, and rates the chain as what it adds up to.

**How this was done:** by reading the hole table and the code. No chain was run as an attack, so each one below is a reasoned path, not a proven one. Strix (2.16) and any outside tester get the same question, and can prove or break these.

**The finds looked at:** every Low and Medium that is open or waiting for your answer: H13, H27, H30, H31, H34, H37, H38, H45, H48, H49, H52, H55, H56, H64, H65, H68, H69, H70, B18, B21, B30 and B32, plus H14 (your deferred 2-step sign-in).

## Chains that add up to more

| # | The chain | What it reaches | Rated | What breaks it |
|---|---|---|---|---|
| 1 | H49 shows a number has an account → H31 a stolen SIM signs in → H30 a password is set with no old password → a new UPI ID is added and earnings are withdrawn at once | A helper's whole cleared balance, up to ₹1 lakh a withdrawal. The password also stays usable after they recover their SIM, until they change it | **Medium, High once money is real** | **New hole H77:** a new payout destination has no wait and no alert. Nothing in `request_withdrawal` looks at its age. Decision 31 |
| 2 | H14 no 2-step sign-in on your accounts → one stolen Gmail opens the tools → your rule of never replacing keys means a key that was seen stays good | Every server key, so the database and the money. This is the largest chain on the list | **High once money is real** | 2.1b, which you deferred. Claude reminds you once before Step 6. The emergency guide (`docs/KEY_RUNBOOK.md`) says how to replace each key, but under your rule it is for reading and practice only, so the rule needs an exception for a key known to be stolen, before real money. That is your decision |
| 3 | H38 a job's video keeps its location → it is open to every signed-in person while the job is open → H65 exact "last seen" | A poster's home location, and when they are likely to be there, before anyone is hired. This defeats the "area only" promise | **Medium** (each part is Medium or Low) | The real H38 fix (ffmpeg on the server). Rounding "last seen" (H65) makes it weaker |
| 4 | H27 both code folders are public → this plan names every open hole and how it works | Makes every other chain easier to find. It is not a way in by itself | **Raises the urgency of H27** | Your Make-private click. It costs one minute |
| 5 | H55 farming stars with a second account → H64 or a fresh account looks trustworthy → a real poster hires them → the exact address unlocks | A real person's home address, reached by a faked reputation | **Medium once real** | Real phone codes make second accounts cost money (5.9). The self-dealing alert catches the same account, payout details or app install, not a friend's phone. H55's "fix" or "accept" should be answered knowing this |

## Chains checked that do not add up

| The chain | Why it stops |
|---|---|
| H52 direct database door plus H47 skipping the posting cap | The cap is a database trigger, so the direct door hits it too. Other `api`-only checks can be skipped until 3.9, and production is built with the door shut |
| H52 plus H34 to change a wallet | No signed-in role can write to wallets, and every money column is refused by column rights and guard triggers. H34 is about proving the books, not an open way in |
| H48 plain-text codes plus H52 | Signed-in people get no row of `auth_codes`: row rules are on with no read rule. Only the server role can read it, and a code lives 10 minutes |
| H56 debug token plus bots | App Check is not refusing yet, so the token adds nothing today, and the SMS caps (H40) still hold. The token goes in 5.9 |
| H37 admin cookies plus a script on an admin page | The login cookies are HttpOnly since admin PR 46, and the content policy blocks injected scripts. The Google one-time cookie is short-lived |
| H49 plus H65 to link a number to a person | H49 says only that a number has an account, and not which profile |
| H69, H70, B18, B21, B30, B32, H13, H45, H64, H68 | Nothing in them reaches money, an account or private data, alone or together. H45 and H13 also leave `api` answers with part A |

## What changed because of this review

- **New hole H77** (chain 1), with **decision 31**.
- **H55** is now a Medium once money is real (chain 5).
- **H27** moves up: it is a one-minute click that weakens every chain here.
