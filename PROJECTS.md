# The Panalo family

**Panalo Chat** (this repository) is the general chat app: private, encrypted
chat for everyone, with no phone number needed. Friends, family, classmates,
the people you work with.

**Panalo Students** (`students/` in this repository) is the second one to be
built. It shares Panalo Chat's accounts, database and encryption, and takes
two ideas below with it: event rooms with a door and an end (from Rooms), and
circles that separate classes from friends (from Class). See `STUDENTS.md`.

The other ideas are **separate projects**, each with its own reason to exist.
They are not features to squeeze into Panalo Chat. Each would get its own
repository and site, and reuse what Panalo Chat already proves works: the
Supabase backend pattern, the encryption in `crypto.js`, the design system in
`css/`, and the QA harness in `tools/qa/`.

---

## Panalo Chat: what "for everyone" needs next

These are listed in order of how much they keep people coming back.

| # | Feature | Why everyone needs it | Size |
|---|---|---|---|
| 1 | **Notifications when the app is closed** (Web Push) | Without them people miss messages and drift back to WhatsApp. | M |
| 2 | **Invite links and QR codes** for chats and groups | "Tap to join" beats typing an exact username. This is how the app spreads. | S |
| 3 | **Voice messages** | Half the world talks instead of typing, especially parents and grandparents. | M |
| 4 | **Block and report** | Basic safety for an app anyone can join (needs a SQL migration). | M |
| 5 | **Reliable calls** (TURN relay) | Calls fail on some mobile networks without it. Paused, see `HOSTING.md`. | S |
| 6 | **Privacy policy and terms pages** | Needed before inviting strangers or listing in any store. | S |
| 7 | **Simple mode**: bigger text and fewer buttons | Makes the app work for older family members. Text size already exists. | S |
| 8 | **Languages**: Tamil and Hindi first | "For everyone" in India means more than English. | M |

---

## Separate projects

### Panalo Rooms: event chat without swapping numbers

- **Motive:** at an MUN, a fest, a hackathon, a trip or a workshop you meet
  dozens of strangers. Swapping personal numbers with all of them is awkward
  and unsafe.
- **Core:**
  - Join an event room by QR code, with just a username.
  - Organiser announcements, the schedule and polls.
  - A "keep in touch" button to add only the people you clicked with.
  - Rooms that end themselves after the event.
- **Why it can grow:** every event is a fresh group where nobody shares an
  app yet, so WhatsApp's head start doesn't matter. Organisers bring 50–500
  people at once.
- **First test:** one inter-school event.

### Panalo Class: school communication without personal numbers

- **Motive:** teachers shouldn't have to hand their personal number to every
  student and parent.
- **Core:**
  - Class spaces and a homework drop with deadline countdowns.
  - A doubt thread per topic and a notes shelf.
  - Teacher office hours: messages wait quietly outside them.
  - Parent broadcasts and moderation.
- **Why it can grow:** the buyer is the school. One yes brings hundreds of
  users, and schools can pay.
- **Watch out for:** slow decisions, and child-safety and data-protection rules.

### Panalo Yearbook: friendships that outlast school

- **Motive:** classes scatter after graduation and the group chat dies.
- **Core:**
  - A class memory wall of photos and voice notes.
  - Letters that open in 1 or 5 years.
  - Yearbook signature pages and a yearly reunion reminder.
- **Why it can grow:** it's emotional and shareable, and peaks every exam and
  graduation season.
- **Note:** this would also work as a part of Rooms or Class.

### Panalo Thinnai: families across generations and countries

- **Motive:** grandparents at home, cousins abroad, and fake forwards everywhere.
- **Core:**
  - A simple mode with big text and voice first.
  - Tamil↔English translation.
  - A "check this forward" warning on viral messages.
- **Watch out for:** families are WhatsApp's most loyal users. This is the
  hardest fight.

---

## Design ideas kept for later

These are from the *Panalo Redesign* canvas.

- **Kolam:** a new kolam every sunrise, the same for everyone. Read receipts
  are dots being joined, and typing is a line being drawn. It has a lot of
  soul, but in coffee browns it read as too traditional. A neon take (daily
  drop, a kolam per friend that grows with your streak) is a candidate
  signature for Panalo Chat or Yearbook.
- **Sky:** every friend is a star, brighter the more recently you talked.
  Tried, and it didn't land.
