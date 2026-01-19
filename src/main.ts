import './style.css'
import { registerServiceWorker } from './pwa'
import { startRearCamera, stopCamera } from './camera'
import { createScene, getPointerRay } from './scene/scene'
import * as THREE from 'three'
import {
  applyAnchorToPlane,
  createAnchorPlane,
  nudgeAnchor,
  placeAnchorFromRay,
  type AnchorState,
  type PlaneMode,
} from './game/anchors'
import { computePlayerPose, createPlayerState, defaultTuning, stepPlayerWithGround, type PlayerInput } from './game/player'
import { createMaskController } from './occlusion/draw-ui'
import { estimateDepthFromImageURL, estimateDepthSingleShot, type DepthResult } from './depth/depth'
import { drawDepthOverlay, sampleDepth01At } from './depth/colormap'
import { createDepthMesh } from './depth/depth-mesh'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('#app not found')

app.innerHTML = `
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

registerServiceWorker()

const video = document.querySelector<HTMLVideoElement>('#camera')
const statusEl = document.querySelector<HTMLDivElement>('#status')
const btnStart = document.querySelector<HTMLButtonElement>('#btnStart')
const btnStop = document.querySelector<HTMLButtonElement>('#btnStop')
const btnToggleUi = document.querySelector<HTMLButtonElement>('#btnToggleUi')
const toastMaybe = document.querySelector<HTMLDivElement>('#toast')
const gameControls = document.querySelector<HTMLElement>('#gameControls')
const joyBase = document.querySelector<HTMLDivElement>('#joyBase')
const joyKnobMaybe = document.querySelector<HTMLDivElement>('#joyKnob')
if (!joyKnobMaybe) throw new Error('#joyKnob missing')
const joyKnob = joyKnobMaybe
const btnJumpGame = document.querySelector<HTMLButtonElement>('#btnJumpGame')
const renderCanvas = document.querySelector<HTMLCanvasElement>('#render')
const overlayCanvas = document.querySelector<HTMLCanvasElement>('#overlay')
const depthRange = document.querySelector<HTMLInputElement>('#rngDepth')
const rotateRange = document.querySelector<HTMLInputElement>('#rngRotate')
const btnCaptureDepth = document.querySelector<HTMLButtonElement>('#btnCaptureDepth')
const btnLoadPhoto = document.querySelector<HTMLButtonElement>('#btnLoadPhoto')
const inpPhoto = document.querySelector<HTMLInputElement>('#inpPhoto')
const chkShowDepth = document.querySelector<HTMLInputElement>('#chkShowDepth')
const chkDepth3d = document.querySelector<HTMLInputElement>('#chkDepth3d')
const chkRunDepth = document.querySelector<HTMLInputElement>('#chkRunDepth')
const btnClearDepth = document.querySelector<HTMLButtonElement>('#btnClearDepth')

const btnNudgeUp = document.querySelector<HTMLButtonElement>('#btnNudgeUp')
const btnNudgeDown = document.querySelector<HTMLButtonElement>('#btnNudgeDown')
const btnNudgeLeft = document.querySelector<HTMLButtonElement>('#btnNudgeLeft')
const btnNudgeRight = document.querySelector<HTMLButtonElement>('#btnNudgeRight')
const btnDrawMask = document.querySelector<HTMLButtonElement>('#btnDrawMask')
const btnClearMask = document.querySelector<HTMLButtonElement>('#btnClearMask')
const btnMaskUndo = document.querySelector<HTMLButtonElement>('#btnMaskUndo')
const btnMaskClose = document.querySelector<HTMLButtonElement>('#btnMaskClose')

if (!video) throw new Error('#camera missing')
if (!statusEl) throw new Error('#status missing')
if (!btnStart) throw new Error('#btnStart missing')
if (!btnStop) throw new Error('#btnStop missing')
if (!btnToggleUi) throw new Error('#btnToggleUi missing')
if (!toastMaybe) throw new Error('#toast missing')
const toastEl = toastMaybe
if (!gameControls) throw new Error('#gameControls missing')
if (!joyBase) throw new Error('#joyBase missing')
if (!joyKnob) throw new Error('#joyKnob missing')
if (!btnJumpGame) throw new Error('#btnJumpGame missing')
if (!renderCanvas) throw new Error('#render missing')
if (!overlayCanvas) throw new Error('#overlay missing')
if (!depthRange) throw new Error('#rngDepth missing')
if (!rotateRange) throw new Error('#rngRotate missing')
if (!btnCaptureDepth) throw new Error('#btnCaptureDepth missing')
if (!btnLoadPhoto) throw new Error('#btnLoadPhoto missing')
if (!inpPhoto) throw new Error('#inpPhoto missing')
if (!chkShowDepth) throw new Error('#chkShowDepth missing')
if (!chkDepth3d) throw new Error('#chkDepth3d missing')
if (!chkRunDepth) throw new Error('#chkRunDepth missing')
if (!btnClearDepth) throw new Error('#btnClearDepth missing')
if (!btnNudgeUp) throw new Error('#btnNudgeUp missing')
if (!btnNudgeDown) throw new Error('#btnNudgeDown missing')
if (!btnNudgeLeft) throw new Error('#btnNudgeLeft missing')
if (!btnNudgeRight) throw new Error('#btnNudgeRight missing')
if (!btnDrawMask) throw new Error('#btnDrawMask missing')
if (!btnClearMask) throw new Error('#btnClearMask missing')
if (!btnMaskUndo) throw new Error('#btnMaskUndo missing')
if (!btnMaskClose) throw new Error('#btnMaskClose missing')

const statusNode = statusEl
const overlayNode = overlayCanvas
const rootNode = document.querySelector<HTMLElement>('.root')
if (!rootNode) throw new Error('.root missing')

let activeStream: MediaStream | null = null
let depthResult: DepthResult | null = null
let showDepth = false
let showDepth3d = false
let runOnDepth = false
const overlay2dMaybe = overlayNode.getContext('2d')
if (!overlay2dMaybe) throw new Error('2D overlay context missing')
const overlay2d = overlay2dMaybe

function setStatus(text: string) {
  statusNode.textContent = text
}

function showToast(text: string) {
  toastEl.textContent = text
  toastEl.style.display = text ? 'block' : 'none'
}

const sceneBundle = createScene(renderCanvas)
const { mesh: anchorPlane } = createAnchorPlane(sceneBundle.scene)
const obstacleGroup = new THREE.Group()
anchorPlane.add(obstacleGroup)

const depth3dGroup = new THREE.Group()
depth3dGroup.visible = false
sceneBundle.scene.add(depth3dGroup)
let depthMesh: THREE.Mesh | null = null
let depthMeshZScale = 2.2
let depthMeshInvert = true
let depthMeshAspect = 1

// Orbit controls (mouse/touch) for Depth 3D mode.
const orbit = new OrbitControls(sceneBundle.camera, overlayNode)
orbit.enabled = false
orbit.enableDamping = true
orbit.dampingFactor = 0.08
orbit.rotateSpeed = 0.5
orbit.zoomSpeed = 0.8
orbit.panSpeed = 0.6
orbit.screenSpacePanning = true
orbit.touches.ONE = THREE.TOUCH.ROTATE
orbit.touches.TWO = THREE.TOUCH.DOLLY_PAN

const savedCamPos = new THREE.Vector3().copy(sceneBundle.camera.position)
const savedTarget = new THREE.Vector3().copy(orbit.target)

btnToggleUi.addEventListener('click', () => {
  const hidden = rootNode.classList.toggle('uiHidden')
  btnToggleUi.textContent = hidden ? 'Show UI' : 'Hide UI'
})

// Temporary visual: a cube floating in front of the camera
const cubeGeom = new THREE.BoxGeometry(0.25, 0.25, 0.25)
const cubeMat = new THREE.MeshStandardMaterial({ color: 0x3c78ff })
const cube = new THREE.Mesh(cubeGeom, cubeMat)
cube.position.set(0, 1.2, 0)
sceneBundle.scene.add(cube)

type PlatformDef = { u: number; v: number; hu: number; hv: number; height: number }
type ObstacleDef = { u: number; v: number; hu: number; hv: number; height: number }

const platforms: PlatformDef[] = [{ u: 0.0, v: 2.0, hu: 0.55, hv: 0.55, height: 0.18 }]
const obstacles: ObstacleDef[] = [
  { u: 0.25, v: 1.4, hu: 0.12, hv: 0.12, height: 0.35 },
  { u: -0.25, v: 3.2, hu: 0.12, hv: 0.12, height: 0.35 },
]

// Visualize platforms/obstacles as children of the anchor plane (plane-local coords)
;(() => {
  obstacleGroup.clear()

  const platMat = new THREE.MeshStandardMaterial({ color: 0x8b5cff, opacity: 0.85, transparent: true })
  for (const p of platforms) {
    const geom = new THREE.BoxGeometry(p.hu * 2, p.hv * 2, p.height)
    const mesh = new THREE.Mesh(geom, platMat)
    mesh.position.set(p.u, p.v, p.height / 2)
    obstacleGroup.add(mesh)
  }

  const obsMat = new THREE.MeshStandardMaterial({ color: 0xff6b3c })
  for (const o of obstacles) {
    const geom = new THREE.BoxGeometry(o.hu * 2, o.hv * 2, o.height)
    const mesh = new THREE.Mesh(geom, obsMat)
    mesh.position.set(o.u, o.v, o.height / 2)
    obstacleGroup.add(mesh)
  }
})()

const anchorState: AnchorState = {
  mode: 'horizontal',
  depthMeters: Number(depthRange.value) || 1.5,
  rotateDeg: Number(rotateRange.value) || 0,
  placed: false,
  position: new THREE.Vector3(0, 0, 0),
  baseYawRad: 0,
}

const player = createPlayerState()
const input: PlayerInput = { jumpPressed: false, moveX: 0 }
type TerrainInput = { moveX: number; moveY: number; jumpPressed: boolean }
const terrainInput: TerrainInput = { moveX: 0, moveY: 0, jumpPressed: false }

// Player state on depth mesh (u/v in mesh-local plane coords, height is above surface along +Z)
const meshPlayer = createPlayerState()
meshPlayer.u = 0
meshPlayer.v = 0
meshPlayer.height = 0
meshPlayer.velN = 0

const maskCtrl = createMaskController({ overlayCanvas: overlayNode, video })

btnDrawMask.addEventListener('click', () => {
  maskCtrl.toggleMaskMode()
  setStatus(maskCtrl.getMode() === 'mask' ? 'Mask draw: tap points, close near first' : 'Scan mode')
})
btnClearMask.addEventListener('click', () => {
  maskCtrl.clear()
  maskCtrl.setMode('scan')
  setStatus('Mask cleared')
})
btnMaskUndo.addEventListener('click', () => maskCtrl.undo())
btnMaskClose.addEventListener('click', () => maskCtrl.close())

btnClearDepth.addEventListener('click', () => {
  depthResult = null
  chkShowDepth.checked = false
  showDepth = false
  chkDepth3d.checked = false
  showDepth3d = false
  chkRunDepth.checked = false
  runOnDepth = false
  gameControls.style.display = 'none'
  depth3dGroup.visible = false
  orbit.enabled = false
  orbit.target.copy(savedTarget)
  sceneBundle.camera.position.copy(savedCamPos)
  orbit.update()
  if (depthMesh) {
    depth3dGroup.remove(depthMesh)
    depthMesh.geometry.dispose()
    ;(depthMesh.material as THREE.Material).dispose()
    depthMesh = null
  }
  setStatus('Depth cleared')
})

chkShowDepth.addEventListener('change', () => {
  showDepth = chkShowDepth.checked
})

chkDepth3d.addEventListener('change', () => {
  showDepth3d = chkDepth3d.checked
  depth3dGroup.visible = showDepth3d && !!depthMesh
  // Keep camera where the user left it. Just enable/disable orbit controls.
  orbit.enabled = showDepth3d && !!depthMesh
  if (orbit.enabled && depthMesh) orbit.target.copy(depthMesh.position)
  orbit.update()
})

chkRunDepth.addEventListener('change', () => {
  runOnDepth = chkRunDepth.checked
  gameControls.style.display = runOnDepth ? 'flex' : 'none'
  // Do not move the camera when enabling/disabling "run". Keep orbit as-is.
  // (Orbit can stay enabled; joystick uses its own area so it doesn't have to conflict.)
  orbit.enabled = showDepth3d && !!depthMesh
  if (orbit.enabled && depthMesh) orbit.target.copy(depthMesh.position)
  orbit.update()
})

btnLoadPhoto.addEventListener('click', () => {
  inpPhoto.value = ''
  inpPhoto.click()
})

inpPhoto.addEventListener('change', async () => {
  const file = inpPhoto.files?.[0]
  if (!file) return

  const url = URL.createObjectURL(file)
  try {
    setStatus('Running depth… (photo)')
    const rect = overlayNode.getBoundingClientRect()
    depthResult = await estimateDepthFromImageURL(url, {
      viewportW: rect.width || window.innerWidth,
      viewportH: rect.height || window.innerHeight,
      captureW: 768,
      textureW: 1440,
    })

    // Build a textured depth mesh.
    if (depthMesh) {
      depth3dGroup.remove(depthMesh)
      depthMesh.geometry.dispose()
      ;(depthMesh.material as THREE.Material).dispose()
      depthMesh = null
    }
    const pixels = depthResult.width * depthResult.height
    const stride = pixels > 260_000 ? 2 : 1
    const built = createDepthMesh(depthResult, {
      stride,
      zScale: 2.2,
      invert: true,
      anisotropy: sceneBundle.renderer.capabilities.getMaxAnisotropy(),
    })
    depthMeshZScale = 2.2
    depthMeshInvert = true
    depthMeshAspect = depthResult.height / Math.max(1, depthResult.width)
    depthMesh = built.mesh

    // Keep previous position if user already placed it; otherwise use default.
    if (!depthMesh.position.lengthSq()) depthMesh.position.set(0, 1.1, -0.6)
    if (!depthMesh.scale.lengthSq()) depthMesh.scale.set(3.0, 3.0, 3.0)

    depth3dGroup.add(depthMesh)
    chkDepth3d.checked = true
    showDepth3d = true
    depth3dGroup.visible = true
    orbit.enabled = true
    orbit.target.copy(depthMesh.position)
    orbit.update()

    setStatus(`Depth ready (photo) (${depthResult.width}×${depthResult.height}).`)
    showToast('')
  } catch (e) {
    depthResult = null
    chkShowDepth.checked = false
    showDepth = false
    chkDepth3d.checked = false
    showDepth3d = false
    depth3dGroup.visible = false
    const msg = e instanceof Error ? e.message : String(e)
    setStatus(`Depth failed: ${msg}`)
    showToast(`Depth failed:\n${msg}`)
    // eslint-disable-next-line no-console
    console.warn(e)
  } finally {
    URL.revokeObjectURL(url)
  }
})

btnCaptureDepth.addEventListener('click', async () => {
  if (!activeStream || video.videoWidth === 0) {
    setStatus('Start camera first.')
    return
  }

  try {
    // Single-shot. Downscale inside estimator.
    setStatus('Running depth… (single shot)')
    const rect = overlayNode.getBoundingClientRect()
    depthResult = await estimateDepthSingleShot(video, {
      viewportW: rect.width || window.innerWidth,
      viewportH: rect.height || window.innerHeight,
      captureW: 768,
      textureW: 1440,
    })

    // Build a textured depth mesh (like the depth-anything demo).
    if (depthMesh) {
      depth3dGroup.remove(depthMesh)
      depthMesh.geometry.dispose()
      ;(depthMesh.material as THREE.Material).dispose()
      depthMesh = null
    }
    const pixels = depthResult.width * depthResult.height
    const stride = pixels > 260_000 ? 2 : 1
    const built = createDepthMesh(depthResult, {
      stride,
      zScale: 2.2,
      invert: true,
      anisotropy: sceneBundle.renderer.capabilities.getMaxAnisotropy(),
    })
    depthMeshZScale = 2.2
    depthMeshInvert = true
    depthMeshAspect = depthResult.height / Math.max(1, depthResult.width)
    depthMesh = built.mesh
    depthMesh.position.set(0, 1.1, -0.6)
    depthMesh.scale.set(3.0, 3.0, 3.0)
    depth3dGroup.add(depthMesh)
    depth3dGroup.visible = chkDepth3d.checked
    orbit.enabled = chkDepth3d.checked
    if (orbit.enabled) orbit.target.copy(depthMesh.position)
    orbit.update()

    setStatus(`Depth ready (${depthResult.width}×${depthResult.height}).`)
    showToast('')
  } catch (e) {
    depthResult = null
    chkShowDepth.checked = false
    showDepth = false
    chkDepth3d.checked = false
    showDepth3d = false
    depth3dGroup.visible = false
    const msg = e instanceof Error ? e.message : String(e)
    setStatus(`Depth failed: ${msg}`)
    showToast(`Depth failed:\n${msg}`)
    // eslint-disable-next-line no-console
    console.warn(e)
  }
})

function bindHoldButton(btn: HTMLButtonElement, onDown: () => void, onUp: () => void) {
  const down = (ev: Event) => {
    ev.preventDefault()
    onDown()
  }
  const up = (ev: Event) => {
    ev.preventDefault()
    onUp()
  }
  btn.addEventListener('pointerdown', down)
  btn.addEventListener('pointerup', up)
  btn.addEventListener('pointercancel', up)
  btn.addEventListener('pointerleave', up)
}

bindHoldButton(
  btnJumpGame,
  () => (terrainInput.jumpPressed = true),
  () => (terrainInput.jumpPressed = false),
)

// Joystick (pointer/touch)
;(() => {
  let activeId: number | null = null
  let cx = 0
  let cy = 0
  let radius = 1

  function setKnob(dx: number, dy: number) {
    joyKnob.style.transform = `translate(${dx}px, ${dy}px)`
  }

  function updateFromClient(clientX: number, clientY: number) {
    const dx = clientX - cx
    const dy = clientY - cy
    const len = Math.hypot(dx, dy)
    const max = radius
    const k = len > max ? max / len : 1
    const ndx = dx * k
    const ndy = dy * k
    setKnob(ndx, ndy)
    terrainInput.moveX = ndx / max
    terrainInput.moveY = -ndy / max
  }

  function reset() {
    activeId = null
    terrainInput.moveX = 0
    terrainInput.moveY = 0
    setKnob(0, 0)
  }

  joyBase.addEventListener('pointerdown', (ev) => {
    if (!runOnDepth) return
    ev.preventDefault()
    activeId = ev.pointerId
    joyBase.setPointerCapture(ev.pointerId)
    const rect = joyBase.getBoundingClientRect()
    cx = rect.left + rect.width / 2
    cy = rect.top + rect.height / 2
    radius = Math.min(rect.width, rect.height) * 0.38
    updateFromClient(ev.clientX, ev.clientY)
  })

  joyBase.addEventListener('pointermove', (ev) => {
    if (!runOnDepth) return
    if (activeId !== ev.pointerId) return
    ev.preventDefault()
    updateFromClient(ev.clientX, ev.clientY)
  })

  const end = (ev: PointerEvent) => {
    if (activeId !== ev.pointerId) return
    ev.preventDefault()
    reset()
  }
  joyBase.addEventListener('pointerup', end)
  joyBase.addEventListener('pointercancel', end)
  joyBase.addEventListener('pointerleave', (ev) => {
    if (activeId !== ev.pointerId) return
    reset()
  })
})()

function readPlaneMode(): PlaneMode {
  const el = document.querySelector<HTMLInputElement>('input[name="planeMode"]:checked')
  return (el?.value === 'vertical' ? 'vertical' : 'horizontal') satisfies PlaneMode
}

document.querySelectorAll<HTMLInputElement>('input[name="planeMode"]').forEach((el) => {
  el.addEventListener('change', () => {
    anchorState.mode = readPlaneMode()
    setStatus(`Mode: ${anchorState.mode}`)
  })
})

depthRange.addEventListener('input', () => {
  anchorState.depthMeters = Number(depthRange.value) || 1.5
})

rotateRange.addEventListener('input', () => {
  anchorState.rotateDeg = Number(rotateRange.value) || 0
})

const NUDGE = 0.05
btnNudgeUp.addEventListener('click', () => nudgeAnchor(anchorState, anchorPlane, 0, +NUDGE))
btnNudgeDown.addEventListener('click', () => nudgeAnchor(anchorState, anchorPlane, 0, -NUDGE))
btnNudgeLeft.addEventListener('click', () => nudgeAnchor(anchorState, anchorPlane, -NUDGE, 0))
btnNudgeRight.addEventListener('click', () => nudgeAnchor(anchorState, anchorPlane, +NUDGE, 0))

function resizeOverlay() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const w = overlayNode.clientWidth || window.innerWidth
  const h = overlayNode.clientHeight || window.innerHeight
  overlayNode.width = Math.floor(w * dpr)
  overlayNode.height = Math.floor(h * dpr)
}
resizeOverlay()
window.addEventListener('resize', resizeOverlay)

overlayNode.addEventListener('pointerdown', (ev) => {
  const res = maskCtrl.handlePointerDown(ev.clientX, ev.clientY)
  if (res.consumed) return

  if (showDepth3d) return

  // Tap-to-place: place anchor plane at fixed depth along ray.
  const rect = overlayNode.getBoundingClientRect()
  const viewportW = rect.width || window.innerWidth
  const viewportH = rect.height || window.innerHeight

  // If we have depth, convert it into a depthMeters for this tap (relative depth scaled by the slider).
  if (depthResult) {
    const x01 = (ev.clientX - rect.left) / viewportW
    const y01 = (ev.clientY - rect.top) / viewportH
    const d01 = sampleDepth01At(depthResult, x01, y01)
    // Treat slider as max depth; map [0..1] -> [0.3..max]
    const maxDepth = Number(depthRange.value) || 1.5
    anchorState.depthMeters = 0.3 + d01 * Math.max(0, maxDepth - 0.3)
  }

  const r = getPointerRay(sceneBundle, ev.clientX - rect.left, ev.clientY - rect.top, viewportW, viewportH)
  placeAnchorFromRay(sceneBundle, anchorState, r)
  // reset runner state on placement
  player.u = 0
  player.v = 0
  player.height = 0
  player.velN = 0
  setStatus(`Placed: ${anchorState.mode}, depth ${anchorState.depthMeters.toFixed(1)}m${depthResult ? ' (auto)' : ''}`)
})

let lastT = performance.now()
function frame(t: number) {
  const dt = Math.min((t - lastT) / 1000, 0.05)
  lastT = t

  applyAnchorToPlane(anchorPlane, anchorState)

  // Mode A: run on detected anchor plane (old runner)
  if (anchorState.placed && !(runOnDepth && depthMesh && depthResult && showDepth3d)) {
    let ground = 0
    for (const p of platforms) {
      if (Math.abs(player.u - p.u) <= p.hu && Math.abs(player.v - p.v) <= p.hv) {
        ground = Math.max(ground, p.height)
      }
    }

    // advance runner and project onto the current plane
    stepPlayerWithGround(player, input, dt, defaultTuning, ground)

    const half = defaultTuning.cubeSize / 2
    for (const o of obstacles) {
      const hitUV =
        Math.abs(player.u - o.u) <= half + o.hu && Math.abs(player.v - o.v) <= half + o.hv
      const hitH = player.height < o.height
      if (hitUV && hitH) {
        // push back along forward (+v)
        player.v = o.v - (half + o.hv + 0.001)
        setStatus('Hit obstacle')
        break
      }
    }

    const pose = computePlayerPose(anchorPlane.position, anchorPlane.quaternion, player, defaultTuning)
    cube.position.copy(pose.pos)
    cube.quaternion.copy(pose.quat)
  }

  // Mode B: run on depth mesh surface
  if (runOnDepth && depthMesh && depthResult && showDepth3d) {
    // Move on mesh in its local plane coords ([-0.5..0.5] x [-aspect/2..aspect/2])
    const speed = 0.55
    meshPlayer.u += terrainInput.moveX * speed * dt
    meshPlayer.v += terrainInput.moveY * speed * dt

    const halfW = 0.5
    const halfH = depthMeshAspect / 2
    meshPlayer.u = Math.max(-halfW, Math.min(halfW, meshPlayer.u))
    meshPlayer.v = Math.max(-halfH, Math.min(halfH, meshPlayer.v))

    // sample depth at this point
    const x01 = (meshPlayer.u + halfW) / (halfW * 2)
    const y01 = (meshPlayer.v + halfH) / (halfH * 2)
    const d01 = sampleDepth01At(depthResult, x01, y01)
    const zSurfaceLocal = (depthMeshInvert ? 1 - d01 : d01) * depthMeshZScale

    // simple gravity/jump (height above surface)
    meshPlayer.velN -= 3.2 * dt
    meshPlayer.height += meshPlayer.velN * dt
    if (meshPlayer.height < 0) {
      meshPlayer.height = 0
      meshPlayer.velN = 0
      if (terrainInput.jumpPressed) {
        meshPlayer.velN = 1.8
        meshPlayer.height += meshPlayer.velN * dt
      }
    }

    const half = defaultTuning.cubeSize / 2
    cube.quaternion.identity()
    cube.position.set(
      depthMesh.position.x + meshPlayer.u * depthMesh.scale.x,
      depthMesh.position.y + meshPlayer.v * depthMesh.scale.y,
      depthMesh.position.z + (zSurfaceLocal + half + meshPlayer.height) * depthMesh.scale.z,
    )
  }

  maskCtrl.render()

  if (showDepth && depthResult) {
    drawDepthOverlay(overlay2d, overlayNode, depthResult)
  }

  if (orbit.enabled) orbit.update()

  sceneBundle.renderer.render(sceneBundle.scene, sceneBundle.camera)
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)

btnStart.addEventListener('click', async () => {
  setStatus('Starting camera…')
  const res = await startRearCamera(video)
  if (!res.ok) {
    setStatus(res.error)
    return
  }
  activeStream = res.stream
  setStatus('Camera running. Tap-to-place coming next.')
})

btnStop.addEventListener('click', () => {
  stopCamera(activeStream)
  activeStream = null
  setStatus('Stopped')
})
