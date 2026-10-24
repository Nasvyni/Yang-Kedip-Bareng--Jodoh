// AI
// Drives the SVG in index.html pke datastate attribute
// has the speech bubble dll
// -- - - -- - - - -- - - - -- - -- - -- - - - -- - - - - - - - -- - - -
// states: idle | staring | squinting | blinked | won | lost

const STARE_LINES = [
  "I don't even have eyelids. Oh wait.",
  "Still here. Still staring.",
  "Your eyes look dry. Just saying.",
  "I could do this all day.",
  "Think about something boring.",
  "Was that a twitch?",
  "Don't think about blinking. Too late.",
];
const SQUINT_LINES = [
  "Not… going… to… blink…",
  "My pixels are burning!",
  "Okay, this is actually hard.",
  "Please blink. PLEASE!!",
];
const WIN_LINES = [
  "Blink! Got you.",
  "Eyelids: 1, willpower: 0.",
  "Better luck next time, human.",
  "That's a point for the machines.",
];
const LOSE_LINES = [
  "I blinked! How?!",
  "Rematch. Right now.",
  "My eyes… they betrayed me.",
  "Fine. You win, This time only tho.",
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export class Avatar {
  constructor(svgEl, bubbleEl) {
    this.svg = svgEl;
    this.bubble = bubbleEl;
    this.state = null;
    this.timer = null;
    this.setState("idle");
  }

  setState(state) {
    clearTimeout(this.timer);
    this._apply(state);
  }

  _apply(state) {
    if (state === this.state) return;
    this.state = state;
    this.svg.dataset.state = state;
    if (state !== "squinting") this.setTremble(0);
  }

  /** showin  blink for `ms`, then settle into `next` (when ai lose). */
  blinkThen(next, ms = 380) {
    this.setState("blinked");
    this.timer = setTimeout(() => this._apply(next), ms);
  }

  /** Face shake!!!!!!!! */
  setTremble(px) {
    this.svg.style.setProperty("--tremble", `${px.toFixed(2)}px`);
  }

  say(text) { this.bubble.textContent = text; }
  sayStare()  { this.say(pick(STARE_LINES)); }
  saySquint() { this.say(pick(SQUINT_LINES)); }
  sayWin()    { this.say(pick(WIN_LINES)); }
  sayLose()   { this.say(pick(LOSE_LINES)); }
}
