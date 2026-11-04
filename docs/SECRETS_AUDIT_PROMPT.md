# The secrets audit prompt (task 2.15)

Saved word for word from the owner's message of 4 November 2026. When the owner says "start 2.15", Claude follows the prompt below, in both code folders. The plan's summary of it is task 2.15 in `docs/ULTIMATE_PLAN.md`.

## Notes for TaskDrop

These notes only fit the prompt to this project. Where they seem to differ, the stricter rule wins.

- Run it in both code folders: `taskdrop` (the app, website and server functions) and `taskdrop-admin` (the admin website).
- On Windows there is no `/tmp`. Write the reports to the session's temporary folder, outside both code folders, as `betterleaks-<folder>-current.json` and `betterleaks-<folder>-history.json`.
- Newer Betterleaks versions name the files scan `filesystem` (short `fs`); `dir` may be an older name. Use the name the installed version shows in `betterleaks --help`, always with `--redact`.
- Never use `-v` / `--validate` or `-a` / `--analyze`. In Betterleaks they send a found key to its provider to test it.
- The names that reach the browser here start with `EXPO_PUBLIC_` (the app and the website, built with Expo) and `NEXT_PUBLIC_` (the admin, built with Next.js).
- The secrets file `.env.all-secrets` sits at the top of the `Taskdrop user` folder and must be ignored by Git. Check that it is ignored and that only server stores use its values. Never show a value from it.
- The owner's own rules also apply: a key is never replaced without the owner's yes, key by key; secrets live only in `.env.all-secrets` and the server-side stores. The prompt's "do not commit or push" covers the audit itself. After the owner has read the report, fixes go through the usual pull request into `redesigned-2.0` (plan rule 6).
- A new real problem is added to the Security section of the plan as a hole, from H30 onwards.

## The prompt

We are going to perform a secrets security audit of this application using Betterleaks.

Your job is to guide me through the process, run the scans, analyze the findings in the context of how this application actually works, and help remediate confirmed security problems safely.

A Betterleaks finding is NOT automatically a security vulnerability. Your job is to determine whether a detected credential is actually exposed, improperly stored, historical, intentionally public, safely stored, or a false positive.

### Important safety rules

* Never display, repeat, or expose the full value of any secret, API key, password, token, private key, or credential you discover.
* Always use Betterleaks redaction.
* Do not use Betterleaks live credential validation or any option that sends discovered credentials to external services.
* Do not automatically revoke, rotate, disable, or otherwise modify credentials with an external provider.
* Do not rewrite Git history.
* Do not commit or push anything.
* Do not modify application code until after you have completed the scans, analyzed the findings, and explained the recommended remediation to me.
* Do not create security findings, GitHub Issues, PR comments, pull-request comments, Security-tab entries, or other records in the remote repository.
* Do not treat the mere presence of a secret in a local file as proof that it has been exposed.
* Do not assume a value is safe merely because it is referenced through an environment variable. Determine whether that environment variable can be included in browser/client code.
* Do not assume every key is secret. Some services intentionally use public, anonymous, publishable, or client-side keys. Determine the purpose and privilege level of the detected value whenever possible without exposing it.

### Step 1: Check the environment and application architecture

First:

1. Confirm that the current directory is the root of the application repository.
2. Confirm that it is a Git repository.
3. Determine whether full Git history is available or whether this is a shallow/incomplete clone.
4. Check whether Betterleaks is installed.
5. If Betterleaks is not installed, identify the appropriate installation method for this computer and install it.
6. Confirm the installed Betterleaks version.
7. Identify the major application architecture relevant to secrets handling, including:
   * frontend framework
   * backend/server components
   * serverless or edge functions
   * database/backend provider such as Supabase
   * deployment/hosting configuration visible in the repository
   * environment-variable conventions used by the framework
8. Identify which directories/files are browser/client-side code and which are server-only code.
9. Inspect `.gitignore` and other relevant ignore/config files to understand how local environment and credential files are handled.
10. Determine whether the repository appears to be private or public if this can be established safely from available local information. If it cannot be determined, record repository visibility as UNKNOWN and continue.

Pay special attention to framework conventions that intentionally expose environment variables to browser code, such as prefixes like `VITE_`, `NEXT_PUBLIC_`, or `REACT_APP_`. These are examples, not an exhaustive list.

If full Git history is unavailable, explain that before running the history scan and tell me what is needed to obtain it.

Do not change application code during this step.

### Step 2: Scan the current application

Run a Betterleaks scan of the current files using redaction.

Create the machine-readable report outside the repository so it cannot accidentally be committed.

Use a command equivalent to:

```
betterleaks dir . --redact --report-path /tmp/betterleaks-current.json --report-format json
```

Do not use live validation.

This scan should inspect the current filesystem state, including relevant untracked files that Betterleaks normally scans.

IMPORTANT:

A secret found by the directory scan may exist in a legitimate local file such as `.env` that is properly excluded from Git and used only by server-side code.

Do NOT automatically classify such a finding as an exposure.

The directory scan answers:

"What sensitive values currently exist in or around this working copy?"

It does NOT by itself answer:

"Which of these values are publicly exposed?"

### Step 3: Scan the complete Git history

Run a separate Betterleaks scan against the repository's Git history, again using redaction.

Write this to a DIFFERENT report file:

```
betterleaks git . --redact --report-path /tmp/betterleaks-history.json --report-format json
```

Do not use live validation.

Betterleaks treats current-directory scanning and Git-history scanning as separate scan types, so both are required.

The Git-history scan answers:

"What sensitive values have previously been committed to this repository?"

A credential committed to a private repository is not automatically publicly exposed, but committing a real secret still increases its exposure surface and may justify rotation depending on the credential, repository access, history, privilege level, and other circumstances.

### Step 4: Analyze and classify the findings

Read both JSON reports.

Deduplicate findings that represent the same underlying credential or problem.

Do not reveal the actual secret value.

For every unique finding, first classify WHERE it exists:

* CURRENT ONLY: present in the current filesystem but not found in Git history
* HISTORICAL ONLY: found in Git history but not present in the current application
* CURRENT + HISTORICAL: present now and also committed previously

Then classify WHAT the finding appears to be:

* REAL SECRET / CREDENTIAL
* INTENTIONALLY PUBLIC OR PUBLISHABLE KEY
* TEST / SAMPLE / PLACEHOLDER
* FALSE POSITIVE
* UNKNOWN / NEEDS REVIEW

Then determine its SECURITY EXPOSURE.

Use these categories:

**CONFIRMED OR HIGHLY LIKELY EXPOSED**

Use when there is strong evidence that a privileged credential is delivered to or accessible from an untrusted/public context, for example:

* hardcoded in browser/client-side source
* referenced by an environment variable that the framework exposes to the browser
* included in generated frontend configuration
* stored in another clearly public location
* otherwise made available to application users who should not possess it

**POTENTIALLY EXPOSED / MISMANAGED**

Use when a real privileged credential is handled insecurely but actual public exposure cannot be proven from the repository alone, for example:

* hardcoded in server-side source
* committed to Git history
* stored in an inappropriate tracked configuration file
* accessible to more repository users or systems than necessary

**SAFELY STORED / EXPECTED**

Use when a real credential appears to be handled appropriately, for example:

* present only in a local `.env` or equivalent secrets file
* that file is appropriately excluded from Git
* the credential is consumed only by server-side code
* there is no evidence from this repository that the value is delivered to the browser or committed to history

Do not recommend moving an already appropriately stored secret simply because Betterleaks detected it.

**INTENTIONALLY PUBLIC**

Use when the value appears designed by its provider to be public/client-side, such as certain publishable, anonymous, or browser keys.

Do not classify a key as safe solely because its name sounds public. Consider the provider and privilege level.

For example, distinguish where possible between concepts such as a publishable/client key and a privileged/server/service-role key.

**HISTORICAL AND NO LONGER ACTIVE**

Use when there is evidence available to us that the historical credential has already been revoked, rotated, replaced, or is otherwise no longer usable.

Do not assume this merely because a different value exists today. If its status cannot be established without contacting the provider, mark it UNKNOWN.

**FALSE POSITIVE / EXAMPLE**

Use when the value clearly appears to be non-sensitive sample, placeholder, test, generated, or unrelated data.

**NEEDS REVIEW**

Use when there is not enough evidence to make a reliable classification.

### Step 5: Evaluate runtime exposure

For each meaningful CURRENT finding, trace how the application uses it.

Determine:

1. Is the value used by frontend/browser code or server-only code?
2. If accessed through an environment variable, does the framework make that variable available to the browser?
3. Is the file containing it tracked by Git?
4. Is the file appropriately ignored?
5. Is the value embedded into generated frontend configuration or build output based on the source/configuration you can inspect?
6. Does the credential appear to have elevated privileges?
7. Is it merely an identifier or intentionally public/publishable key?
8. Could an unauthenticated visitor to the published app reasonably receive the value based on the code/build architecture?
9. Could an authenticated but untrusted application user reasonably receive it?
10. Is there evidence of a safer server-side path already available?

Do not claim that a value is visible in the deployed production application unless you have evidence supporting that conclusion.

If the repository alone cannot establish whether a credential reaches production/browser output, say:

"Runtime exposure could not be confirmed from the repository alone."

Do not silently turn uncertainty into a vulnerability.

### Step 6: Present each meaningful finding

The person reading this report may not be technical. Findings must be extremely concise, plain-English, and action-oriented.

Do all necessary technical analysis internally, but do NOT include that analysis unless I ask for more detail.

For each actionable finding, use this exact format:

```
[SEVERITY] Short plain-English title
What happened: One sentence, maximum 25 words.
Why it matters: One sentence explaining the realistic risk in everyday language, maximum 30 words.
What to do: One sentence describing the recommended action, maximum 30 words.
Status: FIX NOW / FIX SOON / REVIEW / NO ACTION
```

Do not include CVSS explanations, scanner-rule descriptions, long technical background, attack theory, generic security advice, or lengthy remediation instructions in the initial report.

Avoid unexplained security jargon. If a technical term is necessary, immediately explain it in ordinary language.

For example, prefer:

"Someone logged into the app may be able to see another customer's records."

Instead of:

"The endpoint appears vulnerable to an IDOR/BOLA authorization vulnerability caused by insufficient object-level authorization controls."

Do not report safely stored credentials, intentionally public keys, duplicate findings, or obvious false positives as vulnerabilities.

Put those only in a single short section titled:

**Non-actionable detections**

Summarize them by count unless there is a specific reason I need to know about one.

If I ask for "details" about a finding, then provide the technical evidence, affected files/lines, scanner information, reasoning, and detailed remediation for that specific finding.
