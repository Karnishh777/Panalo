# When something goes wrong: the runbook

Short on purpose. Print it, or keep it where you'll find it at 2 a.m.

## A. Security incident

A leaked key or password, someone else in the database, a hacked account,
data showing up where it shouldn't, or the site defaced.

1. **Contain it (minutes).**
   - Rotate whatever leaked:
     - Supabase → Project Settings → API keys;
     - the database password;
     - Cloudflare / GitHub tokens;
     - the Brevo SMTP key.
   - Suspend affected accounts from the moderation page.
   - If the database itself is exposed, pause the project (Supabase →
     Project Settings → General → Pause).
2. **Report to CERT-In within 6 hours of noticing** (CERT-In Directions,
   28 April 2022). Email `incident@cert-in.org.in` with:
   - what happened and when you noticed;
   - what systems are affected (Supabase project, Cloudflare Pages site);
   - what you've done so far.

   Use the reporting form on cert-in.org.in if it asks for one. Late is
   better than never, and "still investigating" is an acceptable report.
3. **Tell the people affected without delay.** In plain words:
   - what happened;
   - what it means for them;
   - what you did;
   - what they should do (e.g. change their password).

   Email the addresses involved, and post a notice in the app if it's
   widespread.
4. **From 13 May 2027 (DPDP Rules r.7):** inform the Data Protection Board
   without delay, and send the full details **within 72 hours**:
   - the facts and timing;
   - the likely impact;
   - what you did;
   - what you'll change.
5. **Write it down** (date, what, who, what you did), and keep it with
   these notes.

## B. Illegal or harmful content

| What | Do | By when |
|---|---|---|
| Intimate or sexual images of someone, shared without consent | Remove the message (moderation page), suspend the sender | **24 hours** from the complaint (IT Rules r.3(2)(b)) |
| Anything sexual involving a minor (CSAM) | Remove, suspend **until lifted**, report at **cybercrime.gov.in** (and 1930). **Never download, screenshot or forward it.** | Immediately |
| Threats, someone at risk of harm | If urgent, tell the police (112) first. Then remove and suspend. | Immediately |
| Harassment, impersonation, hate | Review; remove and/or suspend | Acknowledge within 24 hours, resolve within 15 days |
| Court order or government notice | Act on it and record what you did | Within 36 hours (r.3(1)(d)) |
| Request for information from an authorised agency | Give what you hold. Message text is encrypted, so that's metadata and any evidence a reporter attached. | Within 72 hours (r.3(1)(j)) |

## C. Grievances

Complaints arrive at karnishh.education@gmail.com and on the moderation
page (marked *Data request*).

- Acknowledge within **24 hours**.
- Resolve within **15 days** (IT Rules); the DPDP outer limit is 90 days.

## D. A parent asks

- **"Delete my child's account":** they can do it themselves at
  `/students/#parent` (withdraw consent). If they can't, verify they're the
  parent on record, then delete it from the SQL Editor:
  ```sql
  select private.erase_account('<child user id>');
  ```
- **"What do you hold about my child":** the child can download it
  (Safety → Download my data), or you can export the rows for them.
