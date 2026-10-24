// Don't Blink! – staring contest vs. an AI.
// No build step: MediaPipe is loaded as an ES module straight from a CDN.
import {
  FaceLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

import { EYES, eyeEAR, headTurn, BlinkDetector } from "./ear.js";
import { Avatar } from "./avatar.js";
import { sfx, setMuted } from "./sound.js";

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */
const WASM_URL  = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const CONFIG = {
  // Seconds the AI can last. The blink time is drawn uniformly from this window,
  // which means the chance of blinking "right now" rises the longer the match goes.
  difficulty: {
    easy:   { min: 10, max: 20 },
    medium: { min: 25, max: 45 },
    hard:   { min: 45, max: 90 },
  },
  countdownMs: 3000,
  faceLostGraceMs: 3000,
  maxHeadTurn: 0.5,        // ≈45° (see headTurn() in ear.js)
  minCalibrationSamples: 10,
  squintStartsAt: 0.6,     // AI starts straining at 60% of its own blink time
  tauntEveryMs: 7000,
};

/* ------------------------------------------------------------------ */
/* DOM                                                                 */
/* ------------------------------------------------------------------ */
const $ = (id) => document.getElementById(id);
const video = $("video");
const overlay = $("overlay");
const octx = overlay.getContext("2d");
const camFrame = $("camFrame");
const camPlaceholder = $("camPlaceholder");
const hud = $("hud");
const countdownEl = $("countdown");
const timerEl = $("timer");
const statusEl = $("status");
const startBtn = $("startBtn");
const diffSelect = $("difficulty");
const debugToggle = $("debugToggle");
const hideCamToggle = $("hideCamToggle");
const muteToggle = $("muteToggle");
const banner = $("banner");
const bestTimeEl = $("bestTime");
const bestDiffNameEl = $("bestDiffName");
const recordEl = $("record");

const avatar = new Avatar($("avatar"), $("bubble"));
const detector = new BlinkDetector({ defaultThreshold: 0.20, minFrames: 2 });

/* ------------------------------------------------------------------ */
/* Stats (localStorage, always wrapped – it can be blocked)            */
/* ------------------------------------------------------------------ */
const STORE_KEY = "dontblink.v1";

function loadStats() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && typeof s === "object") return { best: {}, wins: 0, losses: 0, ...s };
  } catch { /* ignore */ }
  return { best: {}, wins: 0, losses: 0 };
}
function saveStats() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(stats)); } catch { /* ignore */ }
}
const stats = loadStats();

function fmt(ms, decimals = 3) {
  const total = Math.max(0, ms);
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const frac = String(Math.floor(total % 1000)).padStart(3, "0").slice(0, decimals);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${frac}`;
}

function renderStats() {
  const d = diffSelect.value;
  bestDiffNameEl.textContent = d;
  bestTimeEl.textContent = stats.best[d] ? fmt(stats.best[d], 1) : "–";
  recordEl.textContent = `${stats.wins} W · ${stats.losses} L`;
}

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */
let landmarker = null;
let stream = null;
let rafId = 0;
let lastVideoTime = -1;

// phase: loading | idle | countdown | playing | over
let phase = "loading";
let countdownStart = 0;
let lastCountdownNumber = 0;
let matchStart = 0;
let aiBlinkAt = 0;        // ms after matchStart
let faceLostAt = null;    // timestamp when the face was lost, or null
let lastWarnSecond = -1;
let lastTauntAt = 0;
let face = { landmarks: null, ok: false, earL: 0, earR: 0, turn: 0 };

/* ------------------------------------------------------------------ */
/* UI helpers                                                          */
/* ------------------------------------------------------------------ */
function setStatus(text, warn = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("warn", warn);
}

function setHud(text, cls = "") {
  hud.textContent = text;
  hud.className = `hud ${cls}`.trim();
}

function showBanner(text, kind) {
  banner.textContent = text;
  banner.className = `banner ${kind}`;
  banner.hidden = false;
}
function hideBanner() { banner.hidden = true; }

/* ------------------------------------------------------------------ */
/* Model + camera                                                      */
/* ------------------------------------------------------------------ */
async function initLandmarker() {
  try {
    const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
    const make = (delegate) => FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: "VIDEO",
      numFaces: 1,
    });
    try {
      landmarker = await make("GPU");
    } catch (gpuErr) {
      console.warn("GPU delegate unavailable, falling back to CPU", gpuErr);
      landmarker = await make("CPU");
    }
    phase = "idle";
    startBtn.disabled = false;
    setStatus("Ready. Press Start, allow the camera, and keep your eyes open.");
  } catch (err) {
    console.error(err);
    setStatus("Couldn't load the face-tracking model. Check your connection and reload the page.", true);
  }
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser can't access a camera (are you on https or localhost?).");
  }
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  if (!video.videoWidth) {
    await new Promise((resolve) => video.addEventListener("loadedmetadata", resolve, { once: true }));
  }
  overlay.width = video.videoWidth;
  overlay.height = video.videoHeight;
  video.classList.add("live");
  camFrame.classList.add("has-cam");
  if (!rafId) rafId = requestAnimationFrame(loop);
}

function cameraErrorMessage(err) {
  switch (err?.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Camera access was blocked. Allow it in your browser's site settings, then press Start again.";
    case "NotFoundError":
      return "No camera found. Connect one and press Start again.";
    case "NotReadableError":
      return "The camera is in use by another app. Close it and press Start again.";
    default:
      return err?.message || "Couldn't start the camera.";
  }
}

/* ------------------------------------------------------------------ */
/* Main loop                                                           */
/* ------------------------------------------------------------------ */
function loop() {
  rafId = requestAnimationFrame(loop);
  const now = performance.now();

  // Only run detection when the webcam delivered a new frame.
  if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const result = landmarker.detectForVideo(video, now);
    handleFrame(result.faceLandmarks?.[0] ?? null, now);
  }
  tickGame(now);
}

function handleFrame(landmarks, now) {
  const w = video.videoWidth, h = video.videoHeight;
  face = { landmarks, ok: false, earL: 0, earR: 0, turn: 0 };

  if (landmarks) {
    face.earL = eyeEAR(landmarks, EYES.left, w, h);
    face.earR = eyeEAR(landmarks, EYES.right, w, h);
    face.turn = headTurn(landmarks);
    face.ok = face.turn <= CONFIG.maxHeadTurn;
  }

  if (phase === "countdown") {
    if (face.ok) detector.addSample((face.earL + face.earR) / 2);
  } else if (face.ok) {
    const blinkEvent = detector.update(face.earL, face.earR);
    if (blinkEvent) console.log("blink", { earL: face.earL.toFixed(3), earR: face.earR.toFixed(3), threshold: detector.threshold.toFixed(3) });
    if (blinkEvent && phase === "playing") endMatch("lose", now);
  }

  if (phase === "playing") {
    if (!face.ok) { if (faceLostAt === null) faceLostAt = now; }
    else faceLostAt = null;
  }

  updateHud();
  drawOverlay();
}

function updateHud() {
  if (!landmarks()) return setHud("No face", "warn");
  if (!face.ok) return setHud("Turn back to the camera", "warn");
  const ear = ((face.earL + face.earR) / 2).toFixed(2);
  if (detector.closed) setHud(`EAR ${ear} · blink`, "warn");
  else setHud(`EAR ${ear} · eyes open`, "ok");
}
const landmarks = () => face.landmarks;

function drawOverlay() {
  octx.clearRect(0, 0, overlay.width, overlay.height);
  if (!debugToggle.checked || !face.landmarks) return;
  const w = overlay.width, h = overlay.height;

  octx.fillStyle = "rgba(255,255,255,0.55)";
  for (const p of face.landmarks) {
    octx.fillRect(p.x * w - 0.75, p.y * h - 0.75, 1.5, 1.5);
  }
  octx.fillStyle = detector.closed ? "#e0301f" : "#f4c02e";
  for (const idx of [...EYES.left, ...EYES.right]) {
    const p = face.landmarks[idx];
    octx.beginPath();
    octx.arc(p.x * w, p.y * h, 3, 0, Math.PI * 2);
    octx.fill();
  }
}

/* ------------------------------------------------------------------ */
/* Game flow                                                           */
/* ------------------------------------------------------------------ */
function pickAiBlinkTime(difficulty) {
  const { min, max } = CONFIG.difficulty[difficulty];
  return (min + Math.random() * (max - min)) * 1000;
}

async function startMatch() {
  if (phase !== "idle" && phase !== "over") return;
  startBtn.disabled = true;
  sfx.unlock(); // inside the click handler so Safari allows audio
  hideBanner();

  if (!stream) {
    try {
      setStatus("Asking for camera access…");
      await startCamera();
    } catch (err) {
      console.error(err);
      setStatus(cameraErrorMessage(err), true);
      startBtn.disabled = false;
      return;
    }
  }

  phase = "countdown";
  diffSelect.disabled = true;
  detector.beginCalibration();
  detector.threshold = detector.defaultThreshold;
  avatar.setState("idle");
  avatar.say("Eyes up. Here we go.");
  timerEl.textContent = fmt(0);
  camFrame.classList.remove("danger");
  setStatus("Calibrating. Look at the camera with relaxed, open eyes.");
  countdownStart = performance.now();
  lastCountdownNumber = 0;
}

function tickGame(now) {
  if (phase === "countdown") {
    const elapsed = now - countdownStart;
    const n = Math.ceil((CONFIG.countdownMs - elapsed) / 1000);
    if (n !== lastCountdownNumber && n > 0) {
      lastCountdownNumber = n;
      countdownEl.textContent = n;
      countdownEl.classList.add("show");
      sfx.tick();
    }
    if (elapsed >= CONFIG.countdownMs) beginPlaying(now);
    return;
  }

  if (phase !== "playing") return;

  const elapsed = now - matchStart;
  timerEl.textContent = fmt(elapsed);

  // The AI strains harder the closer it gets to its own blink.
  const progress = elapsed / aiBlinkAt;
  if (progress >= CONFIG.squintStartsAt) {
    if (avatar.state !== "squinting") { avatar.setState("squinting"); avatar.saySquint(); }
    const strain = Math.min(1, (progress - CONFIG.squintStartsAt) / (1 - CONFIG.squintStartsAt));
    avatar.setTremble(0.4 + strain * 3.2);
  } else if (now - lastTauntAt > CONFIG.tauntEveryMs) {
    lastTauntAt = now;
    avatar.sayStare();
  }

  // Face lost / turned away: warn, then forfeit.
  if (faceLostAt !== null) {
    const remaining = CONFIG.faceLostGraceMs - (now - faceLostAt);
    if (remaining <= 0) return endMatch("forfeit", now);
    const secs = Math.ceil(remaining / 1000);
    setStatus(`Face not visible! Come back in ${secs}…`, true);
    camFrame.classList.add("danger");
    if (secs !== lastWarnSecond) { lastWarnSecond = secs; sfx.warn(); }
  } else {
    lastWarnSecond = -1;
    camFrame.classList.remove("danger");
    setStatus("Keep your eyes open!");
  }

  if (elapsed >= aiBlinkAt) endMatch("win", now);
}

function beginPlaying(now) {
  countdownEl.classList.remove("show");
  const ok = detector.finishCalibration(CONFIG.minCalibrationSamples);
  if (!ok) {
    phase = "idle";
    startBtn.disabled = false;
    diffSelect.disabled = false;
    avatar.say("I can't see you. Try again?");
    setStatus("Couldn't see your face during calibration. Face the camera in good light and press Start.", true);
    return;
  }
  console.log("calibrated", { baseline: detector.baseline.toFixed(3), threshold: detector.threshold.toFixed(3) });

  detector.reset();
  phase = "playing";
  matchStart = now;
  aiBlinkAt = pickAiBlinkTime(diffSelect.value);
  faceLostAt = null;
  lastWarnSecond = -1;
  lastTauntAt = now;
  avatar.setState("staring");
  avatar.say("Don't. Blink.");
  setStatus("Keep your eyes open!");
  sfx.go();
}

function endMatch(result, now) {
  if (phase !== "playing") return;
  phase = "over";
  const survived = Math.min(now - matchStart, aiBlinkAt);
  timerEl.textContent = fmt(survived);
  camFrame.classList.remove("danger");

  const d = diffSelect.value;
  if (!stats.best[d] || survived > stats.best[d]) stats.best[d] = survived;

  if (result === "win") {
    stats.wins++;
    avatar.blinkThen("lost");
    avatar.sayLose();
    setStatus(`You outlasted Blinky: ${fmt(survived, 1)}.`);
    showBanner("You win!", "win");
    sfx.win();
  } else {
    stats.losses++;
    avatar.setState("won");
    avatar.sayWin();
    if (result === "forfeit") {
      setStatus("You left the frame. Forfeit.", true);
      showBanner("Forfeit!", "lose");
    } else {
      setStatus(`You blinked after ${fmt(survived, 1)}.`, true);
      showBanner("You blinked!", "lose");
    }
    sfx.lose();
  }

  saveStats();
  renderStats();
  startBtn.textContent = "Play again";
  startBtn.disabled = false;
  diffSelect.disabled = false;
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */
startBtn.addEventListener("click", startMatch);
diffSelect.addEventListener("change", renderStats);
muteToggle.addEventListener("change", () => setMuted(muteToggle.checked));
debugToggle.addEventListener("change", drawOverlay);
hideCamToggle.addEventListener("change", () => {
  camFrame.classList.toggle("cam-hidden", hideCamToggle.checked);
  camPlaceholder.innerHTML = hideCamToggle.checked
    ? "Camera hidden.<br>Still tracking your eyes."
    : "Camera is off.<br>Press Start to turn it on.";
});

// Release the camera when the page goes away.
window.addEventListener("pagehide", () => {
  stream?.getTracks().forEach((t) => t.stop());
});

renderStats();
initLandmarker();
