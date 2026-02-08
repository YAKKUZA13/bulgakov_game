import * as THREE from 'three'
import type { PhysicsWorld } from '../../physics/world'

export type DogTarget = {
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  radius: number
  spawnedAt: number
}

export type Projectile = {
  body: import('cannon-es').Body
  radius: number
  spawnedAt: number
}

export type AngryState = {
  dogs: DogTarget[]
  projectiles: Projectile[]
  trajectoryLine: THREE.Object3D | null
  trajectoryMarker: THREE.Mesh | null
  score: number
  lastSpawnT: number
}

export type TrajectoryPoint = {
  position: THREE.Vector3
  time: number
}

const MAX_DOGS = 8
const SPAWN_INTERVAL_MS = 900
const MIN_SPAWN_DIST = 3.0
const MAX_SPAWN_DIST = 7.0
const DOG_SPEED = 0.7
const DOG_RADIUS = 0.25
const DOG_MIN_Y_OFFSET = -0.6
const DOG_MAX_Y_OFFSET = 0.9
const PROJECTILE_RADIUS = 0.12
const PROJECTILE_TTL_MS = 4500

export function createAngryMode(params: { scene: THREE.Scene; physics: PhysicsWorld }) {
  const { scene, physics } = params
  const state: AngryState = {
    dogs: [],
    projectiles: [],
    trajectoryLine: null,
    trajectoryMarker: null,
    score: 0,
    lastSpawnT: 0,
  }

  function clearProjectiles() {
    for (const p of state.projectiles) physics.removeBody(p.body)
    state.projectiles.length = 0
  }

  function clearDogs() {
    for (const d of state.dogs) d.mesh.removeFromParent()
    state.dogs.length = 0
  }

  function reset() {
    hideTrajectory()
    clearDogs()
    clearProjectiles()
    state.score = 0
    state.lastSpawnT = performance.now()
  }

  function spawnDog(playerPos: THREE.Vector3) {
    if (state.dogs.length >= MAX_DOGS) return
    const angle = Math.random() * Math.PI * 2
    const dist = THREE.MathUtils.lerp(MIN_SPAWN_DIST, MAX_SPAWN_DIST, Math.random())
    const yOffset = THREE.MathUtils.lerp(DOG_MIN_Y_OFFSET, DOG_MAX_Y_OFFSET, Math.random())
    const pos = new THREE.Vector3(
      playerPos.x + Math.cos(angle) * dist,
      Math.max(0.2, playerPos.y + yOffset),
      playerPos.z + Math.sin(angle) * dist,
    )
    const geom = new THREE.SphereGeometry(DOG_RADIUS, 14, 14)
    const mat = new THREE.MeshStandardMaterial({ color: 0x8b5e3c })
    const mesh = new THREE.Mesh(geom, mat)
    mesh.position.copy(pos)
    scene.add(mesh)
    state.dogs.push({ mesh, velocity: new THREE.Vector3(), radius: DOG_RADIUS, spawnedAt: performance.now() })
  }

  function updateDogs(dt: number, playerPos: THREE.Vector3) {
    for (const d of state.dogs) {
      const dir = playerPos.clone().sub(d.mesh.position).normalize()
      d.velocity.copy(dir).multiplyScalar(DOG_SPEED)
      d.mesh.position.addScaledVector(d.velocity, dt)
    }
  }

  function checkHits(playerPos: THREE.Vector3) {
    const now = performance.now()
    for (let i = state.projectiles.length - 1; i >= 0; i -= 1) {
      const proj = state.projectiles[i]
      if (now - proj.spawnedAt > PROJECTILE_TTL_MS) {
        physics.removeBody(proj.body)
        state.projectiles.splice(i, 1)
        continue
      }
      const p = proj.body.position
      for (let j = state.dogs.length - 1; j >= 0; j -= 1) {
        const dog = state.dogs[j]
        const dist = dog.mesh.position.distanceTo(new THREE.Vector3(p.x, p.y, p.z))
        if (dist <= dog.radius + proj.radius) {
          dog.mesh.removeFromParent()
          state.dogs.splice(j, 1)
          physics.removeBody(proj.body)
          state.projectiles.splice(i, 1)
          state.score += 1
          break
        }
      }
    }
    for (let k = state.dogs.length - 1; k >= 0; k -= 1) {
      const dog = state.dogs[k]
      if (dog.mesh.position.distanceTo(playerPos) < 0.6) {
        dog.mesh.removeFromParent()
        state.dogs.splice(k, 1)
      }
    }
  }

  function update(dt: number, playerPos: THREE.Vector3) {
    const now = performance.now()
    if (now - state.lastSpawnT >= SPAWN_INTERVAL_MS) {
      state.lastSpawnT = now
      spawnDog(playerPos)
    }
    updateDogs(dt, playerPos)
    checkHits(playerPos)
  }

  /**
   * Рассчитывает траекторию полёта снаряда с учётом гравитации
   * @param from Начальная позиция
   * @param dir Направление (будет нормализовано)
   * @param power Сила запуска
   * @param maxTime Максимальное время симуляции (секунды)
   * @param timeStep Шаг времени для расчёта точек
   * @returns Массив точек траектории
   */
  function calculateTrajectory(
    from: THREE.Vector3,
    dir: THREE.Vector3,
    power: number,
    maxTime = 3.0,
    timeStep = 0.05,
  ): TrajectoryPoint[] {
    const gravity = 9.81 // Из PhysicsWorld
    const points: TrajectoryPoint[] = []
    const velocity = dir.clone().normalize().multiplyScalar(power)

    let t = 0

    while (t < maxTime) {
      const pos = new THREE.Vector3(
        from.x + velocity.x * t,
        from.y + velocity.y * t - 0.5 * gravity * t * t,
        from.z + velocity.z * t,
      )

      points.push({ position: pos, time: t })

      // Остановка если снаряд упал ниже начальной точки (или слишком низко)
      if (pos.y < from.y - 0.5 && t > 0.1) {
        break
      }

      t += timeStep
    }

    return points
  }

  /**
   * Показывает траекторию полёта снаряда
   */
  function showTrajectory(from: THREE.Vector3, dir: THREE.Vector3, power: number) {
    // Удаляем предыдущую траекторию
    hideTrajectory()

    const points = calculateTrajectory(from, dir, power)
    if (points.length < 2) return

    const curve = new THREE.CatmullRomCurve3(points.map((p) => p.position))
    const geometry = new THREE.TubeGeometry(curve, Math.max(16, points.length * 2), 0.015, 8, false)
    const material = new THREE.MeshBasicMaterial({ color: 0xff4b4b, opacity: 0.85, transparent: true })
    const tube = new THREE.Mesh(geometry, material)
    scene.add(tube)
    state.trajectoryLine = tube

    const end = points[points.length - 1]?.position
    if (end) {
      const markerGeom = new THREE.SphereGeometry(0.035, 10, 10)
      const markerMat = new THREE.MeshBasicMaterial({ color: 0xffc1c1 })
      const marker = new THREE.Mesh(markerGeom, markerMat)
      marker.position.copy(end)
      scene.add(marker)
      state.trajectoryMarker = marker
    }
  }

  /**
   * Скрывает траекторию
   */
  function hideTrajectory() {
    if (state.trajectoryLine) {
      scene.remove(state.trajectoryLine)
      const mesh = state.trajectoryLine as THREE.Mesh
      mesh.geometry?.dispose?.()
      const mat = mesh.material
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
      else mat.dispose()
      state.trajectoryLine = null
    }
    if (state.trajectoryMarker) {
      scene.remove(state.trajectoryMarker)
      state.trajectoryMarker.geometry.dispose()
      const mat = state.trajectoryMarker.material
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
      else mat.dispose()
      state.trajectoryMarker = null
    }
  }

  function launch(from: THREE.Vector3, dir: THREE.Vector3, power: number) {
    // Скрываем траекторию при запуске
    hideTrajectory()

    const radius = PROJECTILE_RADIUS
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 18, 18),
      new THREE.MeshStandardMaterial({ color: 0xff4b4b }),
    )
    mesh.position.copy(from)
    scene.add(mesh)
    const body = physics.addSphere(mesh, radius, 0.9)
    const impulse = dir.clone().normalize().multiplyScalar(power)
    body.velocity.set(impulse.x, impulse.y, impulse.z)
    state.projectiles.push({ body, radius, spawnedAt: performance.now() })
  }

  return {
    state,
    reset,
    update,
    launch,
    showTrajectory,
    hideTrajectory,
    getScore: () => state.score,
    clear: () => {
      hideTrajectory()
      clearDogs()
      clearProjectiles()
    },
  }
}
