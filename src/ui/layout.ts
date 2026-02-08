export type AppElements = {
  root: HTMLElement
  video: HTMLVideoElement
  renderCanvas: HTMLCanvasElement
  overlayCanvas: HTMLCanvasElement
  btnStart: HTMLButtonElement
  btnStop: HTMLButtonElement
  btnToggleUi: HTMLButtonElement
  btnResetWorld: HTMLButtonElement
  btnModeRunner: HTMLButtonElement
  btnModeAngry: HTMLButtonElement
  btnModeTreasure: HTMLButtonElement
  status: HTMLDivElement
  toast: HTMLDivElement
  scoreHud: HTMLDivElement
  powerHud: HTMLDivElement
  gameControls: HTMLElement
  joyBase: HTMLDivElement
  joyKnob: HTMLDivElement
  btnJumpGame: HTMLButtonElement
  scaleRange: HTMLInputElement
  btnCalibrate: HTMLButtonElement
  chkRunDepth: HTMLInputElement
  chkSlamPoints: HTMLInputElement
}

export function renderApp(root: HTMLElement): AppElements {
  root.innerHTML = `
    <main class="root">
      <video id="camera" class="camera" autoplay muted playsinline></video>
      <canvas id="render" class="render" aria-label="MR canvas"></canvas>
      <canvas id="overlay" class="overlay" aria-label="UI overlay"></canvas>

      <button id="btnToggleUi" class="btn uiToggle">Close</button>
      <div id="toast" class="toast" aria-live="polite"></div>
      <div id="scoreHud" class="scoreHud">Score: 0</div>
      <div id="powerHud" class="powerHud" aria-hidden="true">
        <div class="powerTrack">
          <div class="powerFill" style="width: 0%"></div>
        </div>
        <div class="powerLabel">Power</div>
        <div class="powerValue">0</div>
      </div>

      <section id="gameControls" class="gameControls" aria-label="Game controls">
        <div class="joyWrap">
          <div id="joyBase" class="joyBase" aria-label="Joystick">
            <div id="joyKnob" class="joyKnob"></div>
          </div>
          <div class="joyLabel">Move</div>
        </div>
        <button id="btnJumpGame" class="btnPrimary jumpBtn">Jump</button>
      </section>

      <section class="hud">
        <div class="hudRow">
          <button id="btnStart" class="btnPrimary">Start</button>
          <button id="btnStop" class="btn">Stop</button>
          <button id="btnResetWorld" class="btn">Reset World</button>
        </div>

        <div class="hudRow">
          <button id="btnModeRunner" class="btnPrimary">Runner</button>
          <button id="btnModeAngry" class="btn">Angry</button>
          <button id="btnModeTreasure" class="btn">Treasure</button>
        </div>

        <div class="hudRow">
          <label class="pill">
            <input id="chkRunDepth" type="checkbox" />
            <span>Run depth</span>
          </label>
          <label class="pill">
            <input id="chkSlamPoints" type="checkbox" />
            <span>SLAM points</span>
          </label>
        </div>

        <div class="hudRow">
          <label class="pill">
            <span>Scale</span>
            <input id="rngScale" type="range" min="0.25" max="2.5" step="0.05" value="1.0" />
          </label>
          <button id="btnCalibrate" class="btn">Calibrate</button>
        </div>

        <div class="hudRow hudNote" id="status">Ready</div>
      </section>
    </main>
  `

  const q = <T extends HTMLElement>(sel: string) => {
    const el = root.querySelector<T>(sel)
    if (!el) throw new Error(`${sel} missing`)
    return el
  }

  return {
    root,
    video: q<HTMLVideoElement>('#camera'),
    renderCanvas: q<HTMLCanvasElement>('#render'),
    overlayCanvas: q<HTMLCanvasElement>('#overlay'),
    btnStart: q<HTMLButtonElement>('#btnStart'),
    btnStop: q<HTMLButtonElement>('#btnStop'),
    btnToggleUi: q<HTMLButtonElement>('#btnToggleUi'),
    btnResetWorld: q<HTMLButtonElement>('#btnResetWorld'),
    btnModeRunner: q<HTMLButtonElement>('#btnModeRunner'),
    btnModeAngry: q<HTMLButtonElement>('#btnModeAngry'),
    btnModeTreasure: q<HTMLButtonElement>('#btnModeTreasure'),
    status: q<HTMLDivElement>('#status'),
    toast: q<HTMLDivElement>('#toast'),
    scoreHud: q<HTMLDivElement>('#scoreHud'),
    powerHud: q<HTMLDivElement>('#powerHud'),
    gameControls: q<HTMLElement>('#gameControls'),
    joyBase: q<HTMLDivElement>('#joyBase'),
    joyKnob: q<HTMLDivElement>('#joyKnob'),
    btnJumpGame: q<HTMLButtonElement>('#btnJumpGame'),
    scaleRange: q<HTMLInputElement>('#rngScale'),
    btnCalibrate: q<HTMLButtonElement>('#btnCalibrate'),
    chkRunDepth: q<HTMLInputElement>('#chkRunDepth'),
    chkSlamPoints: q<HTMLInputElement>('#chkSlamPoints'),
  }
}
