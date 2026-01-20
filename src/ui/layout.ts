export type AppElements = {
  root: HTMLElement
  video: HTMLVideoElement
  renderCanvas: HTMLCanvasElement
  overlayCanvas: HTMLCanvasElement
  btnStart: HTMLButtonElement
  btnStop: HTMLButtonElement
  btnToggleUi: HTMLButtonElement
  btnResetWorld: HTMLButtonElement
  btnCalibrate: HTMLButtonElement
  btnModeRunner: HTMLButtonElement
  btnModeAngry: HTMLButtonElement
  btnModeTreasure: HTMLButtonElement
  status: HTMLDivElement
  toast: HTMLDivElement
  gameControls: HTMLElement
  joyBase: HTMLDivElement
  joyKnob: HTMLDivElement
  btnJumpGame: HTMLButtonElement
  depthRange: HTMLInputElement
  rotateRange: HTMLInputElement
  scaleRange: HTMLInputElement
  btnCaptureDepth: HTMLButtonElement
  btnLoadPhoto: HTMLButtonElement
  inpPhoto: HTMLInputElement
  chkShowDepth: HTMLInputElement
  chkDepth3d: HTMLInputElement
  chkRunDepth: HTMLInputElement
  chkSlamPoints: HTMLInputElement
  btnClearDepth: HTMLButtonElement
  btnNudgeUp: HTMLButtonElement
  btnNudgeDown: HTMLButtonElement
  btnNudgeLeft: HTMLButtonElement
  btnNudgeRight: HTMLButtonElement
  btnDrawMask: HTMLButtonElement
  btnMaskUndo: HTMLButtonElement
  btnMaskClose: HTMLButtonElement
  btnClearMask: HTMLButtonElement
}

export function renderApp(root: HTMLElement): AppElements {
  root.innerHTML = `
    <main class="root">
      <video id="camera" class="camera" autoplay muted playsinline></video>
      <canvas id="render" class="render" aria-label="MR canvas"></canvas>
      <canvas id="overlay" class="overlay" aria-label="UI overlay"></canvas>

      <button id="btnToggleUi" class="btn uiToggle">Hide UI</button>
      <div id="toast" class="toast" aria-live="polite"></div>

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
            <input type="radio" name="planeMode" value="horizontal" checked />
            <span>Horizontal</span>
          </label>
          <label class="pill">
            <input type="radio" name="planeMode" value="vertical" />
            <span>Vertical</span>
          </label>
        </div>

        <div class="hudRow">
          <label class="pill">
            <span>Depth</span>
            <input id="rngDepth" type="range" min="0.3" max="4.0" step="0.1" value="1.5" />
          </label>
          <label class="pill">
            <span>Rotate</span>
            <input id="rngRotate" type="range" min="-180" max="180" step="1" value="0" />
          </label>
          <label class="pill">
            <span>Scale</span>
            <input id="rngScale" type="range" min="0.25" max="2.5" step="0.05" value="1.0" />
          </label>
          <button id="btnCalibrate" class="btn">Calibrate</button>
        </div>

        <div class="hudRow">
          <button id="btnCaptureDepth" class="btn">Capture depth</button>
          <button id="btnLoadPhoto" class="btn">Load photo</button>
          <input id="inpPhoto" type="file" accept="image/*" style="display:none" />
          <label class="pill">
            <input id="chkShowDepth" type="checkbox" />
            <span>Show depth</span>
          </label>
          <label class="pill">
            <input id="chkDepth3d" type="checkbox" />
            <span>Depth 3D</span>
          </label>
          <label class="pill">
            <input id="chkRunDepth" type="checkbox" />
            <span>Run on depth</span>
          </label>
          <label class="pill">
            <input id="chkSlamPoints" type="checkbox" />
            <span>SLAM points</span>
          </label>
          <button id="btnClearDepth" class="btn">Clear depth</button>
        </div>

        <div class="hudRow">
          <button id="btnNudgeUp" class="btn">Nudge ↑</button>
          <button id="btnNudgeDown" class="btn">Nudge ↓</button>
          <button id="btnNudgeLeft" class="btn">Nudge ←</button>
          <button id="btnNudgeRight" class="btn">Nudge →</button>
        </div>

        <div class="hudRow">
          <button id="btnDrawMask" class="btn">Draw occluder</button>
          <button id="btnMaskUndo" class="btn">Undo</button>
          <button id="btnMaskClose" class="btn">Close</button>
          <button id="btnClearMask" class="btn">Clear</button>
        </div>

        <div class="hudRow">
          <span class="hudNote">Tip: enable “Run on depth” to control the cube with joystick + Jump.</span>
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
    btnCalibrate: q<HTMLButtonElement>('#btnCalibrate'),
    btnModeRunner: q<HTMLButtonElement>('#btnModeRunner'),
    btnModeAngry: q<HTMLButtonElement>('#btnModeAngry'),
    btnModeTreasure: q<HTMLButtonElement>('#btnModeTreasure'),
    status: q<HTMLDivElement>('#status'),
    toast: q<HTMLDivElement>('#toast'),
    gameControls: q<HTMLElement>('#gameControls'),
    joyBase: q<HTMLDivElement>('#joyBase'),
    joyKnob: q<HTMLDivElement>('#joyKnob'),
    btnJumpGame: q<HTMLButtonElement>('#btnJumpGame'),
    depthRange: q<HTMLInputElement>('#rngDepth'),
    rotateRange: q<HTMLInputElement>('#rngRotate'),
    scaleRange: q<HTMLInputElement>('#rngScale'),
    btnCaptureDepth: q<HTMLButtonElement>('#btnCaptureDepth'),
    btnLoadPhoto: q<HTMLButtonElement>('#btnLoadPhoto'),
    inpPhoto: q<HTMLInputElement>('#inpPhoto'),
    chkShowDepth: q<HTMLInputElement>('#chkShowDepth'),
    chkDepth3d: q<HTMLInputElement>('#chkDepth3d'),
    chkRunDepth: q<HTMLInputElement>('#chkRunDepth'),
    chkSlamPoints: q<HTMLInputElement>('#chkSlamPoints'),
    btnClearDepth: q<HTMLButtonElement>('#btnClearDepth'),
    btnNudgeUp: q<HTMLButtonElement>('#btnNudgeUp'),
    btnNudgeDown: q<HTMLButtonElement>('#btnNudgeDown'),
    btnNudgeLeft: q<HTMLButtonElement>('#btnNudgeLeft'),
    btnNudgeRight: q<HTMLButtonElement>('#btnNudgeRight'),
    btnDrawMask: q<HTMLButtonElement>('#btnDrawMask'),
    btnMaskUndo: q<HTMLButtonElement>('#btnMaskUndo'),
    btnMaskClose: q<HTMLButtonElement>('#btnMaskClose'),
    btnClearMask: q<HTMLButtonElement>('#btnClearMask'),
  }
}
