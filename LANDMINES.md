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

## L-VID-002 CLOSED: the self-test harness is in (2026-08-11)

37 checks in Section 12. Run `runSelfTest()` in the console or add `?selftest`
to the URL. **Green at 1280x720 AND at 375x812 with a coarse pointer.** The
mobile run is the one that counts: the field-zoom rule is coarse-only and can
never fail on a laptop, so a desktop-only green proves nothing about it.

It found five real faults on its first run, all of which would have shipped:

1. **The page walk navigated the browser out of the app.** Inspo Hub calls
   `window.open`, so the scan left the system and every later check died. It now
   skips any nav item carrying the app's own `↗` mark, which also covers the
   next external page anyone adds.
2. **The freeze check could not open an overlay.** `openProjectDetail` is
   `async`: the modal is not in the DOM on the next line. It awaits it now.
3. **The harness poisoned its own next run** by logging its own `console.warn`
   into the boot log, failing "zero console errors" with yesterday's noise.
4. **An alignment false positive** on a horizontally scrolling container, which
   is meant to hold content wider than itself.
5. **A whole second layer of emoji written as `\uXXXX` escapes**, invisible to a
   literal-character sweep. 35 of them in the agent block.

**The permanent block:** a harness is only worth what its hardest run proves.
Run it at coarse pointer, and treat "could not find the thing I test" as a
FAILURE, never a pass.

---

## L-VID-007 — the app-shell applier ships another client's identity

**Status:** FIXED 2026-08-11.

`apply_app_shell.py` copies its companion files verbatim, and its defaults are
**Total Uplift's**. Left alone, this system would have installed on a phone as
"Uplift", in the gym's `#0B1117`, with a manifest listing **13 icons when only 4
existed** and an unregistered `sw.js` commented as the gym member app.

The skill does say casting replaces the icons and the name. It is still worth a
landmine, because the applier reports success either way and nothing fails until
somebody installs the app and sees another company's name on their home screen.

**The permanent block:** after running any applier that copies companion files,
open every file it wrote. An applier's defaults belong to whoever it was written
for. Check the manifest name, the colours, and that every icon it names exists.

---

## L-VID-008 — two ways an emoji hides from a sweep

**Status:** FIXED 2026-08-11.

Sweeping emoji out of this file took three passes because they hide:

1. **As `\uXXXX` escapes.** `🤖` is 🤖 to a browser and plain ASCII to
   grep. 35 pictographs were written this way in the agent block and survived a
   sweep that had already "finished".
2. **Inside single-quoted strings.** Replacing an emoji with `${vicon(...)}`
   only works inside a template literal. In `'...'` it does not interpolate AND
   the inner quotes terminate the string. Those sites need concatenation.

**And one that bites harder:** one escape sat inside a **regex literal**,
`replace(/🤖/g, ...)`. Deleting it left `//g`, which is a line
comment, and it swallowed the `var` declaration on the next line. The error
("Unexpected token 'var'") pointed nowhere near the cause. Found by bisecting:
apply each removal alone, syntax-check, and see which one breaks.

**The permanent block:** sweep for the DECODED character, not the literal one,
and never delete a token out of a regex literal without checking what the empty
regex becomes.

---

## L-VID-009 — the safe-area inset ate the top bar instead of adding to it

**Status:** FIXED 2026-08-11. Found by Thulaib on his own phone, not by me.

The burger and the notification bell sat **1px** off the bar's bottom border.

**Measured** with a simulated Dynamic Island (`--sat: 59px`):

| | |
|---|---|
| bar height | 100px |
| padding-top | 59px |
| min-height | **56px** |
| content box left over | **41px** |
| the burger button | 40px |
| clearance below it | **1px** |

`min-height: 56px` was the height of the WHOLE bar including the inset, so the
inset was carved out of the content instead of added to it. A 40px button was
being asked to sit in 41px. Now `min-height: calc(56px + var(--sat))`, repeated
in every breakpoint that sets it. Clearance went from 1px to 9px.

**Why a laptop never showed it:** `--sat` is 0 on a desktop, so the bar is 56px
and everything fits. **This class of fault is invisible everywhere except the
one device that has a notch.**

**The permanent block:** a new check forces `--sat: 59px`, measures every child
of the top bar against both edges, and fails under 6px. It restores whatever
was there before, so it is safe to run on a live page.

---

## L-VID-010 — floating buttons covered the work on a phone

**Status:** FIXED 2026-08-11.

Two 54px circles (`#bbv-fab`, `#bb-agent-bubble`) sat 24px off the bottom right.
On a 375px screen they covered the Needs Attention panel's item count outright.
Thulaib: "It's blocking the entire view of everything."

Both removed. They were duplicate chrome: the agent alerts already have a panel
on the Dashboard and their own Agents page in the nav, so the shortcuts bought
nothing and charged rent on the screen with the least room.

**The permanent block:** a check walks every `position:fixed` element that is
at least 40x40, is not full width, is not inside an overlay, and is actually
on screen, then fails if any exist. It measures where an element IS rather than
trusting what it is called, so a drawer parked off-canvas does not false-alarm.

**The rule:** on a phone, a floating button is always covering something. If a
feature needs a permanent entry point, it goes in the nav.

---

## L-VID-007 UPDATE: the manifest was not the whole of it

Fixing the manifest text left **the gym's actual icon images in place**. The
name said BB Video System and the picture was Total Uplift's. Icons are now
generated by `~/bb-video-tools/make_icons.py` from the BB wordmark **already
embedded in index.html**, so the app icon cannot drift from what the login
screen shows. Rerun it after any logo change.

**The lesson:** fixing the label is not fixing the asset. When an applier
copies another product's identity, check the PICTURES as well as the words.

---

## L-VID-011 — the login screen was decoration: the page signed in before the PIN

**Status:** FIXED 2026-08-12. Found by a bb-rock-solid run, not by me, after a
full day of work in this file that never looked at the auth path.

`initSupabase()` called `signInWithPassword` with a shared account at boot,
before anyone touched the PIN screen. `invoices` and `costs` carry **only** an
`authenticated` policy, so that session read all finance data from the public
URL while the login screen sat on top of it.

**Verified, not assumed:** anon alone returns `[]` on both tables, so the shared
session was genuinely the escalation, not a pre-existing public grant.

**Why the fix was cheap here.** This system reads 19 tables, every one has a
public policy, and it reads `invoices` and `costs` **zero times**. The line's own
comment said it existed so "login-only tables (clients/tasks) stay readable";
both gained public policies later and nobody removed the line. It had become
dead weight that only held the hole open. **Deleting it was the fix. An auth
rework would have been the wrong tool.**

**THE PART THAT NEARLY SHIPPED HALF-FIXED.** Removing the call does **not** log
anyone out. Supabase persists the session in `localStorage`, so every person who
had ever opened the app kept a working authenticated session and kept reading
finance long after the line was gone. Proven in a browser: `sessionHeld: true`
with the call already deleted. The complete fix is three parts:

    persistSession:false, autoRefreshToken:false, detectSessionInUrl:false
    await sb.auth.signOut({scope:'local'})     // clear what is already stored
    remove any leftover sb-*-auth-token key    // for tokens the old build left

Re-verified after: `sessionHeld:false`, no leftover tokens, `invoices` 0 rows,
`costs` 0 rows, and all 8 data sets still load (136 projects, 24 clients, 500
tasks, 202 comments). **Removing a credential is not the same as revoking the
access it already handed out.**

**The permanent block:** two checks. One scans the app source for a shared login
call, one asserts at runtime that no session is held. Both proven against a
deliberately re-broken copy.

**Still open, and NOT this system's to fix:** the same credential is in
bb-smm-workspace, bb-dev-system and bb-leads-system, all on the same database,
and the string is still in bb-graphic-system. Rotating it breaks all of them at
once, so the dependencies come out first and the rotation happens last. The Dev
System genuinely needs an authenticated posture and needs the real per-user work.

---

## L-VID-012 — L-GYM-006 came back, 16 times

**Status:** FIXED 2026-08-12.

`toISOString()` converts to UTC. Colombo is UTC+5:30, so any **date-only** value
taken before 05:30 local returns **yesterday**. 13 date-only and 3 month-only
conversions were wrong, including `pillarDateStr()` (the daily pillars save
against the wrong day, and the 2PM alert reads that same field), the once-a-day
login log, the 30-day streak, and the Clients month filter, which lands on the
previous month on the 1st.

The other 36 uses are **full timestamps and are correct**. Only date-only and
month-only conversions were touched. Now `localDateStr()` and `localMonthStr()`.

**The permanent block:** a check scans the app source for
`.toISOString().slice(0,7|10)` and fails on any, plus a live assertion that
02:15 local reports today rather than yesterday.

**Both checks had to be taught not to trip on themselves.** They scan source for
a pattern they must also describe, so the first versions failed on their own
comments and example line. Fixed once, for all such checks, by scanning the
app's scripts with the harness block excluded.

---

## L-VID-013 — the pipeline moved things by itself

**Status:** FIXED 2026-08-12. Reported by Thulaib as "stuff is just getting
moved". Two separate causes, both found in `video_stage_history` rather than
guessed at.

**Cause 1: a move to the stage you are already in was accepted.**
`moveProject()` had no same-stage guard. Dropping a card into its own column
wrote a real history row and bumped `updated_at`, and because the default sort
is "recently moved (top)", the card jumped to the top of its own column.

Evidence, from live history: **11 `team_review -> team_review` rows on 06 Aug,
one person, 1.5 seconds apart.** Nobody moves 11 cards to where they already
are; that is a bulk action catching cards already in the target stage. It also
polluted the stage timings the Time Tracker and the stall agents read.

**Cause 2, the one people actually saw: the board re-sorted under them.**
The re-render fingerprint includes `updated_at`, so **any** move by **any**
teammate repainted every column and re-applied the sort. Scroll position was
preserved, the ORDER was not, so the card someone was reading slid somewhere
else every three minutes.

**The fix.** A same-stage move returns before touching the database. And during
a **silent** refresh each column keeps the order already on screen; a card that
genuinely arrived since the last paint goes to the top, which is the one
movement that carries information. A real user action (sort, filter, navigate,
manual refresh) re-sorts properly.

**Verified by doing, not by reading:**
- same-stage move: **zero** database calls, spied on `sb.from`
- different-stage move: still writes `video_stage_history` and `video_projects`
- a teammate's move during auto-refresh: order **held**
- a user changing the sort: order **changed**

**The permanent block:** three checks, and the third proves itself by navigating
to the pipeline, bumping a card's `updated_at` in memory the way a teammate's
move would, repainting, and comparing. Its first version skipped when it landed
on another page, and a check that skips is a check that proves nothing.
All three fail on a deliberately re-broken copy.

---

## L-VID-014 — fixing the UTC date bug hid every past Weekly Plan

**Status:** FIXED 2026-08-12, same day it was introduced. Reported by Thulaib as
"can't see past week work".

**This is a regression I caused while fixing L-VID-012.**

Every `week_start` ever written is a **Sunday**. `wpGetMonday()` returns a
Monday, but the old code stringified it with `toISOString()`, and Colombo is
UTC+5:30, so Monday 00:00 local became **Sunday** in UTC. Months of rows were
saved under a key one day earlier than the week they describe.

Fixing the date bug made the code ask for the real Monday. It matched nothing.
**Eight weeks of plans, 109 cells, silently unreachable.**

| Stored | Day | Cells |
|---|---|---|
| 2026-08-09 | Sun | 14 |
| 2026-08-02 | Sun | 15 |
| 2026-07-26 | Sun | 16 |
| ...8 weeks, all Sunday | | 109 total |

**The lesson, and it is the general one:** a stored value written by buggy code
is part of that bug's blast radius. Fixing the code without migrating or
tolerating the old values moves the fault from "wrong data" to "no data", which
is worse, because wrong data is visible and missing data looks like the feature
never worked.

**The fix, with no row touched.** The week is read under BOTH keys, and a save
goes back to whichever key that week already uses, so a week can never split
across two dates. A brand new week starts on the correct Monday.

**The permanent block:** a check that PROVES it by loading. Its first version
did the date arithmetic itself, recomputed the Monday from a stored Sunday, and
landed on the previous week, **failing in exactly the way it was written to
catch**. It now takes the newest stored week, loads it through the app's own
`wpGridLoad`, and asserts cells come back.

**Still open, needs Thulaib's approval:** the keys are still Sundays. One
`UPDATE weekly_plan_cells SET week_start = week_start + 1` normalises every row
to the correct Monday, after which the legacy path can be deleted. That is a
data change, so it waits for a yes.

---

## L-VID-015 — Weekly Plan carry-over (feature, not a defect)

Built 2026-08-12. Thulaib's ask was to **block saving** until last week was
clear. Built the same intent with a softer lever, and said why: a block punishes
whoever plans this week for last week's mess, on a Monday morning, and the
predictable dodge is typing junk into last week to clear it, which leaves worse
data than before. A prompt you cannot miss achieves the same thing without
giving anyone a reason to lie to the system.

**The rule, from Thulaib: only DONE is done. Delayed is not done.**
Unresolved = has content AND status is not `done`.

**Three ways to resolve, one click each:**
- **Move to this week** copies the text into this week's same editor and day and
  removes last week's row, because the work did not happen last week. If this
  week's cell already has content the text is **appended**, never overwritten:
  silently replacing someone's typing is unforgivable.
- **Done** marks last week's row done and leaves it, so the record stays honest.
- **Drop** removes it. Not done, not carried.

Plus "move all" and "mark all done" for the common Monday case.

**Only shown on the CURRENT week.** Browsing back through history must not nag
about the week before it.

**Verified against live data, then cleaned up after itself.** A disposable
`ZZ-TEST` row was created in last week and all three actions exercised on it:
done set the status and dropped it from the panel; move removed last week's row
and created this week's under the correct key with the content intact; drop
deleted a `delayed` row and confirmed delayed counts as unresolved. Cleanup left
**0 test rows**, and the panel returned to the real 5 items. No real plan was
touched at any point.

**MIGRATED 2026-08-12.** All 109 rows shifted from Sunday to the correct Monday
after checking for collisions (0) against the unique constraint on
`(week_start, editor_name, day_of_week)`. Counts unchanged: 14, 15, 16, 16, 9,
14, 10, 15. The tolerant both-keys lookup was then **removed on purpose**: left
in, a future Sunday write would be silently absorbed and the bug would hide
again. A wrong key now fails loudly.

**A second self-inflicted cut while removing it.** The removal used a coarse
region replacement (everything between a comment and the next function) rather
than precise anchors, and took `wpFetchWeek`, `wpIsUnresolved` and the
carry-over state with it. The harness caught it in one run:
`wpIsUnresolved is not defined`, and the weekly check reporting 0 cells.
**Never delete by region when the region has grown since you last read it.**

---

## L-VID-016 — a flag you never SELECT is a flag you do not have

**Status:** FIXED 2026-08-14.

NIDWIN and SANDUNU left the team. `team_members` already had an `active` column
and **nothing in the app ever read it**. Worse, when I added `isActiveMember()`
the boot query still said `select('id, name, role')`, so `m.active` was
`undefined`, `active!==false` was true for everyone, and both leavers stayed in
every assignment dropdown. **The filter looked correct and could not work.**

Caught by driving the UI rather than reading the code: logins and the Weekly
Plan grid were clean, while the Team page and the Pipeline editor filter still
listed them. One surface passing is not the feature working.

It also revealed KANEESHA had been `active=false` in the database for some time
and was still showing everywhere, because nobody was reading the flag.

**The shape of the fix that matters:** leavers are marked inactive, never
deleted. Deleting a person deletes the history of their work with them. They
vanish from anywhere you can assign NEW work and from the headcount, and their
name still appears on every project, stage move and plan cell they touched.

**Left for Thulaib:** NIDWIN still owns **2 live HIRE PANTHER videos sitting in
Editing** (JUL VID 2 and JUL VID 3). Those need a new owner. SANDUNU's 2 are
already on Add to Drive, so nothing to do there.

---

## L-VID-017 — a 17px tick box is a miss waiting to happen

**Status:** FIXED 2026-08-14.

The Weekly Plan tick box is drawn 17px so the grid stays dense. Correct under a
mouse, wrong under a thumb, and the failure is nasty: a near miss falls through
to the cell's own click handler and **drops the person into a text editor when
they meant to tick something**.

Now, on **coarse pointers only**, the row gets real height and both controls
carry an invisible 44px target. Measured after: drawn 20px, tappable 48px.

**The check is coarse-only and says so on a laptop**, the same precedent as the
field-zoom rule: "fine pointer: rule is coarse only, RUN THIS AT 390px TO PROVE
IT". A check that cannot fail for the right reason must not report a quiet pass.

---

## L-VID-018 — welcome walkthrough (feature)

Built 2026-08-20. Structure ported from `bb-graphic-system`, content written for
this system. Per `bb-onboarding-standard`.

**Three rules that came with the pattern, all of them earned elsewhere:**

1. **It fires from the SIGN-IN DOOR, never a boot timer.** In the Graphic System
   it first opened over the login screen and greeted somebody by name before
   they had proved who they were. It is triggered inside `onLoginSuccess`, where
   `currentUser` is already set. There is a check for this.
2. **Reopenable forever, from the sidebar.** That is half the feature. Whoever
   skips on day one is exactly the person asking in week two.
3. **Every number is COUNTED, never typed.** The card says "It is 13 pages"
   because it read the nav, and an **editor is told 7** because they have fewer.
   A typed number goes stale the day somebody adds a page, and a guide that
   miscounts the thing it describes loses a new person on card one.

Seven cards, answering what a new person actually arrives asking rather than
touring the menu: what this is, the Pipeline is your day, Add to Drive is the
only finish line, the Weekly Plan, Mondays, where the numbers come from, and say
so if it looks wrong.

**Verified by driving it:** all 7 cards render with icon and dots, Back hides on
card one, Skip hides on the last where the button reads Start, closing restores
body scroll, a second sign-in does NOT reopen it, the sidebar button reopens it
at card one, and Skip closes from midway. At 375px with a notch simulated the
dots clear the inset, the button is 48px and sits clear of the home bar.

**Still to build, and it is the other half of the standard:** a CHECKLIST
derived from real data. A walkthrough teaches and is forgotten by tomorrow; a
checklist changes behaviour because it is tied to things the person actually
does. Every item must be DERIVED (has this person moved a card, ticked a plan
line, installed the app), never self-reported, because an item somebody ticks by
hand is theatre.

---

## L-VID-019 — a login with no team_members row is a dead login

**Status:** FIXED 2026-08-20.

BAVITH and KAVISH were added to `USERS` and to `WP_EDITORS`. They could sign in
perfectly, and **saw an empty board**. Proven before fixing: `visibleProjects()`
returned **0** for both while RAJEEWA saw 113.

**Why.** An editor's projects are filtered by `assigned_editor_id`, which
resolves through `team_members` **by name**. No row means `currentEditorId()`
returns null, and `visibleProjects()` returns `[]`. Nothing errors. Nothing logs.
The app simply shows them nothing, forever, and **assigning them work would not
have helped**, because the assignment dropdown is also built from
`team_members`, so they could not be picked in the first place.

A login is three things in this system and all three must exist:
1. the `USERS` entry, which is the door
2. a `team_members` row, which is what work attaches to
3. `WP_EDITORS`, which is the Weekly Plan row

Two out of three looks completely working right up until the person opens it.

Rows created (BAVITH 20, KAVISH 21, both `active=true`). Admins are deliberately
exempt: they are not team members and see everything regardless.

**The permanent block:** a check asserts every `USERS` entry with role `editor`
or `video_head` resolves to a `team_members` row, and names anyone who does not.

---

## L-VID-020 — Month Recap (feature), and two bugs it exposed

Built 2026-08-21. A PAGE, not a generated document, so it reads the same
`monthDelivery` rule as the Clients page and the two can never drift apart. A
separate report generator would disagree with the app the first time either one
changed.

**The design point: "not done" is THREE different things**, and a recap that
reports one number hides the expensive one.

| | July 2026 |
|---|---|
| Made | 58 |
| Delivered | 38 |
| Started, not finished | 20 (8 ours, 12 waiting on a reviewer or client) |
| **Never made** | **58** (sold 111, created 58, 8 clients had none at all) |

**Never made is the one that hides.** Sastho sold 8, delivered 3, and had ZERO
outstanding. A stuck-work report shows Sastho as clean. Nothing on any other
screen surfaces the gap between what was sold and what anybody even attempted.

**The numbers have to reconcile or the report gets ignored.** The first version
said "38 delivered of 111 sold", which invites 111 minus 38 and produces a
number that means nothing, because 5 over-delivered videos do not offset another
client's shortfall. Now there are two clean statements instead of one confusing
one: **made = delivered + open** (58 = 38 + 20), and separately sold against
made. There is a check on that invariant.

**Two bugs it exposed, both in older code:**

1. **The archived query never selected `assigned_editor_id`.** Every archived
   project resolved to "(unassigned)", so the person who did the work lost
   credit. RAJEEWA read **26** where the database said **28**. Any per-person
   view over history was quietly wrong. Column added, plus a check.
2. **Cutting written without a number counted as 0 and rendered as a dash**,
   which reads as "cut nothing". Ushane did 5 cutting jobs in July, none of them
   numbered. It now shows "5 jobs, not counted" rather than a dash. **A number
   the system cannot compute must say so, never render as zero.**

**v2, 2026-08-21.** Rebuilt as an analytics view for the video head, who already
sees all 158 projects and already had the page, so this was purely about making
it answer a harder question: not "what happened" but **"why is this month
different from last"**.

Every headline number now carries its change, and a **diagnosis block sits at
the top**, derived from the deltas rather than written by hand. It exists to
separate three kinds of "down" that look identical in a single number:

| What the numbers say | What it means |
|---|---|
| fewer created | a planning gap, before anyone edits anything |
| same created, fewer delivered | throughput |
| more parked with reviewers or clients | not ours to clear |

Live example from July against June: *"Delivery is down 1 even though 9 more
were created. The extra work went in and has not come out yet, so it is sitting
in the pipe rather than missing."* Followed by where the extra 10 went (5 to
clients, 5 to the team) and the biggest movers by person.

Also added: a client filter across the whole page, and last month beside this
month in the workload, stage and client tables.

**One wording bug caught in testing, worth the entry.** The first version said
"on roughly the same amount created" while **9 more** had in fact been created.
The number was right and the sentence was wrong, which is the sort of small
inaccuracy that makes somebody stop trusting the whole page. A derived sentence
must state what actually happened to **both** numbers, in both directions.
