// Camera scanning. Uses the browser's own BarcodeDetector where it exists
// (Chrome on Android) and the bundled ZXing build everywhere else (iPhone, desktop).
import { BarcodeDetector as BundledDetector, prepareZXingModule } from '../vendor/barcode-detector.js';

// The wasm file is served from this site, so scanning needs no outside network.
prepareZXingModule({
  overrides: {
    locateFile: (path, prefix) =>
      path.endsWith('.wasm') ? new URL('../vendor/zxing_reader.wasm', import.meta.url).href : prefix + path,
  },
});

export const PRODUCT_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'];
export const QR_FORMATS = ['qr_code'];

export async function createDetector(formats) {
  if ('BarcodeDetector' in globalThis) {
    try {
      const supported = await globalThis.BarcodeDetector.getSupportedFormats();
      if (formats.every((f) => supported.includes(f))) return new globalThis.BarcodeDetector({ formats });
    } catch { /* fall through to the bundled detector */ }
  }
  return new BundledDetector({ formats });
}

// Decode one still image (used by the tests and by the photo fallback).
export async function detectIn(source, formats) {
  const detector = await createDetector(formats);
  const found = await detector.detect(source);
  return found.map((f) => f.rawValue);
}

export function cameraProblem(err) {
  if (!navigator.mediaDevices?.getUserMedia) return 'This browser cannot open the camera. Type the barcode number instead.';
  if (err?.name === 'NotAllowedError') return 'Camera permission was refused. Allow the camera for this site, then try again.';
  if (err?.name === 'NotFoundError') return 'No camera was found on this device.';
  return 'The camera could not start. Type the barcode number instead.';
}

// Starts the back camera in `video` and calls onCode(text) for each code seen.
// Returns { stop, torch } where torch is null when the phone has no usable light,
// or an async function torch(on) that switches it.
export async function startCamera(video, onCode, formats) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('no-camera-api');
  const detector = await createDetector(formats);
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
  });
  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  await video.play();

  let stopped = false;
  let timer = 0;
  const tick = async () => {
    if (stopped) return;
    if (video.readyState >= 2 && video.videoWidth) {
      try {
        const found = await detector.detect(video);
        if (!stopped && found.length) onCode(found[0].rawValue);
      } catch { /* a bad frame is not an error worth showing */ }
    }
    timer = setTimeout(tick, 120);
  };
  tick();

  const track = stream.getVideoTracks()[0];
  let torch = null;
  try {
    if (track?.getCapabilities?.().torch) {
      torch = async (on) => {
        try {
          await track.applyConstraints({ advanced: [{ torch: on }] });
          return true;
        } catch { return false; }
      };
    }
  } catch { /* no torch on this device */ }

  return {
    torch,
    stop() {
      stopped = true;
      clearTimeout(timer);
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    },
  };
}

let audio;
export function beep(ok = true) {
  try {
    audio ||= new (globalThis.AudioContext || globalThis.webkitAudioContext)();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = ok ? 1100 : 280;
    gain.gain.value = 0.08;
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + (ok ? 0.09 : 0.25));
  } catch { /* sound is a nicety */ }
  try { navigator.vibrate?.(ok ? 50 : [80, 60, 80]); } catch { /* same */ }
}
