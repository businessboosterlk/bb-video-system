(function (g) {
  'use strict';

  function T(iso) {
    return Date.parse(iso);
  }

  function dayKey(ms) {
    return Math.floor((ms + 5.5 * 3600e3) / 86400e3);
  }

  function effectiveDue(job) {
    if (job.extension) {
      return T(job.extension.to);
    }
    return T(job.due);
  }

  function derivedState(job, nowMs) {
    if (job.state === 'cancelled') {
      return 'cancelled';
    }
    if (job.state === 'approved') {
      return 'completed';
    }
    if (job.state === 'submitted') {
      return 'awaiting';
    }
    if (effectiveDue(job) < nowMs) {
      return 'overdue';
    }
    if (job.state === 'blocked') {
      return 'blocked';
    }
    return job.state;
  }

  function inCohort(job, seed, nowMs) {
    if (job.state === 'cancelled') {
      return false;
    }
    return T(seed.periodStart) <= effectiveDue(job) && effectiveDue(job) <= nowMs;
  }

  function refNext(jobs) {
    var highest = 0;
    for (var i = 0; i < jobs.length; i++) {
      var num = parseInt(jobs[i].ref.slice(-4), 10);
      if (num > highest) {
        highest = num;
      }
    }
    var next = highest + 1;
    var padded = String(next);
    while (padded.length < 4) {
      padded = '0' + padded;
    }
    return 'MM-2026-' + padded;
  }

  function score(seed, jobs, nowMs, filter) {
    var matching = [];
    for (var i = 0; i < jobs.length; i++) {
      var job = jobs[i];
      var matches = true;
      if (filter) {
        if (filter.dept) {
          matches = job.dept === filter.dept;
        } else if (filter.emp) {
          matches = job.assignee === filter.emp;
        }
      }
      if (matches) {
        matching.push(job);
      }
    }

    var cohortJobs = [];
    for (var j = 0; j < matching.length; j++) {
      if (inCohort(matching[j], seed, nowMs)) {
        cohortJobs.push(matching[j]);
      }
    }

    var completedJobs = [];
    for (var k = 0; k < cohortJobs.length; k++) {
      if (cohortJobs[k].state === 'approved') {
        completedJobs.push(cohortJobs[k]);
      }
    }

    var ontimeJobs = [];
    for (var l = 0; l < completedJobs.length; l++) {
      if (T(completedJobs[l].submittedAt) <= effectiveDue(completedJobs[l])) {
        ontimeJobs.push(completedJobs[l]);
      }
    }

    function inPeriod(at) {
      if (!at) {
        return false;
      }
      return T(seed.periodStart) <= T(at) && T(at) <= nowMs;
    }

    var qualityEvents = [];
    for (var m = 0; m < matching.length; m++) {
      var currentJob = matching[m];
      if (currentJob.rating && inPeriod(currentJob.rating.at)) {
        qualityEvents.push({
          kind: 'rating',
          ref: currentJob.ref,
          stars: currentJob.rating.stars,
          pts: currentJob.rating.stars * 20
        });
      }
      for (var n = 0; n < currentJob.rejections.length; n++) {
        var r = currentJob.rejections[n];
        if (inPeriod(r.at)) {
          qualityEvents.push({
            kind: 'rejection',
            ref: currentJob.ref,
            reason: r.reason,
            minus: 5
          });
        }
      }
    }

    var ratings = [];
    var rejections = [];
    for (var p = 0; p < qualityEvents.length; p++) {
      if (qualityEvents[p].kind === 'rating') {
        ratings.push(qualityEvents[p]);
      } else {
        rejections.push(qualityEvents[p]);
      }
    }

    var ratingAvgPct = null;
    if (ratings.length > 0) {
      var sum = 0;
      for (var q = 0; q < ratings.length; q++) {
        sum += ratings[q].pts;
      }
      ratingAvgPct = sum / ratings.length;
    }

    var qualityPct = null;
    if (ratingAvgPct !== null) {
      qualityPct = Math.max(0, ratingAvgPct - 5 * rejections.length);
    }

    var completionPct = null;
    if (cohortJobs.length > 0) {
      completionPct = completedJobs.length / cohortJobs.length * 100;
    }

    var ontimePct = null;
    if (completedJobs.length > 0) {
      ontimePct = ontimeJobs.length / completedJobs.length * 100;
    }

    var overall = null;
    if (completionPct !== null && ontimePct !== null && qualityPct !== null) {
      overall = 0.5 * completionPct + 0.3 * ontimePct + 0.2 * qualityPct;
    }

    var cancelledExcluded = 0;
    for (var s = 0; s < matching.length; s++) {
      if (matching[s].state === 'cancelled') {
        cancelledExcluded++;
      }
    }

    var rows = [];
    for (var t = 0; t < cohortJobs.length; t++) {
      var cj = cohortJobs[t];
      var row = {
        ref: cj.ref,
        title: cj.title,
        assignee: cj.assignee,
        state: derivedState(cj, nowMs),
        due: effectiveDue(cj),
        extended: !!cj.extension,
        counted: cj.state === 'approved',
        ontime: null,
        stars: cj.rating ? cj.rating.stars : null,
        rejections: cj.rejections.length
      };
      if (cj.state === 'approved') {
        row.ontime = T(cj.submittedAt) <= effectiveDue(cj);
      }
      rows.push(row);
    }

    return {
      cohort: cohortJobs.length,
      completed: completedJobs.length,
      completionPct: completionPct,
      ontimeN: ontimeJobs.length,
      ontimeD: completedJobs.length,
      ontimePct: ontimePct,
      ratingCount: ratings.length,
      ratingAvgPct: ratingAvgPct,
      rejectionCount: rejections.length,
      qualityPct: qualityPct,
      overall: overall,
      cancelledExcluded: cancelledExcluded,
      qualityEvents: qualityEvents,
      rows: rows
    };
  }

  function bandFor(overall, excellentMin) {
    if (overall === null) {
      return { key: 'na', label: 'Not measurable' };
    }
    var o = Math.round(overall);
    if (o >= excellentMin) {
      return { key: 'excellent', label: 'Excellent' };
    }
    if (o >= 80) {
      return { key: 'verygood', label: 'Very Good' };
    }
    if (o >= 70) {
      return { key: 'satisfactory', label: 'Satisfactory' };
    }
    if (o >= 60) {
      return { key: 'needswork', label: 'Needs Improvement' };
    }
    return { key: 'poor', label: 'Poor' };
  }

  function counts(seed, jobs, nowMs) {
    var total = 0;
    var overdue = 0;
    var awaiting = 0;
    var dueToday = 0;
    var dueTomorrow = 0;
    var completed = 0;
    var inProgress = 0;
    var cancelled = 0;

    for (var i = 0; i < jobs.length; i++) {
      var job = jobs[i];
      total++;
      if (job.state === 'cancelled') {
        cancelled++;
        continue;
      }
      if (job.state === 'approved') {
        completed++;
        continue;
      }
      if (job.state === 'submitted') {
        awaiting++;
        continue;
      }
      if (effectiveDue(job) < nowMs) {
        overdue++;
        continue;
      }
      if (dayKey(effectiveDue(job)) === dayKey(nowMs) && effectiveDue(job) >= nowMs) {
        dueToday++;
      }
      if (dayKey(effectiveDue(job)) === dayKey(nowMs) + 1) {
        dueTomorrow++;
      }
    }
    for (var p = 0; p < jobs.length; p++) {
      if (jobs[p].state === 'in_progress') inProgress++;
    }

    return {
      total: total,
      overdue: overdue,
      awaiting: awaiting,
      dueToday: dueToday,
      dueTomorrow: dueTomorrow,
      completed: completed,
      inProgress: inProgress,
      cancelled: cancelled
    };
  }

  function myDay(seed, jobs, nowMs, empId) {
    var mine = [];
    for (var i = 0; i < jobs.length; i++) {
      var job = jobs[i];
      if (job.assignee === empId && job.state !== 'cancelled' && job.state !== 'approved' && job.state !== 'submitted') {
        mine.push(job);
      }
    }

    var returned = [];
    var rest = [];
    for (var j = 0; j < mine.length; j++) {
      if (mine[j].rejections.length > 0) {
        returned.push(mine[j]);
      } else {
        rest.push(mine[j]);
      }
    }

    var dueToday = [];
    var overdue = [];
    for (var k = 0; k < rest.length; k++) {
      var rj = rest[k];
      if (dayKey(effectiveDue(rj)) === dayKey(nowMs) && effectiveDue(rj) >= nowMs) {
        dueToday.push(rj);
      }
      if (effectiveDue(rj) < nowMs) {
        overdue.push(rj);
      }
    }

    return {
      dueToday: dueToday,
      overdue: overdue,
      returned: returned
    };
  }

  function brief(seed, jobs, nowMs) {
    var c = counts(seed, jobs, nowMs);

    var approvedYesterday = 0;
    for (var i = 0; i < jobs.length; i++) {
      var job = jobs[i];
      if (job.state === 'approved' && dayKey(T(job.approvedAt)) === dayKey(nowMs) - 1) {
        approvedYesterday++;
      }
    }

    var worst = null;
    for (var d = 0; d < seed.departments.length; d++) {
      var dept = seed.departments[d];
      var deptScore = score(seed, jobs, nowMs, { dept: dept.key });
      if (deptScore.overall !== null) {
        if (worst === null || deptScore.overall < worst.overall) {
          worst = {
            key: dept.key,
            name: dept.name,
            overall: deptScore.overall
          };
        }
      }
    }

    return {
      overdue: c.overdue,
      awaiting: c.awaiting,
      approvedYesterday: approvedYesterday,
      worst: worst
    };
  }

  g.MM_ENGINE = {
    T: T,
    dayKey: dayKey,
    effectiveDue: effectiveDue,
    derivedState: derivedState,
    inCohort: inCohort,
    refNext: refNext,
    score: score,
    bandFor: bandFor,
    counts: counts,
    myDay: myDay,
    brief: brief
  };
})(typeof window !== 'undefined' ? window : globalThis);
