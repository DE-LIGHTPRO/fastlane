// Queue timer: follow a few shoppers from the back of the line to the till.
import { formatDuration, queueStats, summaryLine, queueCsv } from './queue-stats.js';
import { $, escapeHtml, toast, confirmDialog } from './ui.js';

const KEY = 'fastlane.queue';
let session = load();

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s && Array.isArray(s.people) && Array.isArray(s.counts)) return s;
  } catch { /* start clean */ }
  return { place: '', started: Date.now(), people: [], counts: [] };
}
function save() { localStorage.setItem(KEY, JSON.stringify(session)); }

function renderWaiting() {
  const waiting = session.people.filter((p) => !p.till && !p.left);
  $('#none-waiting').hidden = waiting.length > 0;
  $('#n-waiting').textContent = String(waiting.length);
  $('#waiting').innerHTML = waiting.map((p) => `
    <div class="card" data-person="${p.n}">
      <div class="order-head"><b>Person ${p.n}</b><span class="chip" data-clock="${p.joined}">${formatDuration(Date.now() - p.joined)}</span></div>
      <div class="field">
        <label for="note-${p.n}">How to spot them (optional)</label>
        <input type="text" id="note-${p.n}" data-note maxlength="40" autocomplete="off" placeholder="For example: red cap, two baskets" value="${escapeHtml(p.note || '')}">
      </div>
      <div class="row">
        <button class="btn" type="button" data-act="left">Left the queue</button>
        <button class="btn primary" type="button" data-act="till">Reached the till</button>
      </div>
    </div>`).join('');
}

function renderStats() {
  const s = queueStats(session);
  $('#s-timed').textContent = String(s.timed);
  $('#s-avg').textContent = formatDuration(s.averageWait);
  $('#s-max').textContent = formatDuration(s.longestWait);
  $('#s-med').textContent = formatDuration(s.medianWait);
  $('#s-left').textContent = String(s.gaveUp);
  $('#s-queue').textContent = String(s.longestQueue);
  const line = summaryLine(session);
  $('#summary').hidden = !line;
  $('#summary span').textContent = line;
  const last = session.counts.at(-1);
  if (last) {
    $('#last-count').textContent = `Last count at ${new Date(last.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}: ${last.queue} in the queue, ${last.tills} tills open. ${session.counts.length} saved.`;
  } else {
    $('#last-count').textContent = 'Take a count every 10 to 15 minutes.';
  }
}

function render() {
  renderWaiting();
  renderStats();
}

$('#place').value = session.place;
$('#place').addEventListener('input', (e) => { session.place = e.target.value.trim(); save(); });

$('#join').addEventListener('click', () => {
  const n = session.people.reduce((max, p) => Math.max(max, p.n), 0) + 1;
  session.people.push({ n, note: '', joined: Date.now(), till: 0, left: 0 });
  save();
  render();
  $(`#note-${n}`)?.focus();
});

$('#waiting').addEventListener('input', (e) => {
  if (!e.target.matches('[data-note]')) return;
  const person = session.people.find((p) => p.n === Number(e.target.closest('[data-person]').dataset.person));
  if (person) { person.note = e.target.value; save(); }
});

$('#waiting').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const person = session.people.find((p) => p.n === Number(btn.closest('[data-person]').dataset.person));
  if (!person) return;
  const now = Date.now();
  if (btn.dataset.act === 'till') {
    person.till = now;
    toast(`Person ${person.n} waited ${formatDuration(now - person.joined)}`);
  } else {
    person.left = now;
    toast(`Person ${person.n} left after ${formatDuration(now - person.joined)}`, 'warn');
  }
  save();
  render();
});

$('#count').addEventListener('click', () => {
  const queue = Number($('#c-queue').value);
  const tills = Number($('#c-tills').value || 0);
  if ($('#c-queue').value === '' || !Number.isInteger(queue) || queue < 0) {
    $('#c-queue').focus();
    return toast('Enter how many people are in the queue.', 'warn');
  }
  if (!Number.isInteger(tills) || tills < 0) {
    $('#c-tills').focus();
    return toast('Enter how many tills are open.', 'warn');
  }
  session.counts.push({ at: Date.now(), queue, tills });
  save();
  $('#c-queue').value = '';
  renderStats();
  toast('Count saved');
});

$('#export').addEventListener('click', () => {
  if (!session.people.length && !session.counts.length) return toast('Nothing recorded yet.', 'warn');
  const url = URL.createObjectURL(new Blob([queueCsv(session)], { type: 'text/csv' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `queue-times-${new Date(session.started).toISOString().slice(0, 10)}.csv` });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

$('#reset').addEventListener('click', async () => {
  const ok = await confirmDialog({ title: 'Start a new session?', body: 'Everything recorded so far is cleared from this phone. Download the file first.', confirm: 'Clear and start', danger: true });
  if (!ok) return;
  session = { place: '', started: Date.now(), people: [], counts: [] };
  save();
  $('#place').value = '';
  render();
  toast('New session started');
});

// The clocks tick without redrawing the cards, so a note being typed is never interrupted.
setInterval(() => {
  for (const el of document.querySelectorAll('[data-clock]')) el.textContent = formatDuration(Date.now() - Number(el.dataset.clock));
}, 1000);

render();
