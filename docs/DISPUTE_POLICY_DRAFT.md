# Dispute policy and safety rules: DRAFT for your approval (plan task 4.9)

Status: **approved 3 November 2026 with the default answers (A1, B 24 h and 3 working days, C as drafted, D no share button, E admin and finance), and built.** Original draft note: nothing was built on 2 November. Your rule is design before building: read this, change what you want, then say "approved". After that Claude builds the app and Terms changes on staging and sends the pull request. Then the policy goes to the lawyer (S.3). This draft makes no legal claim; every sentence about time limits and money outcomes waits for the lawyer's answer.

Everything under "How it works today" was read from the code on 2 November, so the policy never promises something the app cannot do.

## How it works today (facts from the code)

- **Who can report a problem:** the poster, or the worker who was hired. The app shows the button on a job once work is under way; the server accepts a report on any job that is not yet closed (finished, auto-finished or cancelled), and only one dispute can be open on a job. A report on a job nobody has paid for cannot be decided in either side's favour (staff get "nothing was paid"); this is an edge case to handle in the build.
- **What the reporter must do:** write what went wrong, at least 10 characters (the "Report a problem" button on the job).
- **What happens at once:** the job turns to *Disputed* and the money stays held. Nothing is paid out or refunded.
- **Who is told:** the owner and the staff with the admin or finance role get an alert.
- **What staff can see:** the job, both sides' offers, the chat, the proof of work, reviews, and the reporter's sentence.
- **What staff can decide:** exactly two outcomes. **Pay the worker** (the worker gets the price minus TaskDrop's commission, into earnings, waiting in the usual clearing period first) or **Refund the poster** (the job is cancelled and everything the poster paid, service fee included, goes back to their TaskDrop wallet). The decision is final in the app and is written to an audit trail with the staff member's name and note.
- **What is not built:** a split (part to each side), a deadline timer, an appeal, and a message to both sides when it is decided beyond the normal notification.

## Part 1. The dispute policy (text for the Support page, the Terms and the report screen)

> **If something goes wrong on a job**
>
> Tap **Report a problem** on the job. Tell us what went wrong in a sentence or two. The payment stays held while we look: nobody is paid and nobody is refunded until we decide.
>
> **What we look at.** The job post, the offers, the chat, the photos and files the worker sent as proof of work, and any reviews. Screenshots and photos you add to the chat count. Things said or paid outside TaskDrop cannot be checked, so we cannot rely on them.
>
> **Who decides.** Members of the TaskDrop team who handle disputes. They write down their reason, and the decision is recorded.
>
> **How fast.** We will acknowledge your report within **24 hours** and decide within **[3] working days** *(proposed; the lawyer confirms the number, S.3)*.
>
> **What the decision means.** Either the worker is paid (the price, less TaskDrop's commission) or the poster gets back everything they paid for the job, including the service fee, into their TaskDrop wallet. *(Open decision A below.)* The decision is final on TaskDrop. It does not take away any other legal right you have.
>
> **Please do not** report a job just because you changed your mind. Use cancel before work starts. If someone reports without a real reason, again and again, we may limit their account.

## Part 2. Tasks we do not allow

Shown as one short line at the last step of posting ("Not allowed: illegal things, weapons, medicines, adult content, handling cash for others. See all") with the full list in the Terms.

| Not allowed | Why |
|---|---|
| Anything illegal in India | The basic rule |
| Weapons, explosives, drugs and alcohol | Safety and law |
| Medicines that need a prescription, and medical treatment or advice offered as a task | Safety |
| Adult content or sexual services | Brand and law |
| Handling cash for others (collecting, holding, carrying or lending money), or lending bank or UPI access | Fraud and money-laundering risk |
| Fake or altered documents, exam cheating, fake reviews | Fraud |
| Work that puts anyone under 18 in a job, or asks a minor to do a task | The app is 18+ |
| Pressure, threats or harassment of any person | Safety |
| Collecting other people's personal data without their consent | Privacy |
| Anything meant to move the deal off TaskDrop (paying outside the app) | Protects the held-money promise |

*Added by Claude beyond your list (2 to 4 on the second half of the table): remove any you do not want.* A post that breaks these rules is hidden by staff (the existing "Hide this job" action) and the poster is told why.

## Part 3. Safety rules for in-person tasks

A short card, **shown once before a person's first in-person job** and kept on the Support page ("Staying safe on a job"):

1. Meet where other people can see you when you can. Tell someone you trust where you are going.
2. Do not share a sign-in code, a PIN, a bank password or your card details with anyone, ever. TaskDrop never asks for them.
3. Keep the chat and payment inside TaskDrop. Paying outside the app removes the protection.
4. If you feel unsafe, leave. Then tap **Report a problem** (or **Report** on the person) so we can act.

The **Report a problem** button already exists and already holds the payment. The new work is the wording, the first-job card and the Support page section.

## Where it appears

| Where | What |
|---|---|
| Support page | The policy (Part 1) and "Staying safe on a job" (Part 3) |
| Terms | A new short clause for the not-allowed list (Part 2); the existing dispute line is reworded (decision A) |
| The report screen | Subtitle: "We will look within 24 hours. The payment stays held until we decide." |
| Posting, last step | The one-line not-allowed reminder with a link |
| First in-person job | The 4-line safety card, shown once |

## Decisions I need from you

**A. All or nothing, or a split?** The Terms today say TaskDrop "decides how the held money is split", but the app can only give **everything to the worker** or **everything back to the poster**. Choose:
   1. **Recommended: keep all-or-nothing at launch.** It is already built and tested, and simple to explain. Claude rewords the Terms line to "decides who receives the held money". A real split can come later, after the first disputes show if it is needed.
   2. Build a split (a slider for staff, a new migration, new wording, new money tests). More work, and the money tests are the most sensitive in the app.

**B. The time limits.** Acknowledge in 24 hours and decide in 3 working days: keep them, or change them? The lawyer has the last word.

**C. The not-allowed list.** Remove or add anything.

**D. Sharing a job with a trusted contact.** Plan 4.9 mentions an option to share a job's details with someone you trust. On 1 November you rejected Safety Shield, Live Track and Start Code and said never to build them. This share option could sit too close to those. The draft therefore **leaves it out**. Say "include a plain share button" if you want one: it would only open the phone's own share sheet with the job title, the area name and the time, nothing tracked and nothing stored. Otherwise it stays out.

**E. Who decides.** Today only people with the admin or finance staff role can decide a dispute. Keep that, or add a separate "dispute" role? (Roles exist for support, finance and so on; a separate one is a small change.)
