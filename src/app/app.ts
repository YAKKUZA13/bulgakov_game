import '../style.css'
import { registerServiceWorker } from '../pwa'
import { startRearCamera, stopCamera } from '../camera'
import { createScene } from '../scene/scene'
import * as THREE from 'three'
import { createTrackingController } from '../mr/tracking/tracker'
import { PlaneMapper } from '../mr/mapping/plane-mapper'
import { PhysicsWorld } from '../physics/world'
import { createRunner } from '../game/runner/runner'
import { createAngryMode } from '../game/angry/angry'
import { createTreasureMode } from '../game/treasure/treasure'
import { renderApp } from '../ui/layout'
import { createJoystick } from '../ui/joystick'
import { estimateDepthSingleShot } from '../depth/depth'
import * as CANNON from 'cannon-es'

type GameMode = 'runner' | 'angry' | 'treasure'

export async function startApp() {
  const app = document.querySelector<HTMLDivElement>('#app')
  if (!app) throw new Error('#app not found')

  registerServiceWorker()
  const ui = renderApp(app)

  const statusNode = ui.status
  let baseStatus = 'Idle'
  function setStatus(text: string) {
    statusNode.textContent = text
  }

  let activeStream: MediaStream | null = null
  let mode: GameMode = 'runner'
  let runDepth = false
  let showSlamPoints = false
  let launchStart: { x: number; y: number } | null = null
  let scaleMeters = Number(ui.scaleRange.value) || 1
  const maxPower = 6
  const aimScaleX = 2.2
  const aimScaleY = 2.8
  let gyroQuat = new THREE.Quaternion()
  let gyroActive = false
  const overlay2dMaybe = ui.overlayCanvas.getContext('2d')
  if (!overlay2dMaybe) throw new Error('2D overlay context missing')
  const overlay2d = overlay2dMaybe

  const sceneBundle = createScene(ui.renderCanvas)
  const cameraSunLight = new THREE.DirectionalLight(0xfff2d6, 1.9)
  cameraSunLight.castShadow = false
  const cameraFillLight = new THREE.HemisphereLight(0xffffff, 0x5f6f88, 0.55)
  sceneBundle.scene.add(cameraSunLight)
  sceneBundle.scene.add(cameraSunLight.target)
  sceneBundle.scene.add(cameraFillLight)

  ui.btnToggleUi.addEventListener('click', () => {
    const hidden = ui.root.classList.toggle('uiHidden')
    ui.btnToggleUi.textContent = hidden ? 'Menu' : 'Close'
  })

  ui.chkSlamPoints.addEventListener('change', () => {
    showSlamPoints = ui.chkSlamPoints.checked
    if (!showSlamPoints) {
      overlay2d.clearRect(0, 0, ui.overlayCanvas.width, ui.overlayCanvas.height)
    }
  })
  ui.chkRunDepth.addEventListener('change', () => {
    runDepth = ui.chkRunDepth.checked
  })
  ui.scaleRange.addEventListener('input', () => {
    scaleMeters = Number(ui.scaleRange.value) || 1
  })
  ui.btnCalibrate.addEventListener('click', () => {
    const value = window.prompt('Enter world scale multiplier (meters):', String(scaleMeters))
    if (!value) return
    const num = Number(value)
    if (!Number.isFinite(num) || num <= 0) {
      setStatus('Invalid scale value')
      return
    }
    scaleMeters = num
    ui.scaleRange.value = String(num)
    setStatus(`Scale set to ${num.toFixed(2)}×`)
  })

  let jumpPressed = false
  const joy = createJoystick({
    base: ui.joyBase,
    knob: ui.joyKnob,
    isEnabled: () => mode === 'runner',
  })
  ui.btnJumpGame.addEventListener('pointerdown', () => (jumpPressed = true))
  ui.btnJumpGame.addEventListener('pointerup', () => (jumpPressed = false))
  ui.btnJumpGame.addEventListener('pointercancel', () => (jumpPressed = false))
  ui.btnJumpGame.addEventListener('pointerleave', () => (jumpPressed = false))

  function onDeviceOrientation(ev: DeviceOrientationEvent) {
    const alpha = THREE.MathUtils.degToRad(ev.alpha ?? 0)
    const beta = THREE.MathUtils.degToRad(ev.beta ?? 0)
    const gamma = THREE.MathUtils.degToRad(ev.gamma ?? 0)
    const euler = new THREE.Euler(beta, alpha, -gamma, 'YXZ')
    gyroQuat = new THREE.Quaternion().setFromEuler(euler)
    gyroActive = true
  }
  if (typeof window !== 'undefined' && 'DeviceOrientationEvent' in window) {
    window.addEventListener('deviceorientation', onDeviceOrientation)
  }

  function resizeOverlay() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = ui.overlayCanvas.clientWidth || window.innerWidth
    const h = ui.overlayCanvas.clientHeight || window.innerHeight
    ui.overlayCanvas.width = Math.floor(w * dpr)
    ui.overlayCanvas.height = Math.floor(h * dpr)
  }
  resizeOverlay()
  window.addEventListener('resize', resizeOverlay)

  // Pointer events are reserved for Angry mode (launching projectiles).

  // Tracking + mapping + physics + modes
  const tracking = createTrackingController({
    video: ui.video,
    width: ui.overlayCanvas.width,
    height: ui.overlayCanvas.height,
    onStatus: (st, detail) => {
      if (st === 'tracking') baseStatus = `Tracking (${detail ?? 'ok'})`
      else if (st === 'lost') baseStatus = 'Tracking lost'
      else if (st === 'unavailable') baseStatus = 'Tracking unavailable (place public/vendor/alva_ar.js)'
      else if (st === 'initializing') baseStatus = 'Tracking initializing…'
      setStatus(baseStatus)
    },
  })

  ui.btnResetWorld.addEventListener('click', () => tracking.resetWorld())

  const physics = new PhysicsWorld()
  let worldPlaneBody: import('cannon-es').Body | null = physics.addPlane(new THREE.Vector3(0, 1, 0), 0)
  let slamPlaneMesh: THREE.Mesh | null = null
  let depthPlaneMesh: THREE.Mesh | null = null
  let currentPlaneSource: 'slam' | 'depth' | null = null
  let lastPlaneSwitchT = 0
  const planeMapper = new PlaneMapper({
    maxDepthMeters: 2.4,
    minDepthMeters: 0.3,
    sampleStride: 4,
  })

  const runner = createRunner({ scene: sceneBundle.scene, physics })
  const angry = createAngryMode({ scene: sceneBundle.scene, physics })
  const treasure = createTreasureMode({ scene: sceneBundle.scene })

  function setMode(next: GameMode) {
    mode = next
    ui.btnModeRunner.classList.toggle('btnPrimary', next === 'runner')
    ui.btnModeAngry.classList.toggle('btnPrimary', next === 'angry')
    ui.btnModeTreasure.classList.toggle('btnPrimary', next === 'treasure')
    ui.gameControls.style.display = next === 'runner' ? 'flex' : 'none'
    if (next === 'runner') {
      angry.clear()
      treasure.clear()
    }
    if (next === 'angry') {
      angry.hideTrajectory()
      angry.reset()
      runDepth = false
      showSlamPoints = false
      ui.chkRunDepth.checked = false
      ui.chkSlamPoints.checked = false
      overlay2d.clearRect(0, 0, ui.overlayCanvas.width, ui.overlayCanvas.height)
      ui.scoreHud.textContent = `Score: ${angry.getScore()}`
    }
    if (next === 'treasure') treasure.reset(new THREE.Vector3(0, 0.6, -1))
    ui.scoreHud.style.display = next === 'angry' ? 'block' : 'none'
    ui.powerHud.style.display = 'none'
    ui.overlayCanvas.style.touchAction = next === 'angry' ? 'none' : 'manipulation'
    launchStart = null
  }

  ui.btnModeRunner.addEventListener('click', () => setMode('runner'))
  ui.btnModeAngry.addEventListener('click', () => setMode('angry'))
  ui.btnModeTreasure.addEventListener('click', () => setMode('treasure'))
  setMode(mode)

  function placeRunnerAtPointer(ev: PointerEvent) {
    const targetPlane = slamPlaneMesh ?? depthPlaneMesh
    if (!targetPlane || !targetPlane.visible) return
    const rect = ui.overlayCanvas.getBoundingClientRect()
    const w = rect.width || window.innerWidth
    const h = rect.height || window.innerHeight
    const x = ((ev.clientX - rect.left) / w) * 2 - 1
    const y = -((ev.clientY - rect.top) / h) * 2 + 1
    sceneBundle.raycaster.setFromCamera(new THREE.Vector2(x, y), sceneBundle.camera)
    const hits = sceneBundle.raycaster.intersectObject(targetPlane, false)
    if (!hits.length) return
    const hit = hits[0]
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(targetPlane.quaternion).normalize()
    const pos = hit.point.clone().addScaledVector(normal, 0.15)
    runner.setPosition(pos)
  }

  function updateTrajectory(clientX: number, clientY: number) {
    if (mode !== 'angry' || !launchStart) return

    const rect = ui.overlayCanvas.getBoundingClientRect()
    const w = rect.width || window.innerWidth
    const h = rect.height || window.innerHeight

    const dx = clientX - launchStart.x
    const dy = clientY - launchStart.y
    const swipeLength = Math.hypot(dx, dy)
    const power = Math.min(maxPower, swipeLength / 40)
    updatePowerHud(power)

    // Базовое направление - куда смотрит камера (вперёд)
    const forward = new THREE.Vector3()
    sceneBundle.camera.getWorldDirection(forward)

    // Получаем правый и верхний векторы камеры
    const up = new THREE.Vector3()
    up.copy(sceneBundle.camera.up).normalize()

    const right = new THREE.Vector3()
    right.crossVectors(forward, up).normalize()

    // Если свайп слишком короткий, используем только направление камеры
    if (swipeLength < 10) {
      const from = new THREE.Vector3().copy(sceneBundle.camera.position).add(forward.clone().multiplyScalar(0.4))
      angry.showTrajectory(from, forward, power)
      return
    }

    // Преобразуем экранное смещение в мировое направление
    // Нормализуем смещение относительно размера экрана
    const normalizedDx = (dx / w) * aimScaleX // Масштабируем для чувствительности
    const normalizedDy = -(dy / h) * aimScaleY // Инвертируем Y (экранные координаты)

    // Комбинируем базовое направление с экранным смещением
    const dir = forward.clone()
      .add(right.clone().multiplyScalar(normalizedDx))
      .add(up.clone().multiplyScalar(normalizedDy))
      .normalize()

    const from = new THREE.Vector3().copy(sceneBundle.camera.position).add(dir.clone().multiplyScalar(0.4))
    angry.showTrajectory(from, dir, power)
  }

  function shootAtPointer(clientX: number, clientY: number) {
    const dogs = angry.getDogRoots()
    if (!dogs.length) return
    const rect = ui.overlayCanvas.getBoundingClientRect()
    const w = rect.width || window.innerWidth
    const h = rect.height || window.innerHeight
    const x = ((clientX - rect.left) / w) * 2 - 1
    const y = -((clientY - rect.top) / h) * 2 + 1
    sceneBundle.raycaster.setFromCamera(new THREE.Vector2(x, y), sceneBundle.camera)
    const hits = sceneBundle.raycaster.intersectObjects(dogs, true)
    const from = new THREE.Vector3().copy(sceneBundle.camera.position).add(new THREE.Vector3(0, 0, 0))
    let target: THREE.Vector3 | null = null
    let distance = 0
    if (hits.length > 0) {
      const hit = hits[0]
      target = hit.point.clone()
      distance = hit.distance
    } else {
      // Fallback for animated/skinned GLB meshes where raycast can be unreliable on some devices.
      const origin = sceneBundle.raycaster.ray.origin
      const aimTargets = angry.getDogAimTargets()
      for (const aimTarget of aimTargets) {
        const sphereHit = sceneBundle.raycaster.ray.intersectSphere(
          new THREE.Sphere(aimTarget.center, aimTarget.radius),
          new THREE.Vector3(),
        )
        if (!sphereHit) continue
        const hitDistance = sphereHit.distanceTo(origin)
        if (distance === 0 || hitDistance < distance) {
          distance = hitDistance
          target = sphereHit
        }
      }
    }
    if (!target || distance <= 0) return
    const power = THREE.MathUtils.clamp(distance * 2.2, 7.5, 14)
    const travelT = distance / power
    target.y += 0.5 * 9.81 * travelT * travelT
    const dir = target.sub(from).normalize()
    angry.launch(from, dir, power)
  }

  ui.overlayCanvas.addEventListener('pointerdown', (ev) => {
    if (mode === 'runner') {
      placeRunnerAtPointer(ev)
      return
    }
    if (mode === 'angry') {
      shootAtPointer(ev.clientX, ev.clientY)
      return
    }
    return
  })

  ui.overlayCanvas.addEventListener('pointermove', (ev) => {
    if (mode !== 'angry' || !launchStart) return
    updateTrajectory(ev.clientX, ev.clientY)
  })

  ui.overlayCanvas.addEventListener('pointerup', (ev) => {
    if (mode !== 'angry' || !launchStart) return

    const rect = ui.overlayCanvas.getBoundingClientRect()
    const w = rect.width || window.innerWidth
    const h = rect.height || window.innerHeight

    const dx = ev.clientX - launchStart.x
    const dy = ev.clientY - launchStart.y
    const swipeLength = Math.hypot(dx, dy)
    const power = Math.min(maxPower, swipeLength / 40)

    // Базовое направление - куда смотрит камера (вперёд)
    const forward = new THREE.Vector3()
    sceneBundle.camera.getWorldDirection(forward)

    // Получаем правый и верхний векторы камеры
    const up = new THREE.Vector3()
    up.copy(sceneBundle.camera.up).normalize()

    const right = new THREE.Vector3()
    right.crossVectors(forward, up).normalize()

    // Если свайп слишком короткий, используем только направление камеры
    if (swipeLength < 10) {
      const from = new THREE.Vector3().copy(sceneBundle.camera.position).add(forward.clone().multiplyScalar(0.4))
      angry.launch(from, forward, power)
      launchStart = null
      ui.powerHud.style.display = 'none'
      return
    }

    // Преобразуем экранное смещение в мировое направление
    const normalizedDx = (dx / w) * aimScaleX
    const normalizedDy = -(dy / h) * aimScaleY

    // Комбинируем базовое направление с экранным смещением
    const dir = forward.clone()
      .add(right.clone().multiplyScalar(normalizedDx))
      .add(up.clone().multiplyScalar(normalizedDy))
      .normalize()

    const from = new THREE.Vector3().copy(sceneBundle.camera.position).add(dir.clone().multiplyScalar(0.4))
    angry.launch(from, dir, power)
    launchStart = null
    ui.powerHud.style.display = 'none'
  })

  ui.overlayCanvas.addEventListener('pointercancel', () => {
    if (mode === 'angry') {
      angry.hideTrajectory()
      launchStart = null
      ui.powerHud.style.display = 'none'
    }
  })

  function suppressSwipeRefresh(ev: TouchEvent) {
    if (mode !== 'angry') return
    ev.preventDefault()
  }
  ui.overlayCanvas.addEventListener('touchstart', suppressSwipeRefresh, { passive: false })
  ui.overlayCanvas.addEventListener('touchmove', suppressSwipeRefresh, { passive: false })

  function updatePowerHud(power: number) {
    const fill = ui.powerHud.querySelector<HTMLDivElement>('.powerFill')
    if (!fill) return
    const value = ui.powerHud.querySelector<HTMLDivElement>('.powerValue')
    const pct = Math.max(0, Math.min(1, power / maxPower)) * 100
    fill.style.width = `${pct.toFixed(0)}%`
    if (value) value.textContent = power.toFixed(1)
  }

  let lastT = performance.now()
  let lastDepthT = lastT
  let perfLastLog = lastT
  let perfFrames = 0
  let perfDtSum = 0
  let perfSlow = 0
  let lastStatsUi = lastT
  const cameraForward = new THREE.Vector3()
  function frame(t: number) {
    const dt = Math.min((t - lastT) / 1000, 0.05)
    lastT = t
    perfFrames += 1
    perfDtSum += dt
    if (dt > 0.04) perfSlow += 1

    tracking.update(dt)
    const pose = tracking.getPose()
    if (mode === 'angry') {
      // In Angry mode we keep a fixed horizontal world floor and use SLAM only for phone position.
      sceneBundle.camera.position.set(pose.position.x, 1.6, pose.position.z)
      sceneBundle.camera.quaternion.copy(gyroActive ? gyroQuat : pose.quaternion)
      if (slamPlaneMesh) slamPlaneMesh.visible = false
      if (depthPlaneMesh) depthPlaneMesh.visible = false
      if (worldPlaneBody) {
        worldPlaneBody.position.set(0, 0, 0)
        worldPlaneBody.quaternion.setFromVectors(new CANNON.Vec3(0, 0, 1), new CANNON.Vec3(0, 1, 0))
      }
    } else {
      sceneBundle.camera.position.copy(pose.position)
      sceneBundle.camera.quaternion.copy(pose.quaternion)

      const slamPlane = tracking.getPlane()

      if (runDepth && activeStream && t - lastDepthT > 1500 && ui.video.videoWidth > 0) {
        lastDepthT = t
        const depthStart = performance.now()
        estimateDepthSingleShot(ui.video, {
          viewportW: ui.overlayCanvas.clientWidth || window.innerWidth,
          viewportH: ui.overlayCanvas.clientHeight || window.innerHeight,
          captureW: 256,
          textureW: 384,
        })
          .then((res) => {
            planeMapper.updateFromDepth(res, sceneBundle.camera, pose, scaleMeters)
            const ms = performance.now() - depthStart
            console.info(`[depth] ${ms.toFixed(0)}ms ${res.width}x${res.height}`)
          })
          .catch(() => {
            // best-effort
          })
      }

      const dominant = runDepth ? planeMapper.getSurfaces()[0] : undefined
      const depthPlaneAvailable = Boolean(dominant && dominant.confidence >= 0.45)
      const slamAvailable = Boolean(slamPlane)
      const switchCooldown = 800
      if (!currentPlaneSource) {
        if (slamAvailable) currentPlaneSource = 'slam'
        else if (depthPlaneAvailable) currentPlaneSource = 'depth'
      } else if (currentPlaneSource === 'slam' && !slamAvailable) {
        if (depthPlaneAvailable && t - lastPlaneSwitchT > switchCooldown) {
          currentPlaneSource = 'depth'
          lastPlaneSwitchT = t
        }
      } else if (currentPlaneSource === 'depth' && !depthPlaneAvailable) {
        if (slamAvailable && t - lastPlaneSwitchT > switchCooldown) {
          currentPlaneSource = 'slam'
          lastPlaneSwitchT = t
        }
      }

      if (currentPlaneSource === 'slam' && slamPlane) {
        if (!slamPlaneMesh) {
          const geom = new THREE.PlaneGeometry(1, 1)
          const mat = new THREE.MeshBasicMaterial({
            color: 0x4c8bff,
            opacity: 0.25,
            transparent: true,
            side: THREE.DoubleSide,
          })
          slamPlaneMesh = new THREE.Mesh(geom, mat)
          sceneBundle.scene.add(slamPlaneMesh)
        }
        const pos = slamPlane.position.clone().multiplyScalar(scaleMeters)
        slamPlaneMesh.position.copy(pos)
        slamPlaneMesh.quaternion.copy(slamPlane.quaternion)
        slamPlaneMesh.scale.set(1.2, 1.2, 1)
        if (depthPlaneMesh) depthPlaneMesh.visible = false

        const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(slamPlane.quaternion).normalize()
        const constant = -normal.dot(pos)
        if (!worldPlaneBody) {
          worldPlaneBody = physics.addPlane(normal, constant)
        } else {
          worldPlaneBody.position.set(-normal.x * constant, -normal.y * constant, -normal.z * constant)
          worldPlaneBody.quaternion.setFromVectors(
            new CANNON.Vec3(0, 0, 1),
            new CANNON.Vec3(normal.x, normal.y, normal.z),
          )
        }
      } else if (currentPlaneSource === 'depth' && dominant) {
        if (!depthPlaneMesh) {
          const geom = new THREE.PlaneGeometry(1, 1)
          const mat = new THREE.MeshBasicMaterial({
            color: 0x4cffb5,
            opacity: 0.2,
            transparent: true,
            side: THREE.DoubleSide,
          })
          depthPlaneMesh = new THREE.Mesh(geom, mat)
          sceneBundle.scene.add(depthPlaneMesh)
        }
        depthPlaneMesh.visible = true
        const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dominant.normal)
        depthPlaneMesh.position.copy(dominant.center)
        depthPlaneMesh.quaternion.copy(quat)
        depthPlaneMesh.scale.set(dominant.extent * 2, dominant.extent * 2, 1)
        if (slamPlaneMesh) slamPlaneMesh.visible = false
        if (!worldPlaneBody) {
          worldPlaneBody = physics.addPlane(dominant.normal, dominant.constant)
        } else {
          const n = dominant.normal
          worldPlaneBody.position.set(-n.x * dominant.constant, -n.y * dominant.constant, -n.z * dominant.constant)
          worldPlaneBody.quaternion.setFromVectors(
            new CANNON.Vec3(0, 0, 1),
            new CANNON.Vec3(n.x, n.y, n.z),
          )
        }
      }
    }
    sceneBundle.camera.getWorldDirection(cameraForward)
    cameraSunLight.position.set(
      sceneBundle.camera.position.x - cameraForward.x * 1.2,
      sceneBundle.camera.position.y + 6.5,
      sceneBundle.camera.position.z - cameraForward.z * 1.2,
    )
    cameraSunLight.target.position.set(
      sceneBundle.camera.position.x + cameraForward.x * 3.0,
      sceneBundle.camera.position.y - 1.0,
      sceneBundle.camera.position.z + cameraForward.z * 3.0,
    )
    cameraSunLight.target.updateMatrixWorld()

    if (mode === 'runner') {
      runner.setInput({ moveX: joy.state.moveX, jumpPressed })
      runner.update()
    }
    if (mode === 'treasure') {
      treasure.update(sceneBundle.camera)
    }

    physics.step(dt)

    if (mode === 'angry') {
      angry.update(dt, sceneBundle.camera.position)
      ui.scoreHud.textContent = `Score: ${angry.getScore()}`
    }

    if (showSlamPoints) {
      overlay2d.clearRect(0, 0, ui.overlayCanvas.width, ui.overlayCanvas.height)
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

    sceneBundle.renderer.render(sceneBundle.scene, sceneBundle.camera)

    if (t - lastStatsUi > 800 && baseStatus.startsWith('Tracking')) {
      const stats = tracking.getStats()
      const total = stats.tracked + stats.lost
      const quality = total > 0 ? stats.tracked / total : 0
      const jitterPos = stats.jitterPos
      const jitterAng = THREE.MathUtils.radToDeg(stats.jitterAng)
      setStatus(
        `${baseStatus} | q ${(quality * 100).toFixed(0)}% | jitter ${jitterPos.toFixed(2)}m/s ${jitterAng.toFixed(1)}deg/s`,
      )
      lastStatsUi = t
    }

    if (t - perfLastLog > 2000) {
      const elapsed = (t - perfLastLog) / 1000
      const fps = perfFrames / Math.max(0.001, elapsed)
      const avgMs = (perfDtSum / Math.max(1, perfFrames)) * 1000
      const info = sceneBundle.renderer.info
      console.info(
        `[perf] fps ${fps.toFixed(1)} avg ${avgMs.toFixed(1)}ms slow ${perfSlow} draws ${info.render.calls} tris ${info.render.triangles}`,
      )
      perfLastLog = t
      perfFrames = 0
      perfDtSum = 0
      perfSlow = 0
    }

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
