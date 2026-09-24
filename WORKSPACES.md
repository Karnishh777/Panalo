# PANALO — Workspaces: key-distribution design

**Status: proposed, awaiting review. Nothing below is implemented yet.**

A workspace is a container above conversations: its own membership, invite
links, a member directory, and channels. This document exists because one part
of that is not a UI or RLS problem at all, and getting it wrong breaks the
feature no matter how clean everything else is.

---

## 1. The constraint

Every conversation has its own AES-256 key. The only copies are in
`conversation_keys`, each RSA-OAEP-wrapped to one member's public key. The
server stores those wrapped copies and **cannot produce a new one**: it never
has the key, so it cannot wrap it for anybody.

"Join a workspace, see its channels" therefore needs, for every existing
channel, **some device that already holds that channel's key** to wrap it to
the newcomer's public key. If no such device is online when you join, it cannot
happen yet. No RLS policy changes that, and no UI can hide it honestly.

## 2. Decision

**Queued wrap requests, fulfilled automatically by any online keyholder's
client. Until then the channel is visible but locked, and you cannot post in
it.**

| | Approach | Verdict |
|---|---|---|
| A | **Admin must be present.** Acceptance blocks until an admin approves, and the admin's client wraps. | Rejected. The wait still exists; it just moves to the admin. Admins also hold no key for channels they are not in. |
| B | **Queued wraps.** Joining opens one request per channel. Any member holding that channel's key fulfils it the next time their app is open. | **Chosen.** |
| C | **Key in the invite link.** The inviter encrypts the channel keys under a secret in the link's `#fragment`, and the server stores that ciphertext. Joining is instant. | Rejected. Anyone holding a database copy *plus any copy of the link* can decrypt every channel that existed when the link was made. Links end up in chat logs, email and link-preview caches, and old backups outlive revocation. That is a new way to lose a workspace's entire history. It would honour "the server never holds a key" in letter and break it in practice. |
| D | **Server escrow.** | Rejected outright. |

### 2.1 Who performs the wrap

**Any participant of channel C whose device holds C's key.** The key must also
have passed the commitment check in §2.5.

It is deliberately not limited to admins. Holding the key already means being
able to read all of C, so limiting couriers adds waiting time and no security.
Whether the newcomer *may* be in C is decided by the database, through the
invite RPC, membership triggers and the RLS fences in §5. The courier only acts
on requests the database says exist. A foreign key from each request to the
newcomer's participant row guarantees the request belongs to someone actually
in C.

The courier logic lives in a new client module, `src/keyshare.js`. It runs at
four trigger points:

1. **App start**, after the private key is unlocked and conversations are loaded.
2. **Realtime INSERT/UPDATE on `channel_key_requests`.** RLS delivers only
   requests in channels you are a member of. The handler is debounced and
   jittered so twenty online members don't all wrap at the same instant.
   Duplicates would be harmless anyway: every holder wraps the *same* key, and
   the insert is `ON CONFLICT DO NOTHING`.
3. **Connection resync**, through the existing `onResync` hook in
   `connection.js`. Requests made while the socket was down would otherwise be
   missed, and realtime does not replay them. That is the same silent loss
   `connection.js` was written to fix for messages.
4. **Opening a workspace.**

Before wrapping, the client checks three things: the requester is still a
participant, the requester has a `public_key`, and the key it is about to share
verified against the channel's commitment. It never shares a key it could not
verify.

### 2.2 The joiner's side

- **Redeeming an invite** adds you to the workspace and to every channel in it.
  A trigger then opens one request for each channel you have no key row for.
- **Joining needs an encryption key.** The redeem function refuses callers with
  no `public_key`, because nobody could ever wrap a key to them.
- **Until the key arrives**, the channel shows as locked, its history renders as
  locked placeholders, and the composer is disabled.
- **The unlock arrives** three ways: a realtime UPDATE on your own request
  (`fulfilled_at` set), a resync, or reopening the app. The key is then
  fetched, verified and cached, the open channel re-renders, and the search
  index re-indexes that channel.

The search index today stores the lock placeholder text permanently for any
message indexed before its key arrived. Its incremental catch-up only fetches
newer messages, so it never revisits them. That is fixed as part of this work,
because joiners would hit it every time.

### 2.3 When no keyholder is online

Concretely:

- **22:00:** Mira redeems an invite. The workspace's only other member, its
  creator, is offline until morning.
- **22:00 to 09:00:** Mira sees the workspace name, its channel list and the
  member directory, none of which are encrypted. Every channel is locked, and
  she cannot post in any of them.
- **09:00:** The creator opens Panalo. Their client fulfils Mira's requests
  within seconds. Her channels unlock live if she is online, or the next time
  she opens the app. She then sees the channels' full history, because a
  channel has one key and that key decrypts everything.

If **every member who held a channel's key has left**, nobody new can ever read
it. The lock screen counts the members who can currently unlock the channel, so
that case is stated plainly instead of promising "soon".

Draft copy:

> **Waiting for access to #general.** Messages here are encrypted on members'
> devices, and Panalo's server can't give you the key because it doesn't have
> one. #general unlocks automatically as soon as one of the *3 members* who can
> unlock it opens Panalo. You don't need to do anything.

> **Nobody who can unlock #general is still in it.** Its messages can't be read
> by anyone who joins now. A workspace admin can delete it and start a new
> channel.

**Sending while locked fails closed, twice.**

- **On the client**, a channel with no key never falls back to plaintext.
  Today's `sendMessage()` and `forwardMessage()` *do* fall back, for every
  conversation. See §8.
- **On the server**, a restrictive RLS policy rejects any message insert or
  edit in a workspace channel whose text is not ciphertext (`iv is null` with
  non-empty `content`), or whose attachment is not under `chat-files/enc/`.

### 2.4 Why the server still never holds a key

**What the server stores for a channel:**
- the same RSA-OAEP wrapped copies as any encrypted chat today, one per member;
- a SHA-256 commitment to the key (§2.5);
- request bookkeeping: who is waiting on which channel, and since when. That is
  metadata, like membership already is.

None of this lets the server derive a channel key.

**What the server decides, which is not new:** who is a member, and which
public key belongs to whom. A server, or anyone with write access to the
database, that inserted a fake member would have keyholders' clients wrap the
key to it automatically. Today the same holds one step removed: an admin
adding someone by username wraps to whatever public key the server returns.

Automation takes the human out of that loop. That is why every membership rule
below is enforced in the database rather than the client, and why Panalo still
must not be described as end-to-end encrypted (see `LIMITATIONS.md`).

### 2.5 Key commitment: stopping a member from handing a newcomer the wrong key

**The attack.** Couriers work because any channel member can insert a wrapped
key *for another member*, and the first row wins on the primary key. A
malicious member could race to give a newcomer a *different* key. The newcomer
would then post messages that only the attacker can read, and they would have
no way to tell.

**The defence.** At creation, the channel's creator stores:

    key_commitment = base64( SHA-256( "panalo/channel-key/v1:" || channel_id || ":" || raw_key ) )

A trigger makes it immutable afterwards. Every client verifies every channel
key it unwraps against the commitment and refuses a mismatch. The commitment
reveals nothing: the key is 256 random bits behind SHA-256.

**Self-healing.** A device holding a wrapped key that fails to unwrap or fails
the commitment deletes its own row, which the existing `conv_keys delete`
policy allows. A trigger then reopens its request, and a keyholder re-wraps.

**The guard.** A device deletes its row only after two checks:

1. its private key decrypts a value encrypted to its public key;
2. that public key is still the one currently published on its profile.

Without that guard, a device still holding an old key after the password was
reset on another device would keep deleting perfectly good rows.

A persistent attacker can repeat the race, but can only deny access that way,
not read anything they couldn't already.

### 2.6 Removal is enforced by the server, not by cryptography

A removed member loses read access through RLS. Their device may still hold
the channel key. Groups work the same way today. Rotating keys on removal needs
per-message key epochs, which is out of scope and will be written into
`LIMITATIONS.md`.

---

## 3. Roles: extending the phase-11 model, not duplicating it

**A channel is a conversation row with `type = 'group'` and a non-null
`workspace_id`.** Channel roles *are* `conversation_participants.role`. The
channel's creator is its owner. The phase-11 triggers that stamp, guard and
hand over roles (`stamp_creator_as_owner`, `guard_role_change`,
`promote_on_owner_leave`) apply to channels **unmodified**. No channel role is
stored anywhere else.

**Workspace roles** (`owner`, `admin`, `member`) live on `workspace_members`.
They govern the workspace itself and nothing that a channel role already
governs:

| Action | Who may do it |
|---|---|
| Rename the workspace | workspace owner or admin |
| Delete the workspace | workspace owner |
| Create or revoke invite links | workspace owner or admin |
| Remove someone from the workspace (and so from every channel in it) | workspace owner or admin; never an owner |
| Change workspace roles | workspace owner only; the last owner cannot demote themselves |
| Create a channel | any workspace member, who becomes its channel owner |
| Rename a channel, edit its bio or theme | channel owner or admin (phase 11), **or** workspace owner or admin |
| Remove a non-owner from a channel | channel owner or admin (phase 11), **or** workspace owner or admin |
| Delete a channel | channel owner, **or** workspace owner or admin |
| Change channel roles | channel owner only (phase 11, unchanged) |

**Does workspace admin imply channel admin?** A workspace owner or admin gets
channel-admin *powers* in every channel of their workspace, through additional
permissive policies. They are **not** written into
`conversation_participants.role`, and they do **not** get channel-*owner*
powers, so role changes stay with channel owners. The one lever above a
channel owner is removing them from the workspace, which removes them from
every channel.

When the last workspace owner leaves, ownership passes to the
longest-standing admin, or failing that the longest-standing member. That is
the same rule phase 11 applies to groups. When the last member leaves, the
workspace and its channels are deleted.

## 4. Member directory without reopening enumeration

Phase 10 scoped `profiles` reads to yourself and people you share a
conversation with. One new **permissive** policy adds people you share a
*workspace* with, through `private.shares_workspace_with(id)`.

It is an exact membership join. It is not a function you can call with a name,
pattern or list. `find_profile_by_username` is untouched: exact match, one
row, no wildcards.

The honest consequence, which will go in the copy and in `LIMITATIONS.md`:
**anyone holding a valid invite link can join and then see who else is in the
workspace.** An invite link is a key to the member list. Admins can revoke
links, and links expire.

## 5. Schema, RLS and triggers

Two migrations, each idempotent, each safe to run as one transaction, and each
ending with a verification SELECT that states its expected output.

### Phase 14: workspaces

**New tables:**
- **`workspaces`**: id, name, created_by, created_at.
- **`workspace_members`**: workspace_id, user_id, role, joined_at.
- **`workspace_invites`**: id, workspace_id, `token_hash`, created_by,
  expires_at, max_uses, use_count.
  - Only the SHA-256 of the token is stored, so a database leak yields no
    usable links.
  - Links look like `…/#join=<token>`. The token sits in the URL fragment,
    which browsers never send to Cloudflare, so it stays out of access logs
    and `Referer` headers.

**Helpers,** all in the non-exposed `private` schema, `SECURITY DEFINER`, with
an empty `search_path`:
- `is_workspace_member(ws)`
- `my_workspace_role(ws)`
- `shares_workspace_with(user)`
- `is_workspace_member_user(ws, user)`

**Joining** goes through `public.redeem_workspace_invite(token)`.
- It takes an exact token and can only ever add the caller, as a plain member.
- It locks the invite row and checks expiry and use count atomically.
- It refuses callers with no public key.
- **This is a fourth linter warning** of the "signed-in users can execute a
  SECURITY DEFINER function" kind. It cannot be otherwise: its whole purpose is
  to let a *non-member* in, which no RLS policy on a table they cannot see can
  express. See §9 for the alternative.

**Membership triggers** mirror phase 11 for the workspace level:
- the creator is stamped as owner;
- only owners may change roles;
- ownership is handed over when the last owner leaves;
- removal cascades out of every channel, taking the removed member's key rows
  with it;
- the workspace is deleted when it has no members left.

### Phase 15: channels

**`conversations`** gains two nullable columns:
- **`workspace_id`**, a foreign key with `on delete cascade`.
- **`key_commitment`**.

It also gains:
- a CHECK constraint that a row with a `workspace_id` is a `group` and has a
  commitment;
- a partial index on `workspace_id`;
- a BEFORE UPDATE trigger pinning both new columns. Without it, a group admin
  could move an existing group *into* a workspace, where workspace members
  could self-join it and have its key wrapped to them automatically.

**`channel_key_requests`**:
- **Keys:** `id` is a random uuid primary key, and `(conversation_id, user_id)`
  is unique with a foreign key to `conversation_participants`,
  `on delete cascade`.
- **Why a random primary key:** Supabase documents that realtime DELETE events
  bypass RLS and carry only the primary key. A composite key would broadcast
  who-joined-which-channel to every subscriber; a random id broadcasts nothing.
- **Who can read it:** channel members.
- **Who can write it:** nobody. It is maintained entirely by triggers:
  - participant inserted into a channel with no key row → open a request;
  - key row inserted → set `fulfilled_at`;
  - own key row deleted while still a participant → reopen the request.
- **Realtime:** added to the `supabase_realtime` publication.

**Policies:**

| Table | Command | Kind | Rule |
|---|---|---|---|
| `conversations` | insert | **restrictive** | `workspace_id` is null, **or** you are a member of that workspace. |
| `conversations` | update | permissive | Workspace owner or admin may update a workspace channel. |
| `conversations` | delete | permissive | Channel owner, or workspace owner or admin, may delete a workspace channel. Nothing else becomes deletable. |
| `conversation_participants` | insert | **restrictive** | For a channel, the person being added must be a member of its workspace. This fences the existing creator and admin add paths to the workspace boundary. |
| `conversation_participants` | insert | permissive | Self-join a channel of a workspace you belong to. |
| `conversation_participants` | delete | permissive | Workspace owner or admin removes a non-owner from a channel. |
| `conversation_keys` | insert | **restrictive** | For a channel, both the person inserting and the person the key is for must be current participants. |
| `conversation_keys` | select | permissive | Channel co-members can see channel key rows. See the note below the table. |
| `messages` | insert, update | **restrictive** | Channels accept ciphertext only (§2.3). |

**The `conversation_keys` select policy** is what lets the lock screen count
the members who can unlock a channel. It is harmless to reveal. Those rows are
RSA ciphertext under *other* members' public keys: useless to someone waiting
for the key, and nothing new to someone who already has it.

## 6. What does not change for direct chats and groups

- **Every new permissive policy** is conditioned on `workspace_id is not null`
  or on a workspace table. Permissive policies are OR'd together, so none can
  grant anything on a row whose `workspace_id` is null.
- **Every new restrictive policy** evaluates to `true` when `workspace_id` is
  null, so it can't take anything away from existing rows.
- **The new triggers on existing tables** (`conversations`,
  `conversation_participants`, `conversation_keys`) return immediately for
  non-workspace rows. The cost is one primary-key lookup.
- **The two new `conversations` columns** are nullable with no default.
  - No existing index, constraint or policy references them.
  - Existing `select *` and `conversations(*)` queries gain two null fields.
    `grep` confirms no client code copies a conversation row wholesale into a
    write.
- **No existing policy, function or trigger is dropped or rewritten.**
  `find_profile_by_username` and `delete_my_account` are untouched.

## 7. Plan and infrastructure

**Everything here is on the free plan:** tables, triggers, RLS, one RPC, and
realtime `postgres_changes` on one more table. There are no Edge Functions, no
paid features and no new infrastructure.

**One more realtime channel per client** is multiplexed over the existing
socket, so it doesn't count against the 200-connection cap.

## 8. Related pre-existing gaps found while designing this

- **`sendMessage()` and `forwardMessage()` fall back to plaintext** whenever
  the device has no conversation key, in every conversation type. Commit
  `577baf7` fixed one way to reach that state, a login that can't unwrap the
  private key. It did not fix this path.
  - **Still reachable in groups:** when the adding admin's device had no key,
    or when `addMember`'s wrap insert failed inside its silent `catch`.
  - **Channels:** fail closed, on both the client and the server.
  - **Groups:** unchanged here, since you asked for no behaviour change there.
    Recommended as a follow-up.
- **`conv_keys insert` (phase 5)** lets any member insert a wrapped key for
  *any* `user_id`, including people who are not yet members. That allows
  pre-poisoning a future member's row. Fenced for channels here; unchanged for
  groups.
- **The chat-info drawer says "Photos and files are not" encrypted.** They have
  been since encrypted attachments shipped, so the copy understates what is
  protected. It gets fixed alongside the channel copy.

## 9. Decisions for review

1. **Joining via `redeem_workspace_invite()`.** Recommended; takes the linter
   floor from 3 to 4, documented beside the other two exceptions.
   - **The alternative** is an insert into a table whose BEFORE trigger does
     the privileged work. It has the same security and exposes the same kind
     of endpoint, but the linter can't see it.
   - **That silences the warning without removing the endpoint.** Phase 13 was
     different: it removed the endpoints outright.
2. **Every workspace member is in every channel.** They are auto-joined on
   joining, and on channel creation. Members may leave a channel and rejoin it.
   There are no private channels in v1.
3. **Any workspace member may create channels.** Slack's default. The
   alternative is owners and admins only.
4. **Invite links default to 7 days, unlimited uses, and are revocable.**
   Creating them is limited to owners and admins.
5. **New members see a channel's full history once unlocked.** One key per
   channel makes anything else a key-rotation design.
