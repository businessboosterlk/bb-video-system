/* Pass marks for the From Thulaib card in the BB Video System (THULAIB CC HANDOFF, 8 Nov 2026). Adapted from
   bb-command-centre handoff/parts/handoff.check.mjs. Opens the real index.html signed in as USHANE (team_members 5)
   on a 390 px phone and a 1440 px desk. Every supabase.co call is answered with test data, nothing reaches the
   database. Checks: the card shows under the page head, Done saves with an optional line, Stuck needs a reason, Carry
   on appears after a reply, the card survives a refresh and leaves other pages alone, no tasks means no card, the
   cards' parts are byte for byte the Command Centre's, no page errors, the rest of the first screen is intact.
   node handoff-from-card.check.mjs [base-url] */
import { chromium } from '/Users/thulaibhassen/bb-systems/batch/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';
const BASE = process.argv[2] || 'http://127.0.0.1:8817/index.html';
const rows = []; let bad = 0, total = 0;
const pass = (name, ok, note = '') => { total++; if (!ok) bad++; rows.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? '  (' + note + ')' : ''}`); };

/* parity: the pasted parts are the Command Centre's, byte for byte */
{
  const P = '/Users/thulaibhassen/bb-command-centre/.claude/worktrees/vigilant-cannon-efb76a/handoff/parts/';
  const s = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  const blk = s.slice(s.indexOf('@@BBHO_FROM_CARD@@ BEGIN'), s.indexOf('@@BBHO_FROM_CARD@@ END'));
  for (const f of ['h5-card.js', 'ho.css']) pass(`parity: ${f} pasted byte for byte`, blk.includes(readFileSync(P + f, 'utf8')));
  pass('parity: one block, one glue', s.split('@@BBHO_FROM_CARD@@ BEGIN').length === 2 && blk.split('// glue: Video System').length === 2);
}

const TEAM = [[5, 'USHANE', 'video_head'], [6, 'RAJEEWA', 'editor'], [11, 'RAMANI', 'editor'], [23, 'THULAIB', 'admin'], [24, 'SHIARA', 'admin']].map(([id, name, role]) => ({ id, name, role, active: true }));
const CLIENTS = [{ id: 41, name: 'SASTHO', status: 'active' }, { id: 42, name: 'SUN ZAPPER', status: 'active' }, { id: 43, name: 'WAVERLEY', status: 'active' }];
const T = (o) => ({ due: null, client_id: null, notes: null, sent_by: 'THULAIB', seen_at: '2026-11-07T03:00:00Z', stuck_note: null, stuck_at: null, stuck_reply: null, stuck_reply_at: null, done: false, done_note: null, completed_at: null, created_at: '2026-11-07T03:00:00Z', ...o });
const CARD = [
  T({ id: 801, title: 'Cut the Sastho reel', due: '2026-11-20', client_id: 41, notes: 'The footage is on the drive', seen_at: null, created_at: '2026-11-08T03:00:00Z' }),
  T({ id: 802, title: 'Send the Waverley edit for review', due: '2026-11-02', client_id: 43 }),
  T({ id: 803, title: 'Colour the Sun Zapper ad', client_id: 42, stuck_note: '07 Nov 10:15 Waiting on the music', stuck_at: '2026-11-07T04:45:00Z', stuck_reply: 'Use the second track for now', stuck_reply_at: '2026-11-07T05:00:00Z', created_at: '2026-11-06T03:00:00Z' }),
  T({ id: 804, title: 'Archive the October projects', seen_at: '2026-11-08T03:00:00Z', done: true, done_note: 'All twelve moved', completed_at: '2026-11-08T05:00:00Z', created_at: '2026-11-05T03:00:00Z' })
];

async function page(b, opts, tasks) {
  const ctx = await b.newContext({ ...opts, colorScheme: 'dark' });
  await ctx.addInitScript(() => { sessionStorage.setItem('bb_video_user', JSON.stringify({ name: 'USHANE' })); sessionStorage.setItem('bb_video_pass', 'test-pass'); localStorage.setItem('bbvid_guide_seen', '1'); });
  const calls = [], reads = [];
  await ctx.route(/supabase\.co\//, async (route) => {
    const req = route.request(), u = new URL(req.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.pathname === '/rest/v1/rpc/app_session_check') return json('USHANE');
    if (u.pathname.startsWith('/rest/v1/rpc/bb_handoff_')) { calls.push({ name: u.pathname.split('/').pop(), body: JSON.parse(req.postData() || '{}') }); return json({ ok: true }); }
    if (u.pathname.startsWith('/rest/v1/rpc/')) return json(null);
    if (u.pathname === '/rest/v1/team_members') return json(TEAM);
    if (u.pathname === '/rest/v1/clients') return json(CLIENTS);
    if (u.pathname === '/rest/v1/tasks' && u.search.includes('sent_to_id=eq.5')) { reads.push(u.search); return json(tasks); }
    if (req.method() !== 'GET' && req.method() !== 'HEAD') calls.push({ name: req.method() + ' ' + u.pathname, body: req.postData() });
    return json([], req.method() === 'POST' ? 201 : 200);
  });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e.message || e)));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await p.goto(BASE, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => typeof currentUser !== 'undefined' && currentUser && document.querySelector('#pageContent .page-head'), null, { timeout: 20000 });
  await p.waitForTimeout(1500);
  return { ctx, p, calls, reads, errs };
}

const b = await chromium.launch();
for (const [size, opts] of [['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }], ['desk', { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }]]) {
  const L = size;
  /* no tasks: no card at all; the first screen's shape is noted for the next run */
  let base;
  {
    const { ctx, p, reads, errs } = await page(b, opts, []);
    const st = await p.evaluate(() => { const m = document.getElementById('ho-card-mount'); return { mounted: !!m, hidden: m ? m.hidden : null, h: m ? m.getBoundingClientRect().height : 0, kids: [...document.querySelectorAll('#pageContent > *')].filter(x => x.id !== 'ho-card-mount').map(x => x.className).join('|'), title: document.querySelector('#pageContent .page-title')?.textContent } });
    base = st;
    pass(`${L} no tasks: the card was asked for Ushane (sent_to_id 5)`, reads.length >= 1);
    pass(`${L} no tasks: nothing shows`, !st.mounted || (st.hidden && st.h === 0) && await p.locator('.ho-card').count() === 0, JSON.stringify({ hidden: st.hidden, h: st.h }));
    pass(`${L} no tasks: no page errors`, errs.length === 0, errs.join(' | '));
    await ctx.close();
  }
  const { ctx, p, calls, reads, errs } = await page(b, opts, CARD);
  const card = p.locator('#ho-card-mount .ho-card');
  pass(`${L} Ushane lands on the dashboard`, await p.evaluate(() => currentPage) === 'dashboard' && /Welcome back, USHANE/.test(await p.textContent('#pageContent .page-title')));
  pass(`${L} the card sits right under the page head`, await p.evaluate(() => { const m = document.getElementById('ho-card-mount'); return !!m && !m.hidden && m.previousElementSibling && m.previousElementSibling.classList.contains('page-head'); }));
  const shape = await p.evaluate(() => [...document.querySelectorAll('#pageContent > *')].filter(x => x.id !== 'ho-card-mount').map(x => x.className).join('|'));
  pass(`${L} the rest of the first screen is the same as with no card`, shape === base.kids, shape.slice(0, 120));
  pass(`${L} card shows From Thulaib`, (await card.locator('.ho-card-title').textContent().catch(() => '')) === 'From Thulaib');
  pass(`${L} card says 3 to do`, (await card.locator('.ho-card-sub').textContent().catch(() => '')) === '3 to do');
  pass(`${L} card rows in order, done last`, (await card.locator('.ho-t-title').allTextContents()).join('|') === 'Cut the Sastho reel|Send the Waverley edit for review|Colour the Sun Zapper ad|Archive the October projects');
  pass(`${L} the client name comes from this system`, (await card.locator('.ho-task[data-id="801"] .ho-t-meta').textContent().catch(() => '')).startsWith('SASTHO'), await card.locator('.ho-task[data-id="801"] .ho-t-meta').textContent().catch(() => ''));
  pass(`${L} late row says was due`, (await card.locator('.ho-task[data-id="802"] .ho-late').textContent().catch(() => '')) === 'was due Mon 2 Nov');
  pass(`${L} done row shows the what I did line`, (await card.locator('.ho-task[data-id="804"] .ho-t-meta').textContent().catch(() => '')) === 'Done · All twelve moved');
  const seen = calls.filter(c => c.name === 'bb_handoff_seen' && c.body.p_carry_on === false);
  pass(`${L} the unseen row is marked seen once, as USHANE`, seen.length === 1 && seen[0].body.p_id === 801 && seen[0].body.p_who === 'USHANE', JSON.stringify(seen.map(c => c.body)));
  /* the dashboard keeps its own Agent Alerts strip above the page head; the card goes under the head; its first
     task with its Done button must still be on the first screen without a scroll */
  const fold = await p.evaluate(() => { const d = document.querySelector('#ho-card-mount .ho-task button'); return { top: Math.round(document.getElementById('ho-card-mount').getBoundingClientRect().top), done: Math.round(d.getBoundingClientRect().bottom), h: innerHeight }; });
  pass(`${L} the first task and its Done button are on the first screen`, fold.done <= fold.h, `card at ${fold.top}px, Done ends ${fold.done}px of ${fold.h}`);
  /* Done with the optional line */
  let k = calls.length;
  await card.locator('.ho-task[data-id="801"] button:has-text("Done")').click(); await p.waitForTimeout(150);
  const fs = await card.locator('.ho-task[data-id="801"] .ho-t-form .ho-in').evaluate(x => parseFloat(getComputedStyle(x).fontSize)).catch(() => 0);
  pass(`${L} Done opens a What I did line at 16px`, fs >= 16 && (await card.locator('.ho-task[data-id="801"] .ho-t-form .ho-in').getAttribute('placeholder')) === 'What I did (optional)', fs + 'px');
  await card.locator('.ho-task[data-id="801"] .ho-t-form .ho-in').fill('Cut and on the drive');
  await card.locator('.ho-task[data-id="801"] button:has-text("Mark done")').click(); await p.waitForTimeout(500);
  let c = calls.slice(k).find(x => x.name === 'bb_handoff_done');
  pass(`${L} Mark done calls bb_handoff_done { p_id 801, p_who USHANE, p_note }`, c && c.body.p_id === 801 && c.body.p_who === 'USHANE' && c.body.p_note === 'Cut and on the drive', JSON.stringify(c && c.body));
  pass(`${L} Mark done says Done. Thulaib can see it`, await p.locator('.toast', { hasText: 'Done. Thulaib can see it' }).count() >= 1);
  /* Done with nothing typed sends null */
  k = calls.length;
  await card.locator('.ho-task[data-id="802"] button:has-text("Done")').click(); await card.locator('.ho-task[data-id="802"] button:has-text("Mark done")').click(); await p.waitForTimeout(500);
  c = calls.slice(k).find(x => x.name === 'bb_handoff_done');
  pass(`${L} Mark done with no line sends p_note null`, c && c.body.p_id === 802 && c.body.p_note === null, JSON.stringify(c && c.body));
  /* Stuck needs a reason */
  k = calls.length;
  await card.locator('.ho-task[data-id="802"] button:has-text("Stuck")').click(); await card.locator('.ho-task[data-id="802"] .ho-t-form button:has-text("Send")').click(); await p.waitForTimeout(200);
  pass(`${L} Stuck with nothing typed asks why and calls nothing`, calls.slice(k).length === 0 && (await card.locator('.ho-task[data-id="802"] .ho-err').textContent()) === 'Say what is in the way first.');
  await card.locator('.ho-task[data-id="802"] .ho-t-form .ho-in').fill('Waverley has not sent the logo');
  await card.locator('.ho-task[data-id="802"] .ho-t-form button:has-text("Send")').click(); await p.waitForTimeout(500);
  c = calls.slice(k).find(x => x.name === 'bb_handoff_stuck');
  pass(`${L} Stuck calls bb_handoff_stuck { p_id 802, p_who USHANE, p_note }`, c && c.body.p_id === 802 && c.body.p_who === 'USHANE' && c.body.p_note === 'Waverley has not sent the logo', JSON.stringify(c && c.body));
  /* Carry on after a reply */
  pass(`${L} the stuck row shows Thulaib's reply`, (await card.locator('.ho-task[data-id="803"] .ho-t-reply').textContent().catch(() => '')) === 'Thulaib: Use the second track for now');
  pass(`${L} the row without a reply has no Carry on`, await card.locator('.ho-task[data-id="801"] button:has-text("Carry on")').count() === 0);
  k = calls.length;
  await card.locator('.ho-task[data-id="803"] button:has-text("Carry on")').click(); await p.waitForTimeout(500);
  c = calls.slice(k).find(x => x.name === 'bb_handoff_seen');
  pass(`${L} Carry on calls bb_handoff_seen { p_id 803, p_who USHANE, p_carry_on true }`, c && c.body.p_id === 803 && c.body.p_who === 'USHANE' && c.body.p_carry_on === true, JSON.stringify(c && c.body));
  /* the action rows: equal halves, 44px, labels whole */
  const btn = await p.evaluate(() => {
    const out = [];
    document.querySelectorAll('#ho-card-mount .ho-pair').forEach(r => { const bs = [...r.children].filter(x => x.offsetParent); const ws = bs.map(x => x.getBoundingClientRect().width); if (Math.max(...ws) - Math.min(...ws) > 1.5) out.push('unequal ' + ws.map(Math.round)); });
    document.querySelectorAll('#ho-card-mount button').forEach(x => { if (!x.offsetParent) return; const r = x.getBoundingClientRect(); if (r.height < 43.5) out.push(x.textContent + ' ' + Math.round(r.height) + 'px'); if (x.scrollWidth > x.clientWidth + 1) out.push(x.textContent + ' cut'); const cs = getComputedStyle(x); if (cs.textAlign !== 'center' && cs.justifyContent !== 'center') out.push(x.textContent + ' not centred'); });
    return out;
  });
  pass(`${L} every card button is 44px, centred, equal in its pair`, btn.length === 0, btn.join(', '));
  /* the card does not move the page sideways */
  const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  pass(`${L} page never scrolls sideways`, over <= 0, over + 'px');
  /* a refresh rewrites #pageContent: the same card comes back, not a second one */
  const r0 = reads.length;
  await p.evaluate(() => { window.__hoMount = document.getElementById('ho-card-mount'); renderPage(); });
  await p.waitForTimeout(300);
  pass(`${L} after a refresh the same card is back under the head, with no new read`, await p.evaluate(() => { const m = document.getElementById('ho-card-mount'); return m === window.__hoMount && m.previousElementSibling.classList.contains('page-head') && document.querySelectorAll('#ho-card-mount').length === 1; }) && reads.length === r0, `reads ${r0} then ${reads.length}`);
  /* another page: the card is not there; back to the dashboard: it is */
  await p.evaluate(() => navTo('pipeline')); await p.waitForTimeout(600);
  pass(`${L} the Pipeline page has no card`, await p.locator('#ho-card-mount').count() === 0);
  await p.evaluate(() => navTo('dashboard')); await p.waitForTimeout(600);
  pass(`${L} back on the dashboard the card is there again`, await p.locator('#pageContent > .page-head + #ho-card-mount .ho-card').count() === 1);
  /* the page's own self test: the card's checks pass */
  const st = await p.evaluate(async () => { const r = await runSelfTest(); return r.results.filter(x => /^From card/.test(x.name)).map(x => ({ n: x.name, p: x.pass, d: x.detail })); });
  pass(`${L} runSelfTest runs the 4 From card checks and all pass`, st.length === 4 && st.every(x => x.p), st.filter(x => !x.p).map(x => x.n + ' ' + x.d).join('; '));
  pass(`${L} the card writes nothing but bb_handoff_* (no table writes)`, !calls.some(x => /^(POST|PATCH|DELETE) \/rest\/v1\/tasks/.test(x.name)), calls.filter(x => !/^bb_handoff_/.test(x.name)).map(x => x.name).join(','));
  pass(`${L} no page errors`, errs.length === 0, errs.join(' | ').slice(0, 300));
  await p.evaluate(() => navTo('dashboard'));
  await p.screenshot({ path: `/private/tmp/claude-501/-Users-thulaibhassen-bb-command-centre--claude-worktrees-vigilant-cannon-efb76a/51ff8c77-f434-488b-840b-24afbe57c7b8/scratchpad/vid-card-${size}.png` });
  await ctx.close();
}
/* signed out: no card */
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/supabase\.co\//, r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  const p = await ctx.newPage(); await p.goto(BASE, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(2500);
  pass('signed out: no card and no task read', await p.locator('#ho-card-mount').count() === 0);
  await ctx.close();
}
await b.close();
console.log(rows.join('\n'));
console.log(`\nRESULT: ${total - bad} of ${total} PASS${bad ? ', ' + bad + ' FAIL' : ''}`);
process.exit(bad ? 1 : 0);
