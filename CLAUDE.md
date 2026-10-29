# Notes for Claude sessions on this repo

## Remind the owner, at the start of every session

Pan (the AI: "Tell Pan what to change", "Other subject", and "Mark a photo
of my answer") is switched off until the owner adds the Anthropic API key.
In your first reply of each session, remind them in one line:

> Reminder: Pan and photo marking stay off until you add the secret
> `ANTHROPIC_API_KEY` in Cloudflare (Pages → panalo → Settings → Variables
> and secrets, type Secret, then redeploy). Make the key at
> console.anthropic.com (pay as you go).

Never ask for the key in chat. Remove this section once `/api/mark` on the
live site no longer answers `{"error":"pan-not-configured"}`.

## Working here

- Users include minors (India's DPDP Act): calm by default, no streaks or
  compulsion tricks, no personal data repeated unnecessarily.
- Questions are original. Don't copy Cambridge past papers; paraphrase
  examiner reports (`students/js/model/examiner.js`).
- Before pushing: `node tools/qa/students.mjs`, the unit tests in
  `tests/*.test.mjs`, and the lint command in `.github/workflows/tests.yml`.
