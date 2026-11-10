// Mixes a recorded voiceover over the walkthrough video, with the music turned down under it.
//   npm run video:voice -- path/to/your-recording.m4a
// Writes docs/fastlane-demo-voiced.mp4. Record the lines in docs/voiceover-script.txt as one
// file, starting your recording at 0:00 of the video. Needs ffmpeg.
const { execFileSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const { join } = require('node:path');

const voice = process.argv[2];
const video = join(__dirname, '..', 'docs', 'fastlane-demo.mp4');
const out = join(__dirname, '..', 'docs', 'fastlane-demo-voiced.mp4');
if (!voice || !existsSync(voice)) {
  console.error('Give the path to your recording: npm run video:voice -- path/to/recording.m4a');
  process.exit(1);
}
if (!existsSync(video)) {
  console.error('docs/fastlane-demo.mp4 is missing. Run "npm run video" first, or copy the video into docs/.');
  process.exit(1);
}
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-i', voice,
  '-filter_complex', '[0:a]volume=0.3[music];[1:a]aresample=44100,volume=1.6[voice];[music][voice]amix=inputs=2:duration=first:normalize=0[a]',
  '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out], { stdio: 'inherit' });
console.log('written:', out);
