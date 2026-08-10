# bb-video-system — LANDMINES

Permanent register of defects found in this system, their root cause, and the
block that stops them coming back. Prefix `L-VID-`.

System: `~/bb-video-system/index.html` (single file, 4,529 lines)
Live: https://businessboosterlk.github.io/bb-video-system/
Supabase: yyviiwnqgphyklcoijyd (Tokyo) · accent `#a855f7`

This system hosts the **BB Sentinel watchdog** (index.html line 4057 onward), the
cross-system error log that writes to `system_bug_log` for all five systems.
Breaking the Sentinel blinds every other system. Treat that block as load-bearing.

---

## L-VID-001 — the boot query pulls 9.6 MB of base64 images on every load

**Status:** FIXED 2026-08-10. Measured in a browser: **12,344,682 bytes down to
36,300**, a 340x reduction, 99.71 per cent. Per open tab per hour: 235 MB to 0.7 MB.
It had grown from 10.1 MB to 11.8 MB during the single day it took to fix, because
people kept attaching images, which is the whole argument for compressing on upload.

The fix: no list query selects `image_url`; a 215-byte companion query says which
rows carry one; images load only when they scroll on screen and cache for the
session; uploads are downscaled to 1400px JPEG q0.82 before storage; inserts ask
for `id` back so the response cannot echo the base64.

**Observed, measured against the live database on 2026-07-30:**

| Query | Bytes on the wire | Rows |
|---|---|---|
| `video_project_comments?select=*` (what runs today, line 1165) | **10,102,697** | 169 |
| `select=id,video_project_id,body,author,created_at,is_done` | 30,687 | 169 |
| `select=id&image_url=not.is.null` (companion) | 215 | 16 |

9,833 kB of that payload is base64 text in `image_url`, from **16 images across
169 comments**. The largest single image is 1,691 kB. Every other table loaded at
boot totals roughly 178 kB combined.

So **97.5 per cent of the boot payload is 16 images**, and the row count is
identical either way. Nothing is lost by excluding the column.

**Root cause.** Three compounding faults, the same shape as the confirmed Graphic
System defect in `bb-base64-image-perf-landmine`:

1. `fetchAll()` line 1165 does `select('*')` on `video_project_comments` with no
   limit and no date filter. Line 1161 does the same on `video_chat_messages`
   (0 rows today, so latent, not yet biting).
2. `readImageFile()` line ~907 does a raw `FileReader.readAsDataURL` with **no
   compression at all**, capped only at 3 MB per file. Base64 inflates by about a
   third, so a 3 MB upload lands as roughly 4 MB of text in Postgres.
3. Line 1090 re-runs the whole of `fetchAll` on a timer, `REFRESH_MS = 180000`
   (3 minutes). That is ~20 boot payloads an hour, so **roughly 197 MB per open
   tab per hour** at today's data size.

**The tell that this was already hurting.** The comment on line 686 reads
`// 3 min (was 20s — that burned the DB bandwidth quota)`. The bandwidth quota was
already blown once. The fix applied then slowed the poll, which treated the
symptom. The 10 MB payload behind it was never touched, and it grows with every
image anyone attaches.

**Why it is not just a bandwidth bill.** `image_url` is genuinely rendered, but
only on the Team Chat page (line 2886), and only for **one client at a time**. The
app downloads every image belonging to every client to render a page the user may
never open.

**The permanent block:**
- Never `select('*')` on `video_project_comments` or `video_chat_messages`. List
  queries name their columns explicitly and omit `image_url`.
- Fetch images on demand for the rows actually on screen, never up front.
- Compress on upload before the data URI is ever built: canvas downscale to max
  1400px, JPEG q0.82. The proven Graphic System numbers were 9.3 MB down to 86 kB.
- Any new `select('*')` added to this file must be checked against the column list
  of the table it hits. Sixteen `select('*')` calls exist; the ones that matter are
  the ones touching a table with an image column.

**Tables in this system that hold base64 today:** `video_project_comments.image_url`
and `video_chat_messages.image_url`. `video_inspo.thumbnail` is a typed URL, not
base64 (0 rows, verified). No other table in this system has an image column.

**Not fixed by this entry:** the 16 existing oversized images are live client data
and stay untouched until Thulaib says otherwise. The long-term fix is a Supabase
Storage bucket, which is an infrastructure change needing approval.

---

## L-VID-003 — four screens, four different opinions about "which month"

**Status:** FIXED in the working copy 2026-08-10, awaiting Thulaib's go to deploy.

**Reported by Thulaib:** move a video to Add to Drive, the Pipeline counts it,
the Clients page for that month still reads zero.

**Observed, measured against live data.** BS WITH LEON, May 2026:

| Rule | Where it lived | Reported |
|---|---|---|
| Tagged month, live projects only | Pipeline summary, line 1536 + 1566 | 4 |
| Tagged month, archived included | Quarterly plan, line 2524 | 15 |
| Calendar month the editor finished in | **Clients page, line 2431** | **0** |
| Every add_to_drive ever, no month at all | Client drill-in, line 2719 | all |

**Root cause.** The four May videos are tagged `target_month=5` but carry
`completed_at = 2026-06-24`. The Clients page asked "what was finished between
1 May and 31 May", got nothing, and printed 0. Any video delivered even one day
late lands in the wrong month, so this broke every month for every client. The
pristine file reported **0 videos delivered in May across all 23 clients**.

Two faults rode along in the same code:
- `videoTarget()` always read the **current** month, so picking May moved the
  numerator and left the denominator on today's month.
- The Pipeline month filter matched `target_month` and ignored `target_year`, so
  May 2026 silently merged with May of any other year.

**The permanent block.** One rule, one function, installed just below
`COMPLETED_STAGES`:
- `inTargetMonth(p,year,month)` decides which month a video belongs to.
- `monthDelivery(clientId,year,month)` is the ONLY way to answer "how many did
  we deliver". Every surface calls it. Never re-implement the filter inline.
- A video belongs to the month it was **tagged** for, never the date it was
  finished.
- **Archived videos count.** Archiving clears the board, it does not undo a
  delivery, and a month's number must not move because someone tidied up.
- Month pickers carry the year (`YYYY-MM`) on both screens, so a month can never
  be matched without its year.

**Verified:** 8 assertions against live rows, both screens now agree at 15 for
Leon May, the live-only subset still equals the 4 cards on the board, May 2025
stays isolated from May 2026, and the target follows the selected month.

**This fix exposes a data problem it does not solve.** Counting honestly makes
three clients read over contract for May: BS WITH LEON 15/8, LGL 14/6, GUIDING
STEPS COLLEGE 5/4. That is the data, not the arithmetic. Across the table:
- **35** duplicate title groups (APR VID 1 exists twice, APR VID 10 twice, more)
- **42** projects whose title month disagrees with the tagged month, 27 of them
  titled "APR VID..." but tagged May
- **5** projects with no month tagged at all
- **25** archived projects still sitting on the retired `sent_to_client` stage,
  which no rule counts as delivered

Rather than hide it, the fix flags it: an over-contract row shows an "over" chip
explaining the likely cause, and the Pipeline summary prints a line naming how
many clients are above contract. **No data has been changed.** The cleanup list
is Thulaib's to review.

---

## L-VID-004 — "In editing now" counted 48 videos nobody was editing

**Status:** FIXED 2026-08-10, same ship as L-VID-003.

**Observed.** The Weekly Plan master summary showed "In editing now: 53". The code
(line 3139) counted every live project whose stage was not `add_to_drive`. The
real breakdown of those 53:

| Stage | Count | Who is actually holding it |
|---|---|---|
| client_review | 24 | the client |
| video_head_review | 10 | Ushane |
| team_review | 8 | the team |
| client_changes | 6 | the client |
| changes | 2 | an editor |
| **editing** | **2** | **an editor** |
| video_shot | 1 | nobody yet |

So **2 of 53** were at the Editing stage and 48 were parked with reviewers or
clients. A head of department reading that box would think the editors had 53
videos on their plates.

**Second fault, same screen.** The topic bank box lumped all `status='shot'`
topics into "Shot and ready to edit". Footage that Ushane still has to cut was
counted as ready for an editor, so the cutting queue was invisible. Ushane's
cutting work was only visible as free text typed into the weekly grid cells
("CUT & GRADE CCT (6)").

**The fix.** Four boxes that map to who is holding the ball, not to stage names:
- ✂️ **Needs cutting** = topic bank `status='shot'`. Ushane's queue.
- 🎞️ **Cut, ready to edit** = topic bank `status='cut'` (new state).
- 📋 **In our hands** = projects at video_shot, cutting_color_grading, rendering,
  editing, changes.
- ⏳ **Waiting on others** = projects at video_head_review, team_review,
  coo_check, client_review, client_changes.

The topic status cycle became `planned -> shot -> cut -> edited -> planned`.
`video_topics.status` is plain `text` with no CHECK constraint, verified, so the
new state needed **no schema change**.

**The permanent block.** A count is only honest if its label names who is doing
the work. Never write a box that means "not finished" and label it with the name
of one stage. When adding a summary tile, list the stages it includes in a
comment next to the constant, as `BB_HANDS` and `WAITING` now do.

**Reconciliation check that must keep holding:** `In our hands + Waiting on
others` must equal the old "not on drive" number. Verified live: 5 + 48 = 53.

---

## L-VID-005 — I shipped emoji as icons, against a documented rule

**Status:** FIXED 2026-08-10 for everything on the Weekly Plan. Open elsewhere.

Thulaib: "I HAVE SAID DONT USE EMOJIS USE VECTOR CLASSY ICONS". He had. The rule is
`bb-anti-ai-tells` rule 2, "Emoji as icons or bullets", and it is repeated twice in
`bb-web-learnings.md`. I used emoji anyway.

**The cause is worth more than the fix: I copied the surrounding code instead of
checking the rule.** The boxes I was replacing already used emoji, so matching them
felt like consistency. Matching existing code is not a defence when the existing
code is what the rule was written to stop. This file carries ~60 distinct emoji and
26 inline SVGs, so both patterns were present and I picked the wrong one.

Fixed with one stroke set (`VICON`/`vicon()`, `currentColor`, `stroke-width:1.7`,
matching the nav icons already in the file): the four summary boxes, the topic
status chips, and the weekly grid status pills. Verified 18 icons rendering and
**zero emoji** left in the Weekly Plan page text.

**Still open:** the rest of the system. Roughly 60 distinct emoji remain across
other pages. That is a separate sweep, not a side effect of a payload fix.

**The permanent block:** before reusing a visual pattern found in the file, check it
against the rule. An existing pattern is evidence of what was done, never of what is
allowed.

---

## L-VID-006 — the trigger I could not verify, and the viewport that lied

**Status:** FIXED 2026-08-10.

The lazy loader first used an `IntersectionObserver`. In testing it never fired, and
a **freshly created IO on the same visible element never fired either**, which is
what proved the wiring was innocent.

Two lessons, both load bearing:

1. **Do not ship a trigger you cannot drive from a test**, especially when it is the
   only path that makes an image appear. Replaced with a rect-based sweep that a
   check can call directly (`window.bbLazySweep`). It also fixed a real defect on the
   way: comments scroll inside `.comment-list`, a nested container, and a bubbling
   window scroll listener never sees that. The listener uses `capture:true`.
2. **`window.innerHeight` was 0.** Every rect test failed at once and the placeholder
   measured 2px wide. This is the exact trap already written into
   `bb-app-foundations`: if a whole set of position checks fails together, read the
   viewport before reading the code. Taking a screenshot laid the pane out, after
   which both images loaded on their own, 500x500 and 1080x1350, with no help.

---

## L-VID-002 — no self-test harness (structural gap, not a defect)

**Status:** OPEN.

Five of the six BB systems have no self-test harness. Only the Dev System does.
This system has none, which means every change here is verified by eye or not at
all. The Section 12 harness in `~/bb-systems/master-skeleton/bb-master-skeleton.html`
is the thing to port. Everything else in this file gets safer once it exists.

---

## Verified NOT a problem (checked 2026-07-30, do not re-litigate)

- **Anon read parity.** All 19 tables this system reads carry RLS with a
  `public`-role policy and anon SELECT. No repeat of L-CC-001. `clients` carries
  both `authenticated_all` and `public access`; the public policy is the one
  keeping it alive, so never drop it.
- **The Sentinel's own probes are clean.** It uses `select=id&limit=1` with
  `Prefer: count=exact` and `Range: 0-0` (line ~4176), and its detail queries name
  explicit columns (line ~4283). The watchdog is not contributing to the payload.
- **The background agent block** (line 3669 onward, `POLL_MS` 5 min) uses explicit
  column selects throughout. Clean.
- **Local matches live** byte for byte at commit `151775d`, sha1
  `48f7b8455e9d13cc5b518ecf0be7d091b60a4905`.

## Rollback for this repo

Working tree is clean at `151775d`. The rollback is:

```
git checkout -- index.html
```

Verify it by sha1, never by exit code. There is no `.gitignore` here, so no repeat
of the gitignored-rollback trap that lost the Command Centre's rollback file.
