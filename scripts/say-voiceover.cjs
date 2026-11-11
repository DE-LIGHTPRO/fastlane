// Adds a computer-spoken voiceover to the walkthrough video, using the voices built into macOS.
//   npm run video:say                       (picks the best English voice installed)
//   npm run video:say -- "Daniel (Enhanced)" (or name the voice yourself)
// Reads docs/voiceover-script.txt and docs/fastlane-demo.mp4, writes docs/fastlane-demo-voiced.mp4.
// Needs a Mac (for the `say` command) and ffmpeg. Better voices can be downloaded in
// System Settings > Accessibility > Spoken Content > System Voice > Manage Voices.
const { execFileSync } = require('node:child_process');
const { existsSync, readFileSync, mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const docs = join(__dirname, '..', 'docs');
const video = join(docs, 'fastlane-demo.mp4');
const scriptFile = join(docs, 'voiceover-script.txt');
const out = join(docs, 'fastlane-demo-voiced.mp4');
const fail = (message) => { console.error(message); process.exit(1); };
const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const has = (cmd) => { try { run('which', [cmd]); return true; } catch { return false; } };

if (!has('say')) fail('This needs the "say" command, which only exists on a Mac.');
if (!has('ffmpeg')) fail('ffmpeg is not installed. Install it with: brew install ffmpeg');
if (!existsSync(video)) fail('docs/fastlane-demo.mp4 is missing. Copy the video into the docs folder first.');
if (!existsSync(scriptFile)) fail('docs/voiceover-script.txt is missing.');

// Each line of the script looks like "[1:13] (label)" followed by the words to speak.
const lines = [];
const text = readFileSync(scriptFile, 'utf8').split('\n');
for (let i = 0; i < text.length; i++) {
  const m = /^\[(\d+):(\d\d)\]/.exec(text[i]);
  if (m && text[i + 1]?.trim()) lines.push({ at: Number(m[1]) * 60 + Number(m[2]), say: text[i + 1].trim() });
}
if (!lines.length) fail('No timed lines were found in docs/voiceover-script.txt.');
const length = Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video]));

// Natural-sounding voices first; the older built-in ones are the fallback.
const installed = run('say', ['-v', '?']).split('\n').map((l) => l.split(/\s{2,}/)[0].trim()).filter(Boolean);
const preferred = ['Ava (Premium)', 'Zoe (Premium)', 'Jamie (Premium)', 'Evan (Enhanced)', 'Ava (Enhanced)', 'Zoe (Enhanced)',
  'Daniel (Enhanced)', 'Samantha (Enhanced)', 'Karen (Enhanced)', 'Daniel', 'Samantha', 'Karen', 'Alex'];
const voice = process.argv[2] || preferred.find((v) => installed.includes(v)) || 'Samantha';
if (process.argv[2] && !installed.includes(voice)) fail(`The voice "${voice}" is not installed. Installed voices include: ${installed.slice(0, 12).join(', ')}`);
console.log('Voice:', voice);

const dir = mkdtempSync(join(tmpdir(), 'fastlane-voice-'));
const clips = lines.map((line, i) => {
  const gap = (i + 1 < lines.length ? lines[i + 1].at : length) - line.at - 0.4;
  const file = join(dir, `line-${i}.aiff`);
  let rate = 172; // words per minute
  let seconds = 0;
  // Speak the line; if it runs past the next caption, speak it again a little faster.
  for (let attempt = 0; attempt < 4; attempt++) {
    run('say', ['-v', voice, '-r', String(rate), '-o', file, line.say]);
    seconds = Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]));
    if (seconds <= gap || rate >= 230) break;
    rate = Math.min(230, Math.ceil(rate * (seconds / gap) * 1.03));
  }
  if (seconds > gap + 0.4) console.warn(`  Line at ${line.at}s runs ${(seconds - gap).toFixed(1)}s over; it will overlap the next one slightly.`);
  return { file, at: line.at };
});

const inputs = ['-i', video];
for (const c of clips) inputs.push('-i', c.file);
const delayed = clips.map((c, i) => `[${i + 1}:a]aresample=44100,aformat=channel_layouts=stereo,adelay=${Math.round(c.at * 1000) + 350}:all=1,volume=1.5[v${i}]`);
const mix = `[0:a]volume=0.28[music];${delayed.join(';')};[music]${clips.map((_, i) => `[v${i}]`).join('')}amix=inputs=${clips.length + 1}:duration=first:normalize=0[a]`;
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', mix, '-map', '0:v', '-map', '[a]',
  '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out], { stdio: 'inherit' });
console.log(`Written: ${out} (${lines.length} lines spoken)`);
