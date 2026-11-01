# Security alerts: what tells the owner, and how fast (plan task 2.10)

| Alarm | Where it is set | What triggers it | How it reaches you |
|---|---|---|---|
| **Security spike** | Sentry, project `taskdrop`, Monitors, Alerts, "Security spike (refused logins, App Check, bad signatures, SMS limits)" (created 1 Nov 2026) | An issue tagged `security_event` (kinds: `refused_login`, `app_check_failed`, `bad_signature`, `sms_budget_hit`) that has happened at least 10 times. At most one email an hour per issue | Email to the Sentry members |
| **Sign-in codes sent, few used** | Database (migration 132) and the `sms-pumping-watch` Inngest job, every 15 minutes | 20 or more codes sent today and fewer than one in five used | Admin **Alerts** page and the team bell |
| **Daily code limit** | `hit_sms_daily_cap` (migration 132) | 80% of today's limit used, and the limit reached | Admin **Alerts** page and the team bell |
| **Self-dealing** | Migration 133 | A poster and the chosen worker share a UPI id, a bank account or an app install | Admin **Alerts** page and the team bell |
| **Money mismatch** | `nightly-reconcile` Inngest job | The 02:30 money check finds a difference | Admin Alerts page, plus a fatal Sentry issue ("Money check found N difference(s)") that the Sentry rule for fatal issues emails |
| **Decoy key used** | Canarytokens ("AWS keys" token, note "TaskDrop decoy file"), file `C:\complete taskdrop\.env.production-old` | Anyone uses the fake key in that file | Email to hitendureacts@gmail.com |
| **Leaked key on GitHub** | GitHub secret scanning and gitleaks (`.github/workflows/secret-scan.yml`) | A key-shaped value in a commit | GitHub email, failed check |

What the server sends to Sentry (`captureSecurityEvent`, `supabase/functions/_shared/monitoring.ts`): counts only, never a phone number, name, address or token; at most 20 events per kind per instance per hour, so an attack cannot use up the Sentry quota. `sms_code_sent` is sent under its own tag (`sms_event`) and is judged by the database watch above, not by the spike alert.

**Still to do by hand (needs your decision):** a second Sentry rule for `fatal` issues if one is not already set, and a test that the spike email arrives (send 10 wrong codes to a staging number, wait for the next alert).
