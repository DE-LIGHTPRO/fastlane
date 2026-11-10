// Sums for the queue timer. Pure functions, no DOM, so they run under `node --test`.
//
// A session holds people = [{ n, note, joined, till, left }] (times in ms; till = reached the
// cashier, left = gave up) and counts = [{ at, queue, tills }].

export function formatDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const average = (values) => (values.length ? values.reduce((t, v) => t + v, 0) / values.length : 0);

export function queueStats(session) {
  const waits = session.people.filter((p) => p.till).map((p) => p.till - p.joined);
  const queues = session.counts.map((c) => c.queue);
  const tills = session.counts.map((c) => c.tills).filter((t) => t > 0);
  return {
    timed: waits.length,
    waiting: session.people.filter((p) => !p.till && !p.left).length,
    gaveUp: session.people.filter((p) => p.left).length,
    averageWait: average(waits),
    medianWait: median(waits),
    longestWait: waits.length ? Math.max(...waits) : 0,
    shortestWait: waits.length ? Math.min(...waits) : 0,
    averageQueue: average(queues),
    longestQueue: queues.length ? Math.max(...queues) : 0,
    averageTills: average(tills),
  };
}

// One sentence that can be quoted in a proposal, or '' when there is too little to say.
export function summaryLine(session) {
  const s = queueStats(session);
  if (s.timed < 3) return '';
  const mins = (ms) => Math.round(ms / 60000);
  let line = `We timed ${s.timed} shoppers: the average wait to reach a till was ${mins(s.averageWait)} minutes and the longest was ${mins(s.longestWait)} minutes.`;
  if (s.longestQueue) line += ` The queue reached ${s.longestQueue} people`;
  if (s.longestQueue && s.averageTills) line += ` with ${Math.round(s.averageTills)} tills open`;
  if (s.longestQueue) line += '.';
  if (s.gaveUp) line += ` ${s.gaveUp} of the people we followed left without reaching a till.`;
  return line;
}

export function queueCsv(session) {
  const esc = (v) => (/[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
  const iso = (ms) => (ms ? new Date(ms).toISOString() : '');
  const rows = [['type', 'place', 'person', 'note', 'joined', 'reached_till', 'left_queue', 'wait_seconds', 'time', 'people_in_queue', 'tills_open']];
  for (const p of session.people) {
    const end = p.till || p.left;
    rows.push(['person', session.place, p.n, p.note || '', iso(p.joined), iso(p.till), iso(p.left), end ? Math.round((end - p.joined) / 1000) : '', '', '', '']);
  }
  for (const c of session.counts) rows.push(['count', session.place, '', '', '', '', '', '', iso(c.at), c.queue, c.tills]);
  return rows.map((r) => r.map(esc).join(',')).join('\n') + '\n';
}
