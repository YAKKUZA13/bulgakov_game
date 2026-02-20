import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { PhysicsWorld } from '../../physics/world'

export type DogTarget = {
  root: THREE.Object3D
  mixer: THREE.AnimationMixer | null
  hitClip: THREE.AnimationClip | null
  velocity: THREE.Vector3
  collisionVelocity: THREE.Vector3
  hitRadius: number
  hitCenterOffset: THREE.Vector3
  offset: THREE.Vector3
  spawnedAt: number
  isDying: boolean
  removeAt: number
}

export type Projectile = {
  body: import('cannon-es').Body
  radius: number
  prevPosition: THREE.Vector3
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

export type DogAimTarget = {
  center: THREE.Vector3
  radius: number
}

const MAX_DOGS = 8
const SPAWN_INTERVAL_MS = 900
const MIN_SPAWN_DIST = 3.0
const MAX_SPAWN_DIST = 7.0
const DOG_SPEED = 0.7
const DOG_RADIUS = 0.25
const DOG_MIN_HIT_RADIUS = 0.8
const DOG_HIT_RADIUS_SCALE = 1.55
const DOG_MIN_Y_OFFSET = -0.6
const DOG_MAX_Y_OFFSET = 0.9
const DOG_SCALE = 0.9
const DOG_MODEL_URLS = ['models3D/dogdog.glb', 'models3D/dogdog2.glb', 'models3D/dogdog3.glb', 'models3D/dogdog4.glb']
const DOG_IDLE_ANIMATION_INDICES = [0, 1, 3]
const DOG_HIT_ANIMATION_INDEX = 2
const DOG_FACING_Y_OFFSET = -(Math.PI / 2)
const DOG_COLLISION_RADIUS_SCALE = 0.45
const DOG_COLLISION_BOUNCE = 1.6
const DOG_COLLISION_DAMPING = 4.0
const DOG_GLOSS_ROUGHNESS = 0.26
const DOG_GLOSS_METALNESS = 0.08
const DOG_GLOSS_CLEARCOAT = 0.6
const DOG_GLOSS_CLEARCOAT_ROUGHNESS = 0.2
const DOG_GLOSS_ENV_INTENSITY = 1.45
const DOG_BRIGHTNESS_BOOST = 1.06
const DOG_DESPAWN_DISTANCE_TO_CAMERA = 1.7
const PROJECTILE_RADIUS = 0.12
const PROJECTILE_TTL_MS = 4500
const PROJECTILE_MODEL_URL = 'models3D/starr.glb'

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
  let dogTemplates: Array<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }> = []
  let dogTemplatePromise: Promise<void> | null = null
  let projectileTemplate: THREE.Object3D | null = null
  let projectileTemplatePromise: Promise<void> | null = null

  function clearProjectiles() {
    for (const p of state.projectiles) physics.removeBody(p.body)
    state.projectiles.length = 0
  }

  function clearDogs() {
    for (const d of state.dogs) {
      d.mixer?.stopAllAction()
      d.root.removeFromParent()
    }
    state.dogs.length = 0
  }

  function reset() {
    hideTrajectory()
    clearDogs()
    clearProjectiles()
    state.score = 0
    state.lastSpawnT = performance.now()
  }

  function ensureDogTemplate() {
    if (dogTemplates.length > 0 || dogTemplatePromise) return
    const loader = new GLTFLoader()
    dogTemplatePromise = Promise.all(
      DOG_MODEL_URLS.map(async (modelPath) => {
        const url = new URL(modelPath, window.location.href).toString()
        const gltf = await loader.loadAsync(url)
        return { scene: gltf.scene, animations: gltf.animations }
      }),
    )
      .then((templates) => {
        dogTemplates = templates
      })
      .catch((err) => {
        console.warn('[angry] dog models load failed', err)
        dogTemplatePromise = null
      })
  }

  function ensureProjectileTemplate() {
    if (projectileTemplate || projectileTemplatePromise) return
    const loader = new GLTFLoader()
    const url = new URL(PROJECTILE_MODEL_URL, window.location.href).toString()
    projectileTemplatePromise = loader
      .loadAsync(url)
      .then((gltf) => {
        projectileTemplate = gltf.scene
      })
      .catch((err) => {
        console.warn('[angry] projectile model load failed', err)
        projectileTemplatePromise = null
      })
  }

  function applyDogShading(root: THREE.Object3D) {
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh) return
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const material of materials) {
        if (material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshPhysicalMaterial) {
          material.roughness = Math.min(material.roughness, DOG_GLOSS_ROUGHNESS)
          material.metalness = Math.max(material.metalness, DOG_GLOSS_METALNESS)
          material.envMapIntensity = Math.max(material.envMapIntensity, DOG_GLOSS_ENV_INTENSITY)
          if (material instanceof THREE.MeshPhysicalMaterial) {
            material.clearcoat = Math.max(material.clearcoat, DOG_GLOSS_CLEARCOAT)
            material.clearcoatRoughness = Math.min(material.clearcoatRoughness, DOG_GLOSS_CLEARCOAT_ROUGHNESS)
          }
          material.emissive.multiplyScalar(DOG_BRIGHTNESS_BOOST)
          material.needsUpdate = true
        }
      }
    })
  }

  function isSpawnSpotFree(pos: THREE.Vector3) {
    for (const dog of state.dogs) {
      if (dog.isDying) continue
      const minDist = (dog.hitRadius + DOG_MIN_HIT_RADIUS) * DOG_COLLISION_RADIUS_SCALE
      const dx = dog.root.position.x - pos.x
      const dz = dog.root.position.z - pos.z
      if (dx * dx + dz * dz < minDist * minDist) return false
    }
    return true
  }

  function spawnDog(playerPos: THREE.Vector3) {
    if (state.dogs.length >= MAX_DOGS) return
    if (!dogTemplates.length) return
    const dogTemplate = dogTemplates[Math.floor(Math.random() * dogTemplates.length)]
    if (!dogTemplate) return
    const angle = Math.random() * Math.PI * 2
    const dist = THREE.MathUtils.lerp(MIN_SPAWN_DIST, MAX_SPAWN_DIST, Math.random())
    const yOffset = THREE.MathUtils.lerp(DOG_MIN_Y_OFFSET, DOG_MAX_Y_OFFSET, Math.random())
    const pos = new THREE.Vector3(
      playerPos.x + Math.cos(angle) * dist,
      Math.max(0.2, playerPos.y + yOffset),
      playerPos.z + Math.sin(angle) * dist,
    )
    if (!isSpawnSpotFree(pos)) return
    const root = SkeletonUtils.clone(dogTemplate.scene) as THREE.Object3D
    root.position.copy(pos)
    root.scale.setScalar(DOG_SCALE)
    root.rotation.y = Math.random() * Math.PI * 2
    applyDogShading(root)
    scene.add(root)
    const bounds = new THREE.Box3().setFromObject(root)
    const sphere = bounds.getBoundingSphere(new THREE.Sphere())
    let mixer: THREE.AnimationMixer | null = null
    const idleCandidates = DOG_IDLE_ANIMATION_INDICES.map((idx) => dogTemplate.animations[idx]).filter(
      (clip): clip is THREE.AnimationClip => Boolean(clip),
    )
    const idleClip =
      idleCandidates.length > 0 ? idleCandidates[Math.floor(Math.random() * idleCandidates.length)] : null
    const hitClip = dogTemplate.animations[DOG_HIT_ANIMATION_INDEX] ?? null
    if (idleClip) {
      mixer = new THREE.AnimationMixer(root)
      mixer.clipAction(idleClip).play()
    }
    const offset = new THREE.Vector3(
      THREE.MathUtils.lerp(-0.6, 0.6, Math.random()),
      THREE.MathUtils.lerp(-0.4, 0.5, Math.random()),
      THREE.MathUtils.lerp(-0.6, 0.6, Math.random()),
    )
    state.dogs.push({
      root,
      mixer,
      hitClip,
      velocity: new THREE.Vector3(),
      collisionVelocity: new THREE.Vector3(),
      hitRadius: Math.max(DOG_RADIUS, DOG_MIN_HIT_RADIUS, sphere.radius * DOG_HIT_RADIUS_SCALE),
      hitCenterOffset: sphere.center.clone().sub(root.position),
      offset,
      spawnedAt: performance.now(),
      isDying: false,
      removeAt: 0,
    })
  }

  function updateDogs(dt: number, playerPos: THREE.Vector3) {
    const now = performance.now()
    for (let i = state.dogs.length - 1; i >= 0; i -= 1) {
      const d = state.dogs[i]
      if (!d) continue
      if (d.isDying) {
        d.mixer?.update(dt)
        if (now >= d.removeAt) {
          d.mixer?.stopAllAction()
          d.root.removeFromParent()
          state.dogs.splice(i, 1)
        }
        continue
      }
      d.offset.lerp(new THREE.Vector3(0, 0, 0), Math.min(1, dt * 0.4))
      const target = playerPos.clone().add(d.offset)
      const dir = target.sub(d.root.position).normalize()
      d.collisionVelocity.multiplyScalar(Math.exp(-DOG_COLLISION_DAMPING * dt))
      d.velocity.copy(dir).multiplyScalar(DOG_SPEED).add(d.collisionVelocity)
      d.root.position.addScaledVector(d.velocity, dt)
      d.root.lookAt(playerPos.x, d.root.position.y, playerPos.z)
      d.root.rotateY(DOG_FACING_Y_OFFSET)
      d.mixer?.update(dt)
    }

    for (let i = 0; i < state.dogs.length; i += 1) {
      const a = state.dogs[i]
      if (!a || a.isDying) continue
      for (let j = i + 1; j < state.dogs.length; j += 1) {
        const b = state.dogs[j]
        if (!b || b.isDying) continue
        const delta = b.root.position.clone().sub(a.root.position)
        delta.y = 0
        let dist = delta.length()
        const minDist = (a.hitRadius + b.hitRadius) * DOG_COLLISION_RADIUS_SCALE
        if (dist >= minDist) continue
        if (dist < 1e-4) {
          delta.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize()
          dist = 1
        } else {
          delta.multiplyScalar(1 / dist)
        }
        const push = (minDist - dist) * 0.5
        a.root.position.addScaledVector(delta, -push)
        b.root.position.addScaledVector(delta, push)
        const relative = b.velocity.clone().sub(a.velocity)
        const towardsSpeed = Math.max(0, -relative.dot(delta))
        const impulse = DOG_COLLISION_BOUNCE + towardsSpeed
        a.collisionVelocity.addScaledVector(delta, -impulse)
        b.collisionVelocity.addScaledVector(delta, impulse)
      }
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
      const curr = new THREE.Vector3(proj.body.position.x, proj.body.position.y, proj.body.position.z)
      for (let j = state.dogs.length - 1; j >= 0; j -= 1) {
        const dog = state.dogs[j]
        if (dog.isDying) continue
        const center = dog.root.position.clone().add(dog.hitCenterOffset)
        const hitDist = distancePointToSegment(center, proj.prevPosition, curr)
        if (hitDist <= dog.hitRadius + proj.radius) {
          const nowHit = performance.now()
          dog.isDying = true
          if (dog.mixer && dog.hitClip) {
            dog.mixer.stopAllAction()
            const hitAction = dog.mixer.clipAction(dog.hitClip)
            hitAction.reset()
            hitAction.setLoop(THREE.LoopOnce, 1)
            hitAction.clampWhenFinished = true
            hitAction.play()
            dog.removeAt = nowHit + Math.max(100, dog.hitClip.duration * 1000)
          } else {
            dog.removeAt = nowHit + 180
          }
          physics.removeBody(proj.body)
          state.projectiles.splice(i, 1)
          state.score += 1
          break
        }
      }
      proj.prevPosition.copy(curr)
    }
    for (let k = state.dogs.length - 1; k >= 0; k -= 1) {
      const dog = state.dogs[k]
      if (dog.isDying) continue
      if (dog.root.position.distanceTo(playerPos) < DOG_DESPAWN_DISTANCE_TO_CAMERA) {
        dog.mixer?.stopAllAction()
        dog.root.removeFromParent()
        state.dogs.splice(k, 1)
      }
    }
  }

  function update(dt: number, playerPos: THREE.Vector3) {
    const now = performance.now()
    ensureDogTemplate()
    ensureProjectileTemplate()
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
    let mesh: THREE.Mesh
    if (projectileTemplate) {
      const projectileRoot = SkeletonUtils.clone(projectileTemplate)
      const firstMesh = projectileRoot.getObjectByProperty('isMesh', true) as THREE.Mesh | undefined
      if (firstMesh) {
        const clonedMaterial = Array.isArray(firstMesh.material)
          ? firstMesh.material.map((m) => m.clone())
          : firstMesh.material.clone()
        mesh = new THREE.Mesh(firstMesh.geometry, clonedMaterial)
        mesh.scale.copy(firstMesh.getWorldScale(new THREE.Vector3()))
      } else {
        mesh = new THREE.Mesh(
          new THREE.SphereGeometry(radius, 18, 18),
          new THREE.MeshStandardMaterial({ color: 0xff4b4b }),
        )
      }
    } else {
      mesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 18, 18),
        new THREE.MeshStandardMaterial({ color: 0xff4b4b }),
      )
    }
    mesh.position.copy(from)
    scene.add(mesh)
    const body = physics.addSphere(mesh, radius, 0.9)
    const impulse = dir.clone().normalize().multiplyScalar(power)
    body.velocity.set(impulse.x, impulse.y, impulse.z)
    state.projectiles.push({ body, radius, prevPosition: from.clone(), spawnedAt: performance.now() })
  }

  function distancePointToSegment(point: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) {
    const ab = b.clone().sub(a)
    const ap = point.clone().sub(a)
    const lenSq = ab.lengthSq()
    if (lenSq <= 1e-8) return point.distanceTo(a)
    const t = THREE.MathUtils.clamp(ap.dot(ab) / lenSq, 0, 1)
    const closest = a.clone().addScaledVector(ab, t)
    return point.distanceTo(closest)
  }

  return {
    state,
    reset,
    update,
    launch,
    showTrajectory,
    hideTrajectory,
    getDogRoots: () => state.dogs.filter((d) => !d.isDying).map((d) => d.root),
    getDogAimTargets: () =>
      state.dogs
        .filter((d) => !d.isDying)
        .map((d) => ({ center: d.root.position.clone().add(d.hitCenterOffset), radius: d.hitRadius })),
    getScore: () => state.score,
    clear: () => {
      hideTrajectory()
      clearDogs()
      clearProjectiles()
    },
  }
}
