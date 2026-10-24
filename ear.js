// eye aspect ratio & blink detection
//
// MediaPipe Face Landmarker returns 478 normalized landmarks per face (hell)
// points for the ear formula
//   EAR = (|p2-p6| + |p3-p5|) / (2 * |p1-p4|)
// iwannaget p1 (outer corner), p2, p3 (upper lid), p4 (inner corner), p5, p6 (lower lid).
// "left" / "right" is abt the user 
export const EYES = {
  left:  [362, 385, 387, 263, 373, 380],
  right: [33, 160, 158, 133, 153, 144],
};

const dist = (a, b, w, h) => Math.hypot((a.x - b.x) * w, (a.y - b.y) * h);

/** EAR for one eye. Landmarks are normalized, so scale by the video size first. */
export function eyeEAR(landmarks, idx, width, height) {
  const [p1, p2, p3, p4, p5, p6] = idx.map((i) => landmarks[i]);
  return (dist(p2, p6, width, height) + dist(p3, p5, width, height)) /
         (2 * dist(p1, p4, width, height));
}

/**
 *  headturn estimate from the nose tip vs the 2 face edges
 * 0 = facing the camera n grows toward 1 as the head turns sideways
 * (roughly) 0.5 corresponds to ~45° of yaw
 */
export function headTurn(landmarks) {
  const nose = landmarks[1], left = landmarks[234], right = landmarks[454];
  const dl = Math.abs(nose.x - left.x);
  const dr = Math.abs(right.x - nose.x);
  const sum = dl + dr;
  return sum === 0 ? 1 : Math.abs(dl - dr) / sum;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class BlinkDetector {
  /**
   * @param {object} opts
   * @param {number} opts.defaultThreshold EAR below this counts as "closed" until calibrated (PRD: 0.20)
   * @param {number} opts.minFrames consecutive closed frames needed to call it a blink (PRD: 2)
   * @param {number} opts.thresholdRatio calibrated threshold = open-eye baseline × this
   */
  constructor({ defaultThreshold = 0.20, minFrames = 2, thresholdRatio = 0.75 } = {}) {
    this.defaultThreshold = defaultThreshold;
    this.minFrames = minFrames;
    this.thresholdRatio = thresholdRatio;
    this.threshold = defaultThreshold;
    this.baseline = null;
    this.closedFrames = 0;
    this.closed = false;
    this.calibrating = false;
    this.samples = [];
  }

  beginCalibration() {
    this.samples = [];
    this.calibrating = true;
  }

  addSample(ear) {
    if (this.calibrating && Number.isFinite(ear)) this.samples.push(ear);
  }

  /** returns true if enough samples is collected to set threshold */
  finishCalibration(minSamples = 10) {
    this.calibrating = false;
    if (this.samples.length < minSamples) return false;
    // use  75th percentile as "eyes open" so blinks during calibration dont drag it down
    const sorted = [...this.samples].sort((a, b) => a - b);
    this.baseline = sorted[Math.floor(sorted.length * 0.75)];
    this.threshold = clamp(this.baseline * this.thresholdRatio, 0.12, 0.24);
    return true;
  }

  reset() {
    this.closedFrames = 0;
    this.closed = false;
  }

  /**
   * givesreturns one frame + both eyes must be under the threshold
   * returns true exactly once per blink, ON the frame the blink is confirmed (!!!!!!)
   */
  update(earLeft, earRight) {
    const bothClosed = earLeft < this.threshold && earRight < this.threshold;
    if (bothClosed) {
      this.closedFrames++;
      this.closed = this.closedFrames >= this.minFrames;
      return this.closedFrames === this.minFrames;
    }
    this.closedFrames = 0;
    this.closed = false;
    return false;
  }
}
