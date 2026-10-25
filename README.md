# Yang-Kedip-Bareng-Jodoh
Eleuh sia kumaha tah // I never win these types of game in Elementary school, and I don't do this with anyone so i built something that can play this game with me

A staring contest against a robot, your webcam watches your eyes, and whoever blinks first loses.
 HTML/CSS/JS with no build step (I have no clue how to do that) MediaPipe Face Landmarker is loaded as an ES module from a CDN

!!!all face tracking runs in your browser. No video or images leave your device!!!

## Run (locally)

ES modules and the camera need `http://localhost` or `https://` (and by that what i mean is that opening `index.html` via `file://` won't work)

```bash
python3 -m http.server 8000
```


## How does it work??

- how do this thing know if ur blinking? well, `EAR = (|p2−p6| + |p3−p5|) / (2·|p1−p4|)` per eye. cus of that, both eyes must stay below the threshold for at least 2 (consecutive) frames
- during the 3-2-1 countdown the game samples your open-eye EAR and sets the threshold to 75% of it (clamped to 0.12–0.24). Without enough samples it falls back to 0.20.
  the AI's blink time is drawn uniformly (ununiform is imposible lol) from the difficulty window (Easy 10–20 s, Medium 25–45 s, Hard 45–90 s), so the odds of blinking rise as the match goes on, it starts straining at 60% of its own time 
- if your face disappears or turns more than about 45° away, you get a 3-second warning, then you forfeit, cus thats cheating
- your best time is stored per difficulty in `localStorage`.

## Tuning!

All the knobs are in `CONFIG` at the top of `js/main.js` and in the `BlinkDetector` options in `js/ear.js`. Tick **Show face mesh** to see the eye landmarks, and open the browser console to see logged blink & values for calibrating it
