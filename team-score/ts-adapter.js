/* TEAM SCORE ADAPTER. Turns BB rows (Graphic and Video boards, their stage history, the video assignment history and
   bb_review_events) into the jobs the Midnight Masala engine scores. Pure functions, no fetch, no DOM.
   The engine (engine.js) is copied byte for byte beside this file and never edited. Rules: ~/bb-systems/team-score/SPEC.md.
   Copy this file byte for byte into every app that shows a Team Score. Written 6 Nov 2026 (TEAM SCORE BUILD 3). */
(function (g) {
  'use strict';

  var OFF = 5.5 * 3600e3;          // Colombo is UTC+05:30
  var DAY = 86400e3;
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function ms(x) {
    if (x === null || x === undefined || x === '') return NaN;
    if (typeof x === 'number') return x;
    if (x instanceof Date) return x.getTime();
    if (/^\d{4}-\d{2}-\d{2}$/.test(x)) return Date.parse(x + 'T12:00:00+05:30');
    return Date.parse(x);
  }
  function iso(t) { return new Date(t).toISOString(); }
  function colomboDay(t) { return Math.floor((t + OFF) / DAY); }
  function dayLabel(t) {
    var d = new Date(colomboDay(t) * DAY);
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MON[d.getUTCMonth()];
  }

  /* The Colombo week (Monday 00:00 to Sunday 24:00) that holds this day. endMs is Sunday 23:59:59.999. */
  function week(dateOrIso) {
    var t = ms(dateOrIso);
    var day = colomboDay(t);
    var dow = (new Date(day * DAY).getUTCDay() + 6) % 7;   // Monday 0
    var startMs = (day - dow) * DAY - OFF;
    var endMs = startMs + 7 * DAY - 1;
    return { startIso: iso(startMs), endIso: iso(endMs), startMs: startMs, endMs: endMs,
      label: dayLabel(startMs) + ' to ' + dayLabel(endMs) };
  }

  /* A deadline date D is due at D 23:59:59.999 Colombo. A timestamp deadline is due at the end of its Colombo day. */
  function dueIso(deadline) {
    if (!deadline) return null;
    var t = ms(deadline);
    if (isNaN(t)) return null;
    return iso((colomboDay(t) + 1) * DAY - OFF - 1);
  }

  function byTime(field) {
    return function (a, b) { return ms(a[field]) - ms(b[field]) || (a.id || 0) - (b.id || 0); };
  }
  function groupBy(rows, key) {
    var out = {};
    for (var i = 0; i < rows.length; i++) {
      var k = String(rows[i][key]);
      (out[k] = out[k] || []).push(rows[i]);
    }
    return out;
  }
  function blankShown() { return { clientChanges: 0, rejected: 0, noDeadline: 0, finished: 0 }; }
  function bump(shown, person, field) {
    if (person === null || person === undefined || isNaN(person)) return;
    var k = String(person);
    (shown[k] = shown[k] || blankShown())[field]++;
  }
  function num(x) { return x === null || x === undefined || x === '' ? null : Number(x); }
  function titleOf(p) {
    var t = String(p.title || '').trim();
    var c = String(p.client_name || '').trim();
    return c ? (t ? c + ': ' + t : c) : (t || 'Untitled');
  }
  function latestRating(evs, asOfMs) {
    var best = null;
    for (var i = 0; i < evs.length; i++) {
      var e = evs[i];
      if (e.kind !== 'rating' || ms(e.created_at) > asOfMs) continue;
      if (!best || ms(e.created_at) >= ms(best.created_at)) best = e;
    }
    return best ? { stars: Number(best.stars), at: best.created_at } : null;
  }

  /* GRAPHICS. Board graphic_projects, history graphic_stage_history. */
  var G_APPROVED = { approved: 1, sent_to_client: 1, client_changes: 1 };

  function graphicJobs(data, startMs, asOfMs) {
    var projects = data.projects || [];
    var hist = groupBy((data.history || []).filter(function (h) { return ms(h.entered_at) <= asOfMs; }), 'graphic_project_id');
    var evs = groupBy((data.events || []).filter(function (e) { return e.system === 'graphic' && ms(e.created_at) <= asOfMs; }), 'job_id');
    var inWeek = function (t) { return t >= startMs && t <= asOfMs; };
    var jobs = [], shown = {};

    for (var i = 0; i < projects.length; i++) {
      var p = projects[i];
      if (ms(p.created_at) > asOfMs) continue;
      var h = (hist[String(p.id)] || []).slice().sort(byTime('entered_at'));
      var ev = evs[String(p.id)] || [];
      var assignee = num(p.assigned_designer_id);
      var last = h.length ? h[h.length - 1].stage : null;
      var state = G_APPROVED[last] ? 'approved' : (last === 'head_review' ? 'submitted' : 'in_progress');
      // Archived and never approved = taken off the board, the Graphic System's own isOverdue rule. Shown, never scored.
      // is_archived carries no date, so a past week also reads it as it stands today.
      if (p.is_archived === true && state !== 'approved') state = 'cancelled';

      var approvedAt = null, submittedAt = null, j;
      for (j = 0; j < h.length; j++) if (h[j].stage === 'approved') { approvedAt = h[j].entered_at; break; }
      if (!approvedAt && state === 'approved') {
        for (j = 0; j < h.length; j++) if (G_APPROVED[h[j].stage]) { approvedAt = h[j].entered_at; break; }
      }
      if (approvedAt) {
        for (j = 0; j < h.length; j++) if (h[j].stage === 'head_review' && ms(h[j].entered_at) <= ms(approvedAt)) submittedAt = h[j].entered_at;
        if (!submittedAt) submittedAt = approvedAt;   // the head may approve straight from To do (L-GFX-076)
      } else if (state === 'submitted') {
        submittedAt = h[h.length - 1].entered_at;
      }

      var rejections = [];
      for (j = 0; j < ev.length; j++) {
        if (ev[j].kind === 'send_back') rejections.push({ at: ev[j].created_at, reason: ev[j].reason || 'No reason recorded', by: ev[j].by_name || '' });
        if (ev[j].kind === 'client_change' && inWeek(ms(ev[j].created_at))) bump(shown, num(ev[j].person_id) !== null ? num(ev[j].person_id) : assignee, 'clientChanges');
      }
      for (j = 0; j < h.length; j++) if (h[j].stage === 'client_changes' && inWeek(ms(h[j].entered_at))) bump(shown, assignee, 'clientChanges');
      if (approvedAt && inWeek(ms(approvedAt))) bump(shown, assignee, 'finished');

      var due = dueIso(p.deadline);
      if (!due) {
        var touched = inWeek(ms(p.created_at));
        for (j = 0; j < h.length && !touched; j++) if (inWeek(ms(h[j].entered_at))) touched = true;
        if (touched) bump(shown, assignee, 'noDeadline');
      }

      jobs.push({
        ref: 'G-' + p.id, title: titleOf(p), assignee: assignee, dept: 'graphic',
        due: due, extension: null, state: state,
        submittedAt: submittedAt, approvedAt: approvedAt,
        rating: latestRating(ev, asOfMs), rejections: rejections
      });
    }
    return { jobs: jobs, shown: shown };
  }

  /* VIDEO. Board video_projects, history video_stage_history, holder video_assignment_history.
     Stage order checked against const STAGES in ~/bb-video-system/index.html on 6 Nov 2026. */
  var V_INTERNAL = { video_head_review: 1, team_review: 1, coo_check: 1 };
  var V_PASSED = { client_review: 1, sent_to_client: 1, add_to_drive: 1, posted: 1 };
  var V_SB_FROM = { team_review: 1, video_head_review: 1, coo_check: 1, rendering: 1, editing: 1 };
  
  function holderAt(rows, t) {
    var best = null;
    for (var i = 0; i < rows.length; i++) {
      var a = rows[i], s = ms(a.assigned_at), e = a.ended_at ? ms(a.ended_at) : Infinity;
      if (s <= t && t < e && (!best || s >= ms(best.assigned_at))) best = a;
    }
    return best ? num(best.editor_id) : null;
  }

  function videoJobs(data, startMs, asOfMs) {
    var projects = data.projects || [];
    var hist = groupBy((data.history || []).filter(function (h) { return ms(h.entered_at) <= asOfMs; }), 'video_project_id');
    var asg = groupBy((data.assignments || []).filter(function (a) { return ms(a.assigned_at) <= asOfMs; }), 'video_project_id');
    var evs = groupBy((data.events || []).filter(function (e) { return e.system === 'video' && ms(e.created_at) <= asOfMs; }), 'job_id');
    var inWeek = function (t) { return t >= startMs && t <= asOfMs; };
    var jobs = [], shown = {};

    for (var i = 0; i < projects.length; i++) {
      var p = projects[i];
      if (ms(p.created_at) > asOfMs) continue;
      var h = (hist[String(p.id)] || []).slice().sort(byTime('entered_at'));
      var a = asg[String(p.id)] || [];
      var ev = evs[String(p.id)] || [];
      var last = h.length ? h[h.length - 1].stage : null;
      var j;

      var passAt = null;
      for (j = 0; j < h.length; j++) if (V_PASSED[h[j].stage]) { passAt = h[j].entered_at; break; }
      var state = last === 'rejected' ? 'cancelled'
        : passAt ? 'approved'
        : (V_INTERNAL[last] || last === 'rendering') ? 'submitted' : 'in_progress';
      if (p.is_archived === true && state !== 'approved') state = 'cancelled';   // archived before passing: shown, never scored

      var submittedAt = null;
      var limit = passAt ? ms(passAt) : asOfMs;
      for (j = 0; j < h.length; j++) if (h[j].stage === 'video_head_review' && ms(h[j].entered_at) <= limit) submittedAt = h[j].entered_at;
      if (passAt && !submittedAt) submittedAt = passAt;

      var fallback = num(p.assigned_editor_id);
      var holdT = (passAt || state === 'submitted') && submittedAt ? ms(submittedAt) : asOfMs;
      var assignee = holderAt(a, holdT);
      if (assignee === null) assignee = fallback;
      var holder = function (t) { var x = holderAt(a, t); return x === null ? assignee : x; };

      var mine = [], other = {};
      for (j = 1; j < h.length; j++) {
        var prev = h[j - 1].stage, cur = h[j].stage, at = ms(h[j].entered_at);
        if (cur === 'changes' && V_SB_FROM[prev]) {
          var reason = 'No reason recorded', by = '';
          for (var k = 0; k < ev.length; k++) {
            if (ev[k].kind === 'send_back' && Math.abs(ms(ev[k].created_at) - at) <= 120e3) { reason = ev[k].reason || reason; by = ev[k].by_name || ''; break; }
          }
          var who = holder(at);
          var r = { at: h[j].entered_at, reason: reason, by: by || h[j].moved_by || '' };
          if (who === assignee) mine.push(r); else (other[String(who)] = other[String(who)] || []).push(r);
        }
        // A client change is an entry into Client Changes, or Changes straight from Client Review. Changes after
        // Client Changes is the same request, so it is not counted twice.
        if (inWeek(at) && ((cur === 'client_changes' && prev !== 'client_changes') || (cur === 'changes' && prev === 'client_review'))) bump(shown, holder(at), 'clientChanges');
        if (cur === 'rejected' && prev !== 'rejected' && inWeek(at)) bump(shown, holder(at), 'rejected');
      }
      if (passAt && inWeek(ms(passAt))) bump(shown, assignee, 'finished');

      var due = dueIso(p.deadline);
      if (!due) {
        var touched = inWeek(ms(p.created_at));
        for (j = 0; j < h.length && !touched; j++) if (inWeek(ms(h[j].entered_at))) touched = true;
        if (touched) bump(shown, assignee, 'noDeadline');
      }

      var title = String(p.title || '').trim() || 'Untitled';
      jobs.push({
        ref: 'V-' + p.id, title: title, assignee: assignee, dept: 'video',
        due: due, extension: null, state: state,
        submittedAt: submittedAt, approvedAt: passAt,
        rating: latestRating(ev, asOfMs), rejections: mine
      });
      for (var w in other) {
        jobs.push({
          ref: 'V-' + p.id + '-sb', title: title, assignee: num(w), dept: 'video',
          due: null, extension: null, state: 'in_progress',
          submittedAt: null, approvedAt: null, rating: null, rejections: other[w]
        });
      }
    }
    return { jobs: jobs, shown: shown };
  }

  g.TS_ADAPTER = { week: week, dueIso: dueIso, dayLabel: dayLabel, graphicJobs: graphicJobs, videoJobs: videoJobs, holderAt: holderAt };
})(typeof window !== 'undefined' ? window : globalThis);
