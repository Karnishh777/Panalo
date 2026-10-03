# Panalo Students and Indian law: where it stands

Checked on 2 October 2026 against the laws that apply to a free messaging and
study app run from India for students aged 13 and over. **This is an
engineering review, not legal advice.** Before promoting Panalo to schools or
large numbers of minors, have a lawyer confirm it.

Status: ✅ meets it · ⚠️ partly, or depends on you · ❌ doesn't yet

**Updated 3 October 2026 (phase 22):**
- parent or guardian consent for 13–17, enforced by the database;
- under-13s refused;
- registration details kept for 180 days after deletion;
- a published Grievance Officer contact;
- "Download my data";
- a yearly rules reminder;
- an incident runbook (INCIDENT.md).

---

## 1. The laws that apply

| Law | Applies because | In force |
|---|---|---|
| **Digital Personal Data Protection Act, 2023 (DPDP Act)** | Panalo collects personal data (email, username, messages, study data) of people in India, digitally. You are the *Data Fiduciary*. | Partly. The Act's main duties start with the Rules below. |
| **DPDP Rules, 2025** (notified 13 Nov 2025) | How the Act works in practice. | Rules 3 and 5–16 (notice, security, breach, children, rights) start **13 May 2027**. Rule 4 (consent managers) starts Nov 2026. |
| **IT Act, 2000 + IT (Intermediary Guidelines) Rules, 2021** | People send each other messages and files through Panalo, which makes it an *intermediary*. | **In force now.** |
| **CERT-In Directions, 28 April 2022** | Applies to intermediaries and service providers. | **In force now.** |
| **POCSO Act, 2012 / IT Act s.67B** | Any platform minors use can receive child sexual abuse material (CSAM). | In force now. |
| **Indian Contract Act / Majority Act** | People under 18 can't make a binding contract. | In force now. |

Panalo is far below the size of a *Significant Social Media Intermediary*
(5 million users in India), so those extra duties (an India-based compliance
officer, monthly reports) don't apply.

---

## 2. What's required, and what Panalo does

### IT Rules 2021: in force today

| Requirement | Panalo | |
|---|---|---|
| Publish a privacy policy, user agreement and rules telling users what they must not post (r.3(1)(a)–(b)) | `privacy.html`, `rules.html`. Sign-up requires agreeing to the rules. | ✅ |
| **Publish a Grievance Officer's name and contact details**; acknowledge complaints within 24 hours and resolve them within 15 days (r.3(2)(a)) | Privacy page → "Grievance Officer": an email address, the 24-hour and 15-day promises, and the in-app route. Data requests show an answer-by date on the moderation page. **The officer's name isn't published yet.** | ⚠️ Add a name (§4) |
| Remove intimate or sexual images of someone within 24 hours of a complaint (r.3(2)(b)) | Moderators can remove any reported message and suspend the sender (phase 20). | ⚠️ Possible, but only as fast as you check reports. Turn on email alerts by checking the moderation page daily. |
| Act on a court or government order within 36 hours; give information to authorised agencies within 72 hours (r.3(1)(d), (j)) | You can remove content and suspend accounts. Message text is encrypted, so you can only hand over metadata and the evidence reporters attached. | ⚠️ A process, not code: see §4 |
| **Keep registration information for 180 days after an account is deleted** (r.3(1)(h)) | Email, username and the join and leave dates go into a locked table, erased by a nightly job after 180 days. Everything else is deleted at once. The privacy page says so. | ✅ |
| Tell users once a year about the rules and the consequences of breaking them (r.3(1)(f)) | A reminder card appears once a year (synced to the account); the rules page now says what happens when they're broken. | ✅ |

### CERT-In Directions 2022: in force today

| Requirement | Panalo | |
|---|---|---|
| Report cyber-security incidents to CERT-In **within 6 hours** of noticing them | INCIDENT.md §A: who to email, what to say. | ✅ (a process; follow it) |
| **Keep ICT system logs for 180 days, in India** | Supabase's free plan keeps logs for about a day; Cloudflare's for a few days. The project's region is not India. | ❌ Not possible on the free plan. A paid plan with log drains, or a project in Mumbai (`ap-south-1`), would be needed. |

### DPDP Act + Rules: full force from 13 May 2027

| Requirement | Panalo | |
|---|---|---|
| A clear, standalone notice: each item of data, what it's for, how to withdraw consent and use your rights (s.5, r.3) | The privacy page itemises what is stored and who sees it. Sign-up now links to it. | ✅ Mostly. A "purpose" column could be added. |
| Consent that is free, specific and can be withdrawn as easily as given (s.6) | Withdrawing consent means deleting the account, which takes one button. | ✅ |
| Reasonable security safeguards: encryption, access control, logging, backups (s.8(5), r.6) | Messages are end-to-end-style encrypted on the device; row-level security on every table; bot protection; leaked-password check; encrypted weekly backups. **Access logs aren't kept for a year (r.6).** | ⚠️ Logs: same limit as CERT-In above |
| Tell affected users and the Data Protection Board about a breach; full details to the Board **within 72 hours** (s.8(6), r.7) | INCIDENT.md §A. | ✅ (a process) |
| Erase data when its purpose is served or the user withdraws consent (s.8(7)) | Full deletion of everything, including files and messages (phase 18). | ✅ (but see the 180-day IT Rules conflict) |
| Publish who can answer questions about personal data (r.9) | The Grievance Officer contact on the privacy page and in Safety. | ⚠️ Add a name |
| Rights to access, correct and erase data, and to a grievance answer **within 90 days** (s.11–13, r.14) | Erase ✅. Correct ✅. Access ✅: Safety → "Download my data" (everything the account holds, as JSON). Grievances ✅: in-app and by email, answered within 15 days. | ✅ |
| **Children (under 18): verifiable parental consent** before processing their data (s.9(1), r.10) | Everyone gives a month and year of birth (set once; only a moderator can change it). Under 13 is refused. For 13–17:<br>• the student names a parent, who is emailed a one-time code;<br>• the parent signs in with it (proving they control that address), reads the notice, gives name, relationship and year of birth (18+), ticks three declarations, and approves or declines;<br>• the decision is recorded;<br>• the database refuses to store anything for the student until then;<br>• the parent can withdraw later, which deletes the student's account. | ⚠️ **Strong, not the strongest.** Rule 10 also expects the parent's identity and age to be *reliably* verified, via details you already hold or a DigiLocker age token. An email code proves control of an inbox, not adulthood: a determined teenager with a second email address could approve themselves. DigiLocker needs registration as a requester (§4). |
| No tracking, behavioural monitoring or targeted advertising directed at children (s.9(3)) | No ads, no analytics, no third-party trackers, no profiling. The "world" is drawn from the person's own study data, shown only to them. | ✅ Arguably. A lawyer should confirm that a self-view of your own activity isn't "behavioural monitoring". |
| Nothing likely to harm a child's well-being (s.9(2)) | No feed, no streaks, no public profiles, no stranger discovery; blocking, reporting and moderation exist. | ✅ |

Penalties under the Act's Schedule: up to ₹250 crore for failing to protect
data, and up to **₹200 crore for breaking the children's rules**. The
Data Protection Board scales them to the size of the business, but the
exposure is real.

---

## 3. Decisions only you can make

**A. Users aged 13–17. DONE, except DigiLocker.** The email-based parent
consent flow is built and enforced (above). What's left for full Rule 10
strength is a DigiLocker age token for the parent, which needs Panalo to
register as a DigiLocker requester (a registered organisation; see
partners.digitallocker.gov.in). The options below were the original choices.

*Original note:*
From 13 May 2027, anyone under 18 needs a parent's *verifiable* consent: a
check that the person consenting is an identifiable adult, through details
you already hold or a DigiLocker age token. Panalo has neither. The options:

1. **Make Panalo 18+ in India** before May 2027. This is the simplest. It
   loses school students, who are part of the audience.
2. **Add a parent-consent flow.** The student enters a parent's email; the
   parent verifies with a DigiLocker age token and approves; the account
   stays limited until then. This is a sizeable feature, and DigiLocker
   integration needs registration as a requesting entity.
3. **Partner with schools.** Educational institutions have some exemptions
   in the Rules' Fourth Schedule, but only for safety purposes such as
   location tracking, not for a general app. Unlikely to cover Panalo.

Until May 2027 nothing changes legally, but sign-ups made before then don't
become compliant on their own.

**B. Keep registration details for 180 days after deletion (IT Rules
3(1)(h)). DONE (phase 22).** You asked for deletion to remove *everything*. The IT Rules
require intermediaries to keep the information collected at registration
(here: email, username, sign-up date) for 180 days after an account is
cancelled. DPDP s.8(7) allows exactly this kind of retention when a law
requires it. The compliant version: when someone deletes their account,
keep only `{email, username, registered, deleted}` in a locked table that
nobody can read through the app, erased automatically after 180 days.
Everything else still goes at once. This is a small change to the database,
but it changes what the privacy page promises, so it's your call.

---

## 4. What to do, in order

1. **Add the Grievance Officer's name** next to the published email
   (privacy page → Grievance Officer).
2. ✅ 180-day retention: built.
3. ✅ Under-18s: parent consent built. **DigiLocker** remains for full strength.
4. ✅ **Two one-page processes:** written in INCIDENT.md.
   - *Security incident:* who notices, report to CERT-In within 6 hours
     (incident@cert-in.org.in), tell affected users, tell the Data
     Protection Board within 72 hours (from May 2027).
   - *Content emergencies:* intimate images or CSAM reported → remove
     within 24 hours, suspend the account, report CSAM at
     cybercrime.gov.in. Never download or forward it.
5. **Check the moderation page daily** (you're the moderator; it shows how
   many reports are waiting).
6. ✅ Yearly rules reminder.
7. ✅ "Download my data".
8. **Logs for 180 days in India** (CERT-In). Not possible on free plans;
   revisit when you move to paid hosting.

---

## 5. Elsewhere

- **EU/UK users (GDPR):** similar rights, plus a lawful basis and a
  named controller. The same contact and export features cover most of it.
- **US users under 13 (COPPA):** Panalo doesn't accept under-13s, so it
  doesn't apply as long as that stays true.

## Sources

- DPDP Rules 2025: [Rule 10 text and commencement](https://dpdprules.org/rules/10) ·
  [overview of timelines and duties](https://www.privacyglobal.org/blog/dpdp-rules-need-to-know) ·
  [Rule 7 breach intimation](https://dpdprules.org/rules/7) ·
  [Rule 9 contact information](https://www.dpdpa.com/dpdparules/rule9.html) ·
  [Rule 14 rights and grievances](https://www.dpdpa.com/dpdparules/rule14.html) ·
  [Fourth Schedule exemptions](https://dpdprules.org/rules/fourth-schedule)
- DPDP Act s.9 and penalties: [Section 9](https://www.dpdpa.com/dpdpa2023/chapter-2/section9.html) ·
  [penalties](https://dpdpcomply.com/blog/dpdp-act-penalties-explained)
- IT Rules 2021: [Rule 3 text](https://indiankanoon.org/doc/125230782/) ·
  [grievance officer duties](https://saferinternetindia.com/grievance-officers/)
- CERT-In Directions 2022: [summary](https://trilegal.com/wp-content/uploads/2022/05/2022-CERT-In-Directions-on-Reporting-Cyber-Incidents-1.pdf)
