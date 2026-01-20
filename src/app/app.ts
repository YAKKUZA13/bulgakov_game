import '../style.css'
import { registerServiceWorker } from '../pwa'
import { startRearCamera, stopCamera } from '../camera'
import { createScene, getPointerRay } from '../scene/scene'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { createMaskController } from '../occlusion/draw-ui'
import { estimateDepthFromImageURL, estimateDepthSingleShot, type DepthResult } from '../depth/depth'
import { drawDepthOverlay, sampleDepth01At } from '../depth/colormap'
import { createDepthMesh } from '../depth/depth-mesh'
import { applyAnchorToPlane, createAnchorPlane, nudgeAnchor, placeAnchorFromRay, type AnchorState, type PlaneMode } from '../game/anchors'
import { createTrackingController } from '../mr/tracking/tracker'
import { PlaneMapper } from '../mr/mapping/plane-mapper'
import { PhysicsWorld } from '../physics/world'
import { createRunner } from '../game/runner/runner'
import { createAngryMode } from '../game/angry/angry'
import { createTreasureMode } from '../game/treasure/treasure'
import { renderApp } from '../ui/layout'
import { createJoystick } from '../ui/joystick'
import * as CANNON from 'cannon-es'

type GameMode = 'runner' | 'angry' | 'treasure'

export async function startApp() {
  const app = document.querySelector<HTMLDivElement>('#app')
  if (!app) throw new Error('#app not found')

  registerServiceWorker()
  const ui = renderApp(app)

  const statusNode = ui.status
  const toastEl = ui.toast

  function setStatus(text: string) {
    statusNode.textContent = text
  }

  function showToast(text: string) {
    toastEl.textContent = text
    toastEl.style.display = text ? 'block' : 'none'
  }

  let activeStream: MediaStream | null = null
  let mode: GameMode = 'runner'
  let depthResult: DepthResult | null = null
  let showDepth = false
  let showDepth3d = false
  let runOnDepth = false
  let showSlamPoints = false
  let scaleMeters = Number(ui.scaleRange.value) || 1
  const overlay2dMaybe = ui.overlayCanvas.getContext('2d')
  if (!overlay2dMaybe) throw new Error('2D overlay context missing')
  const overlay2d = overlay2dMaybe

  const sceneBundle = createScene(ui.renderCanvas)
  const { mesh: anchorPlane } = createAnchorPlane(sceneBundle.scene)

  const depth3dGroup = new THREE.Group()
  depth3dGroup.visible = false
  sceneBundle.scene.add(depth3dGroup)
  let depthMesh: THREE.Mesh | null = null

  const orbit = new OrbitControls(sceneBundle.camera, ui.overlayCanvas)
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

  ui.btnToggleUi.addEventListener('click', () => {
    const hidden = ui.root.classList.toggle('uiHidden')
    ui.btnToggleUi.textContent = hidden ? 'Show UI' : 'Hide UI'
  })

  const anchorState: AnchorState = {
    mode: 'horizontal',
    depthMeters: Number(ui.depthRange.value) || 1.5,
    rotateDeg: Number(ui.rotateRange.value) || 0,
    placed: false,
    position: new THREE.Vector3(0, 0, 0),
    baseYawRad: 0,
  }

  const maskCtrl = createMaskController({ overlayCanvas: ui.overlayCanvas, video: ui.video })
  ui.btnDrawMask.addEventListener('click', () => {
    maskCtrl.toggleMaskMode()
    setStatus(maskCtrl.getMode() === 'mask' ? 'Mask draw: tap points, close near first' : 'Scan mode')
  })
  ui.btnClearMask.addEventListener('click', () => {
    maskCtrl.clear()
    maskCtrl.setMode('scan')
    setStatus('Mask cleared')
  })
  ui.btnMaskUndo.addEventListener('click', () => maskCtrl.undo())
  ui.btnMaskClose.addEventListener('click', () => maskCtrl.close())

  ui.btnClearDepth.addEventListener('click', () => {
    depthResult = null
    ui.chkShowDepth.checked = false
    showDepth = false
    ui.chkDepth3d.checked = false
    showDepth3d = false
    ui.chkRunDepth.checked = false
    runOnDepth = false
    ui.gameControls.style.display = 'none'
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

  ui.chkShowDepth.addEventListener('change', () => {
    showDepth = ui.chkShowDepth.checked
  })

  ui.chkDepth3d.addEventListener('change', () => {
    showDepth3d = ui.chkDepth3d.checked
    depth3dGroup.visible = showDepth3d && !!depthMesh
    orbit.enabled = showDepth3d && !!depthMesh
    if (orbit.enabled && depthMesh) orbit.target.copy(depthMesh.position)
    orbit.update()
  })

  ui.chkRunDepth.addEventListener('change', () => {
    runOnDepth = ui.chkRunDepth.checked
    ui.gameControls.style.display = runOnDepth ? 'flex' : 'none'
    orbit.enabled = showDepth3d && !!depthMesh
    if (orbit.enabled && depthMesh) orbit.target.copy(depthMesh.position)
    orbit.update()
  })
  ui.chkSlamPoints.addEventListener('change', () => {
    showSlamPoints = ui.chkSlamPoints.checked
  })

  ui.btnLoadPhoto.addEventListener('click', () => {
    ui.inpPhoto.value = ''
    ui.inpPhoto.click()
  })

  ui.inpPhoto.addEventListener('change', async () => {
    const file = ui.inpPhoto.files?.[0]
    if (!file) return
    const url = URL.createObjectURL(file)
    try {
      setStatus('Running depth… (photo)')
      const rect = ui.overlayCanvas.getBoundingClientRect()
      depthResult = await estimateDepthFromImageURL(url, {
        viewportW: rect.width || window.innerWidth,
        viewportH: rect.height || window.innerHeight,
        captureW: 768,
        textureW: 1440,
      })
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
      depthMesh = built.mesh
      if (!depthMesh.position.lengthSq()) depthMesh.position.set(0, 1.1, -0.6)
      if (!depthMesh.scale.lengthSq()) depthMesh.scale.set(3.0, 3.0, 3.0)
      depth3dGroup.add(depthMesh)
      ui.chkDepth3d.checked = true
      showDepth3d = true
      depth3dGroup.visible = true
      orbit.enabled = true
      orbit.target.copy(depthMesh.position)
      orbit.update()
      setStatus(`Depth ready (photo) (${depthResult.width}×${depthResult.height}).`)
      showToast('')
    } catch (e) {
      depthResult = null
      ui.chkShowDepth.checked = false
      showDepth = false
      ui.chkDepth3d.checked = false
      showDepth3d = false
      depth3dGroup.visible = false
      const msg = e instanceof Error ? e.message : String(e)
      setStatus(`Depth failed: ${msg}`)
      showToast(`Depth failed:\n${msg}`)
      console.warn(e)
    } finally {
      URL.revokeObjectURL(url)
    }
  })

  ui.btnCaptureDepth.addEventListener('click', async () => {
    if (!activeStream || ui.video.videoWidth === 0) {
      setStatus('Start camera first.')
      return
    }
    try {
      setStatus('Running depth… (single shot)')
      const rect = ui.overlayCanvas.getBoundingClientRect()
      depthResult = await estimateDepthSingleShot(ui.video, {
        viewportW: rect.width || window.innerWidth,
        viewportH: rect.height || window.innerHeight,
        captureW: 768,
        textureW: 1440,
      })
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
      depthMesh = built.mesh
      depthMesh.position.set(0, 1.1, -0.6)
      depthMesh.scale.set(3.0, 3.0, 3.0)
      depth3dGroup.add(depthMesh)
      depth3dGroup.visible = ui.chkDepth3d.checked
      orbit.enabled = ui.chkDepth3d.checked
      if (orbit.enabled) orbit.target.copy(depthMesh.position)
      orbit.update()
      setStatus(`Depth ready (${depthResult.width}×${depthResult.height}).`)
      showToast('')
    } catch (e) {
      depthResult = null
      ui.chkShowDepth.checked = false
      showDepth = false
      ui.chkDepth3d.checked = false
      showDepth3d = false
      depth3dGroup.visible = false
      const msg = e instanceof Error ? e.message : String(e)
      setStatus(`Depth failed: ${msg}`)
      showToast(`Depth failed:\n${msg}`)
      console.warn(e)
    }
  })

  let jumpPressed = false
  const joy = createJoystick({
    base: ui.joyBase,
    knob: ui.joyKnob,
    isEnabled: () => runOnDepth,
  })
  ui.btnJumpGame.addEventListener('pointerdown', () => (jumpPressed = true))
  ui.btnJumpGame.addEventListener('pointerup', () => (jumpPressed = false))
  ui.btnJumpGame.addEventListener('pointercancel', () => (jumpPressed = false))
  ui.btnJumpGame.addEventListener('pointerleave', () => (jumpPressed = false))

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

  ui.depthRange.addEventListener('input', () => {
    anchorState.depthMeters = Number(ui.depthRange.value) || 1.5
  })
  ui.rotateRange.addEventListener('input', () => {
    anchorState.rotateDeg = Number(ui.rotateRange.value) || 0
  })
  ui.scaleRange.addEventListener('input', () => {
    scaleMeters = Number(ui.scaleRange.value) || 1
  })
  ui.btnCalibrate.addEventListener('click', () => {
    const value = window.prompt('Enter world scale multiplier (meters):', String(scaleMeters))
    if (!value) return
    const num = Number(value)
    if (!Number.isFinite(num) || num <= 0) {
      showToast('Invalid scale value')
      return
    }
    scaleMeters = num
    ui.scaleRange.value = String(num)
    showToast(`Scale set to ${num.toFixed(2)}×`)
  })

  const NUDGE = 0.05
  ui.btnNudgeUp.addEventListener('click', () => nudgeAnchor(anchorState, anchorPlane, 0, +NUDGE))
  ui.btnNudgeDown.addEventListener('click', () => nudgeAnchor(anchorState, anchorPlane, 0, -NUDGE))
  ui.btnNudgeLeft.addEventListener('click', () => nudgeAnchor(anchorState, anchorPlane, -NUDGE, 0))
  ui.btnNudgeRight.addEventListener('click', () => nudgeAnchor(anchorState, anchorPlane, +NUDGE, 0))

  function resizeOverlay() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = ui.overlayCanvas.clientWidth || window.innerWidth
    const h = ui.overlayCanvas.clientHeight || window.innerHeight
    ui.overlayCanvas.width = Math.floor(w * dpr)
    ui.overlayCanvas.height = Math.floor(h * dpr)
  }
  resizeOverlay()
  window.addEventListener('resize', resizeOverlay)

  ui.overlayCanvas.addEventListener('pointerdown', (ev) => {
    const res = maskCtrl.handlePointerDown(ev.clientX, ev.clientY)
    if (res.consumed) return
    if (mode === 'angry') return
    if (showDepth3d) return
    const rect = ui.overlayCanvas.getBoundingClientRect()
    const viewportW = rect.width || window.innerWidth
    const viewportH = rect.height || window.innerHeight
    if (depthResult) {
      const x01 = (ev.clientX - rect.left) / viewportW
      const y01 = (ev.clientY - rect.top) / viewportH
      const d01 = sampleDepth01At(depthResult, x01, y01)
      const maxDepth = Number(ui.depthRange.value) || 1.5
      anchorState.depthMeters = 0.3 + d01 * Math.max(0, maxDepth - 0.3)
    }
    const r = getPointerRay(sceneBundle, ev.clientX - rect.left, ev.clientY - rect.top, viewportW, viewportH)
    placeAnchorFromRay(sceneBundle, anchorState, r)
    setStatus(`Placed: ${anchorState.mode}, depth ${anchorState.depthMeters.toFixed(1)}m${depthResult ? ' (auto)' : ''}`)
  })

  // Tracking + mapping + physics + modes
  const tracking = createTrackingController({
    video: ui.video,
    width: 640,
    height: 480,
    onStatus: (st, detail) => {
      if (st === 'tracking') setStatus(`Tracking (${detail ?? 'ok'})`)
      else if (st === 'lost') setStatus('Tracking lost')
      else if (st === 'unavailable') setStatus('Tracking unavailable (place /vendor/alva_ar.js)')
      else if (st === 'initializing') setStatus('Tracking initializing…')
    },
  })

  ui.btnResetWorld.addEventListener('click', () => tracking.resetWorld())

  const planeMapper = new PlaneMapper({
    maxDepthMeters: 2.4,
    minDepthMeters: 0.3,
    sampleStride: 4,
  })
  const surfaceMeshes = new Map<string, THREE.Mesh>()
  const physics = new PhysicsWorld()
  let worldPlaneBody: import('cannon-es').Body | null = physics.addPlane(new THREE.Vector3(0, 1, 0), 0)
  let slamPlaneMesh: THREE.Mesh | null = null

  const runner = createRunner({ scene: sceneBundle.scene, physics })
  const angry = createAngryMode({ scene: sceneBundle.scene, physics })
  const treasure = createTreasureMode({ scene: sceneBundle.scene })

  function setMode(next: GameMode) {
    mode = next
    ui.btnModeRunner.classList.toggle('btnPrimary', next === 'runner')
    ui.btnModeAngry.classList.toggle('btnPrimary', next === 'angry')
    ui.btnModeTreasure.classList.toggle('btnPrimary', next === 'treasure')
    if (next === 'runner') {
      angry.clear()
      treasure.clear()
    }
    if (next === 'angry') angry.reset(new THREE.Vector3(0, 0.5, -1))
    if (next === 'treasure') treasure.reset(new THREE.Vector3(0, 0.6, -1))
  }

  ui.btnModeRunner.addEventListener('click', () => setMode('runner'))
  ui.btnModeAngry.addEventListener('click', () => setMode('angry'))
  ui.btnModeTreasure.addEventListener('click', () => setMode('treasure'))

  let launchStart: { x: number; y: number } | null = null
  ui.overlayCanvas.addEventListener('pointerdown', (ev) => {
    if (mode !== 'angry') return
    launchStart = { x: ev.clientX, y: ev.clientY }
  })
  ui.overlayCanvas.addEventListener('pointerup', (ev) => {
    if (mode !== 'angry' || !launchStart) return
    const dx = ev.clientX - launchStart.x
    const dy = ev.clientY - launchStart.y
    const power = Math.min(6, Math.hypot(dx, dy) / 40)
    const dir = new THREE.Vector3()
    sceneBundle.camera.getWorldDirection(dir)
    dir.y += -dy * 0.002
    const from = new THREE.Vector3().copy(sceneBundle.camera.position).add(dir.clone().multiplyScalar(0.4))
    angry.launch(from, dir, power)
    launchStart = null
  })

  let lastDepthT = 0
  let lastT = performance.now()
  function frame(t: number) {
    const dt = Math.min((t - lastT) / 1000, 0.05)
    lastT = t

    tracking.update(dt)
    const pose = tracking.getPose()
    sceneBundle.camera.position.copy(pose.position)
    sceneBundle.camera.quaternion.copy(pose.quaternion)

    const slamPlane = tracking.getPlane()

    applyAnchorToPlane(anchorPlane, anchorState)

    if (activeStream && t - lastDepthT > 1500 && ui.video.videoWidth > 0) {
      lastDepthT = t
      estimateDepthSingleShot(ui.video, {
        viewportW: ui.overlayCanvas.clientWidth || window.innerWidth,
        viewportH: ui.overlayCanvas.clientHeight || window.innerHeight,
        captureW: 512,
        textureW: 1024,
      })
        .then((res) => {
          depthResult = res
          planeMapper.updateFromDepth(res, sceneBundle.camera, pose, scaleMeters)
        })
        .catch(() => {
          // best-effort
        })
    }

    for (const s of planeMapper.getSurfaces()) {
      let mesh = surfaceMeshes.get(s.id)
      if (!mesh) {
        const geom = new THREE.PlaneGeometry(1, 1)
        const mat = new THREE.MeshBasicMaterial({ color: 0x4cffb5, opacity: 0.2, transparent: true, side: THREE.DoubleSide })
        mesh = new THREE.Mesh(geom, mat)
        sceneBundle.scene.add(mesh)
        surfaceMeshes.set(s.id, mesh)
      }
      const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), s.normal)
      mesh.position.copy(s.center)
      mesh.quaternion.copy(quat)
      mesh.scale.set(s.extent * 2, s.extent * 2, 1)
    }

    if (slamPlane) {
      if (!slamPlaneMesh) {
        const geom = new THREE.PlaneGeometry(1, 1)
        const mat = new THREE.MeshBasicMaterial({ color: 0x4c8bff, opacity: 0.25, transparent: true, side: THREE.DoubleSide })
        slamPlaneMesh = new THREE.Mesh(geom, mat)
        sceneBundle.scene.add(slamPlaneMesh)
      }
      const pos = slamPlane.position.clone().multiplyScalar(scaleMeters)
      slamPlaneMesh.position.copy(pos)
      slamPlaneMesh.quaternion.copy(slamPlane.quaternion)
      slamPlaneMesh.scale.set(1.2, 1.2, 1)

      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(slamPlane.quaternion).normalize()
      const constant = -normal.dot(pos)
      if (!worldPlaneBody) {
        worldPlaneBody = physics.addPlane(normal, constant)
      } else {
        worldPlaneBody.position.set(-normal.x * constant, -normal.y * constant, -normal.z * constant)
        worldPlaneBody.quaternion.setFromVectors(new CANNON.Vec3(0, 0, 1), new CANNON.Vec3(normal.x, normal.y, normal.z))
      }
    } else {
      const dominant = planeMapper.getSurfaces()[0]
      if (dominant) {
        if (!worldPlaneBody) {
          worldPlaneBody = physics.addPlane(dominant.normal, dominant.constant)
        } else {
          const n = dominant.normal
          worldPlaneBody.position.set(-n.x * dominant.constant, -n.y * dominant.constant, -n.z * dominant.constant)
          worldPlaneBody.quaternion.setFromVectors(new CANNON.Vec3(0, 0, 1), new CANNON.Vec3(n.x, n.y, n.z))
        }
      }
    }

    if (mode === 'runner') {
      runner.setInput({ moveX: joy.state.moveX, jumpPressed })
      runner.update()
    }
    if (mode === 'treasure') {
      treasure.update(sceneBundle.camera, [...surfaceMeshes.values()])
    }

    physics.step(dt)
    maskCtrl.render()

    if (showDepth && depthResult) {
      drawDepthOverlay(overlay2d, ui.overlayCanvas, depthResult)
    }

    if (showSlamPoints) {
      const pts = tracking.getFramePoints()
      if (pts && pts.points.length > 0) {
        const w = ui.overlayCanvas.clientWidth || window.innerWidth
        const h = ui.overlayCanvas.clientHeight || window.innerHeight
        const dpr = ui.overlayCanvas.width / Math.max(1, w)
        const sx = w / Math.max(1, pts.width)
        const sy = h / Math.max(1, pts.height)
        overlay2d.save()
        overlay2d.setTransform(dpr, 0, 0, dpr, 0, 0)
        overlay2d.fillStyle = 'rgba(255,255,255,0.85)'
        for (const p of pts.points) {
          overlay2d.fillRect(p.x * sx, p.y * sy, 2, 2)
        }
        overlay2d.restore()
      }
    }

    if (orbit.enabled) orbit.update()
    sceneBundle.renderer.render(sceneBundle.scene, sceneBundle.camera)
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)

  ui.btnStart.addEventListener('click', async () => {
    setStatus('Starting camera…')
    const res = await startRearCamera(ui.video)
    if (!res.ok) {
      setStatus(res.error)
      return
    }
    activeStream = res.stream
    await tracking.start()
    setStatus('Camera running. Tracking initialized.')
  })

  ui.btnStop.addEventListener('click', () => {
    stopCamera(activeStream)
    activeStream = null
    tracking.stop()
    setStatus('Stopped')
  })
}
