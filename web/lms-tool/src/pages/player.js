'use strict';

const { page, escapeHtml, inlineJson } = require('./layout');

const PLAYER_CSS = `
  .progress-track { height: 8px; background: var(--border); border-radius: 999px; overflow: hidden; margin: 12px 0 20px; }
  .progress-fill { height: 100%; background: var(--accent); border-radius: 999px; transition: width .25s ease; }
  .option {
    display: block; width: 100%; text-align: left; margin: 8px 0; padding: 14px 16px;
    border: 2px solid var(--border); border-radius: 10px; background: var(--card);
    font-size: 1rem; cursor: pointer; color: var(--ink);
  }
  .option:hover { border-color: #c7d2fe; }
  .option.selected { border-color: var(--accent); background: #eef2ff; font-weight: 600; }
  .nav-row { display: flex; justify-content: space-between; margin-top: 20px; gap: 8px; }
  .qnum { font-size: .85rem; color: var(--muted); font-weight: 600; }
  .grid { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0; }
  .grid-cell {
    width: 42px; height: 42px; display: flex; align-items: center; justify-content: center;
    border: 2px solid var(--border); border-radius: 8px; cursor: pointer; font-weight: 600; font-size: .9rem;
  }
  .grid-cell.answered { border-color: var(--ok); background: #ecfdf5; }
  .grid-cell.blank { border-color: var(--warn); background: #fffbeb; }
  .score-big { font-size: 2.4rem; font-weight: 800; margin: 8px 0; }
  .bd-item { border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; margin: 10px 0; }
  .bd-item.right { border-left: 4px solid var(--ok); }
  .bd-item.wrong { border-left: 4px solid var(--err); }
  .bd-label { font-size: .8rem; font-weight: 700; }
  .bd-item.right .bd-label { color: var(--ok); }
  .bd-item.wrong .bd-label { color: var(--err); }
  .explanation { font-size: .88rem; color: var(--muted); margin-top: 6px; }
  .question-media { display:flex; flex-wrap:wrap; gap:10px; margin:12px 0; }
  .question-media img { max-width:100%; max-height:360px; object-fit:contain; border-radius:8px; }
  .screen { display: none; }
  .screen.active { display: block; }
`;

const PLAYER_JS = `
(function () {
  'use strict';
  var cfg = window.__QV_CONFIG__;
  var answers = {}; // question_id -> selected_index
  var current = 0;

  function $(id) { return document.getElementById(id); }
  function show(name) {
    ['pre', 'question', 'review', 'results'].forEach(function (s) {
      $('screen-' + s).classList.toggle('active', s === name);
    });
  }
  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }
  function answeredCount() {
    return cfg.questions.filter(function (q) { return answers[q.question_id] !== undefined; }).length;
  }

  function renderQuestion() {
    var q = cfg.questions[current];
    $('qnum').textContent = 'Question ' + (current + 1) + ' of ' + cfg.questions.length;
    $('progress-fill').style.width = Math.round(((current + 1) / cfg.questions.length) * 100) + '%';
    $('qtext').textContent = q.text;
    var media = $('qmedia');
    media.innerHTML = '';
    (q.images || []).forEach(function (image) {
      var img = document.createElement('img');
      img.src = image.url;
      img.alt = image.alt || 'Question image';
      img.loading = 'lazy';
      media.appendChild(img);
    });

    var box = $('options');
    box.innerHTML = '';
    q.options.forEach(function (opt, oi) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'option' + (answers[q.question_id] === oi ? ' selected' : '');
      b.textContent = String.fromCharCode(65 + oi) + '.  ' + opt;
      b.onclick = function () {
        answers[q.question_id] = oi;
        renderQuestion();
      };
      box.appendChild(b);
    });

    $('btn-prev').disabled = current === 0;
    $('btn-next').textContent = current === cfg.questions.length - 1 ? 'Review answers' : 'Next';
  }

  function renderReview() {
    $('review-summary').textContent = answeredCount() + ' of ' + cfg.questions.length + ' answered';
    var grid = $('review-grid');
    grid.innerHTML = '';
    cfg.questions.forEach(function (q, i) {
      var c = document.createElement('div');
      c.className = 'grid-cell ' + (answers[q.question_id] !== undefined ? 'answered' : 'blank');
      c.textContent = i + 1;
      c.title = q.text;
      c.onclick = function () { current = i; renderQuestion(); show('question'); };
      grid.appendChild(c);
    });
  }

  function setChip(status, detail) {
    var chip = $('sync-chip');
    var map = {
      synced: ['ok', 'Synced to LMS \\u2713'],
      pending: ['pending', 'Syncing\\u2026'],
      failed: ['err', 'Grade sync failed \\u2014 will retry server-side'],
      skipped: ['warn', 'No gradebook line item (ungraded launch)']
    };
    var m = map[status] || map.pending;
    chip.className = 'chip ' + m[0];
    chip.textContent = m[1];
    if (detail) chip.title = detail;
  }

  function submit() {
    $('btn-submit').disabled = true;
    $('btn-submit').textContent = 'Submitting\\u2026';
    var payload = {
      pack_id: cfg.packId,
      answers: cfg.questions.map(function (q) {
        return { question_id: q.question_id, selected_index: answers[q.question_id] !== undefined ? answers[q.question_id] : -1 };
      })
    };
    fetch('/api/attempt/submit?ltik=' + encodeURIComponent(cfg.ltik), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) {
      if (!r.ok) return r.json().then(function (e) { throw new Error(e.message || ('HTTP ' + r.status)); });
      return r.json();
    }).then(function (result) {
      renderResults(result);
      show('results');
    }).catch(function (err) {
      $('btn-submit').disabled = false;
      $('btn-submit').textContent = 'Submit quiz';
      alert('Submit failed: ' + err.message);
    });
  }

  function renderResults(result) {
    var pct = result.score_maximum > 0 ? Math.round((result.score_given / result.score_maximum) * 100) : 0;
    $('score-line').textContent = result.score_given + ' / ' + result.score_maximum + ' points';
    $('score-pct').textContent = pct + '%';
    setChip(result.grade_sync && result.grade_sync.status, result.grade_sync && result.grade_sync.detail);

    var box = $('breakdown');
    box.innerHTML = '';
    (result.breakdown || []).forEach(function (b, i) {
      var q = cfg.questions.filter(function (x) { return x.question_id === b.question_id; })[0];
      if (!q) return;
      var div = document.createElement('div');
      div.className = 'bd-item ' + (b.correct ? 'right' : 'wrong');
      var yourAnswer = b.selected_index >= 0 ? q.options[b.selected_index] : '(no answer)';
      var correctAnswer = q.options[b.correct_index];
      div.innerHTML =
        '<div class="bd-label">' + (b.correct ? 'Correct' : 'Incorrect') + ' \\u00b7 Q' + (i + 1) + '</div>' +
        '<div>' + esc(q.text) + '</div>' +
        '<div class="explanation">Your answer: ' + esc(yourAnswer) +
        (b.correct ? '' : ' \\u00b7 Correct answer: ' + esc(correctAnswer)) + '</div>' +
        (b.explanation ? '<div class="explanation">' + esc(b.explanation) + '</div>' : '');
      box.appendChild(div);
    });
  }

  // wire up
  $('btn-start').onclick = function () { current = 0; renderQuestion(); show('question'); };
  $('btn-prev').onclick = function () { if (current > 0) { current -= 1; renderQuestion(); } };
  $('btn-next').onclick = function () {
    if (current < cfg.questions.length - 1) { current += 1; renderQuestion(); }
    else { renderReview(); show('review'); }
  };
  $('btn-back-to-quiz').onclick = function () { current = 0; renderQuestion(); show('question'); };
  $('btn-submit').onclick = submit;
  var ret = $('btn-return');
  if (ret) ret.onclick = function () { window.top.location.href = cfg.returnUrl; };

  show('pre');
})();
`;

/**
 * @param {object} p { ltik, studentName, packId, title, questions[], scoreMaximum, hasLineItem, returnUrl, nakamaStatus }
 */
function renderPlayer(p) {
  const cfg = {
    ltik: p.ltik,
    packId: p.packId,
    questions: p.questions, // sanitized upstream: no correct_index
    returnUrl: p.returnUrl || '',
  };
  const anyMocked = Object.values(p.nakamaStatus.rpcs).includes('mocked');

  const body = `
<div class="card">
  <div id="screen-pre" class="screen active">
    <h1>${escapeHtml(p.title)}</h1>
    ${p.studentName ? `<p class="muted">Welcome, ${escapeHtml(p.studentName)}</p>` : ''}
    <table>
      <tr><th>Questions</th><td>${p.questions.length}</td></tr>
      <tr><th>Points possible</th><td>${p.scoreMaximum}</td></tr>
      <tr><th>Grade sync</th><td>${p.hasLineItem ? 'Automatic (sent to your LMS gradebook)' : 'Ungraded preview (no line item on this launch)'}</td></tr>
    </table>
    <p style="margin-top:20px"><button class="primary" id="btn-start">Start quiz</button></p>
    ${anyMocked ? '<p class="muted" style="font-size:.8rem">Note: some backend calls are running against a local mock (Nakama lms-bridge integration pending).</p>' : ''}
  </div>

  <div id="screen-question" class="screen">
    <div class="qnum" id="qnum"></div>
    <div class="progress-track"><div class="progress-fill" id="progress-fill" style="width:0%"></div></div>
    <h2 id="qtext"></h2>
    <div class="question-media" id="qmedia"></div>
    <div id="options"></div>
    <div class="nav-row">
      <button class="ghost" id="btn-prev">Previous</button>
      <button class="primary" id="btn-next">Next</button>
    </div>
  </div>

  <div id="screen-review" class="screen">
    <h1>Review your answers</h1>
    <p class="muted" id="review-summary"></p>
    <div class="grid" id="review-grid"></div>
    <div class="nav-row">
      <button class="ghost" id="btn-back-to-quiz">Back to quiz</button>
      <button class="primary" id="btn-submit">Submit quiz</button>
    </div>
  </div>

  <div id="screen-results" class="screen">
    <h1>Results</h1>
    <div class="score-big" id="score-pct"></div>
    <p class="muted" id="score-line"></p>
    <p><span class="chip pending" id="sync-chip">Syncing\u2026</span></p>
    <h2 style="margin-top:20px">Question breakdown</h2>
    <div id="breakdown"></div>
    ${p.returnUrl ? '<p style="margin-top:16px"><button class="ghost" id="btn-return">Back to course</button></p>' : ''}
  </div>
</div>`;

  const script = `window.__QV_CONFIG__ = ${inlineJson(cfg)};\n${PLAYER_JS}`;
  return page(p.title + ' — QuizVerse', body, PLAYER_CSS, script);
}

module.exports = { renderPlayer };
