"""Builds the soundtrack for the walkthrough video: a quiet music bed, a scanner beep for each
scan and a chime for each payment. Usage: make-audio.py events.json duration_seconds out.wav
events.json is a list of {"t": seconds, "type": "scan" | "paid"}.
"""
import json
import sys
import wave

import numpy as np

RATE = 44100
events_path, duration, out_path = sys.argv[1], float(sys.argv[2]), sys.argv[3]
n = int(duration * RATE)
t = np.arange(n) / RATE
left = np.zeros(n)
right = np.zeros(n)


def fade(length, attack, release):
    """An envelope that rises over `attack` seconds and falls over `release` seconds."""
    env = np.ones(length)
    a, r = min(int(attack * RATE), length // 2), min(int(release * RATE), length // 2)
    if a:
        env[:a] = np.sin(np.linspace(0, np.pi / 2, a)) ** 2
    if r:
        env[-r:] *= np.cos(np.linspace(0, np.pi / 2, r)) ** 2
    return env


# ---- Music bed: four slow, overlapping chords in a warm major key -----------------------
CHORDS = [
    [174.61, 220.00, 261.63, 329.63],  # F major 7
    [164.81, 196.00, 261.63, 329.63],  # C over E
    [146.83, 174.61, 220.00, 261.63],  # D minor 7
    [130.81, 196.00, 261.63, 293.66],  # C add 9
]
CHORD_SECONDS = 6.0
OVERLAP = 1.6
start = 0.0
index = 0
while start < duration:
    length = min(int((CHORD_SECONDS + OVERLAP) * RATE), n - int(start * RATE))
    if length <= 0:
        break
    tt = np.arange(length) / RATE
    env = fade(length, OVERLAP, OVERLAP)
    for note_number, freq in enumerate(CHORDS[index % len(CHORDS)]):
        level = 0.5 if note_number == 0 else 0.34  # the bass note carries a little more
        for channel, detune in ((left, 0.9985), (right, 1.0015)):  # slight detune gives width
            tone = np.sin(2 * np.pi * freq * detune * tt)
            tone += 0.22 * np.sin(2 * np.pi * 2 * freq * detune * tt)
            tone += 0.06 * np.sin(2 * np.pi * 3 * freq * detune * tt)
            sway = 1 - 0.08 * np.sin(2 * np.pi * 0.17 * tt + note_number)
            i0 = int(start * RATE)
            channel[i0:i0 + length] += level * tone * sway * env
    start += CHORD_SECONDS
    index += 1

bed_peak = max(np.abs(left).max(), np.abs(right).max()) or 1.0
bed_gain = 0.16 / bed_peak
left *= bed_gain
right *= bed_gain
master = fade(n, 1.5, 3.0)
left *= master
right *= master


# ---- Sound effects ----------------------------------------------------------------------
def add(at, samples, pan=0.0):
    i0 = int(at * RATE)
    if i0 < 0 or i0 >= n:
        return
    samples = samples[: n - i0]
    left[i0:i0 + len(samples)] += samples * (1 - max(0.0, pan))
    right[i0:i0 + len(samples)] += samples * (1 + min(0.0, pan))


def beep():
    length = int(0.09 * RATE)
    tt = np.arange(length) / RATE
    return 0.22 * np.sin(2 * np.pi * 1100 * tt) * fade(length, 0.004, 0.02)


def chime():
    length = int(0.9 * RATE)
    out = np.zeros(length + int(0.16 * RATE))
    for offset, freq in ((0.0, 659.25), (0.16, 880.0)):
        tt = np.arange(length) / RATE
        note = np.sin(2 * np.pi * freq * tt) + 0.3 * np.sin(2 * np.pi * 2 * freq * tt)
        note *= np.exp(-5.0 * tt) * fade(length, 0.004, 0.05)
        i0 = int(offset * RATE)
        out[i0:i0 + length] += 0.2 * note
    return out


for event in json.load(open(events_path)):
    if event["type"] == "scan":
        add(event["t"], beep())
    elif event["type"] == "paid":
        add(event["t"], chime())

peak = max(np.abs(left).max(), np.abs(right).max())
if peak > 0.9:
    left *= 0.9 / peak
    right *= 0.9 / peak
stereo = np.empty(2 * n, dtype=np.int16)
stereo[0::2] = (left * 32767).astype(np.int16)
stereo[1::2] = (right * 32767).astype(np.int16)
with wave.open(out_path, "wb") as f:
    f.setnchannels(2)
    f.setsampwidth(2)
    f.setframerate(RATE)
    f.writeframes(stereo.tobytes())
print("audio written:", out_path)
