// Wires up a camera panel: open button, torch button, hint and error note.
// Markup contract (ids are scoped by the root element):
//   [data-cam="video"] [data-cam="frame"] [data-cam="idle"] [data-cam="open"]
//   [data-cam="torch"] [data-cam="hint"] and a sibling note passed as `note`.
import { startCamera, cameraProblem } from './scanner.js';

export function cameraPanel(root, { formats, onCode, note }) {
  const part = (name) => root.querySelector(`[data-cam="${name}"]`);
  let session = null;
  let torchOn = false;

  async function open() {
    if (session) return;
    note.hidden = true;
    try {
      session = await startCamera(part('video'), onCode, formats);
    } catch (err) {
      note.querySelector('span').textContent = cameraProblem(err);
      note.hidden = false;
      return;
    }
    part('idle').hidden = true;
    part('frame').hidden = false;
    part('hint').hidden = false;
    torchOn = false;
    const torch = part('torch');
    torch.hidden = !session.torch;
    torch.setAttribute('aria-pressed', 'false');
  }

  function close() {
    session?.stop();
    session = null;
    part('idle').hidden = false;
    part('frame').hidden = true;
    part('hint').hidden = true;
    part('torch').hidden = true;
  }

  part('open').addEventListener('click', open);
  part('torch').addEventListener('click', async () => {
    if (!session?.torch) return;
    if (await session.torch(!torchOn)) {
      torchOn = !torchOn;
      part('torch').setAttribute('aria-pressed', String(torchOn));
    }
  });
  // Phones stop the camera when the page is hidden; release it cleanly.
  document.addEventListener('visibilitychange', () => { if (document.hidden) close(); });

  return { open, close, get active() { return !!session; } };
}
