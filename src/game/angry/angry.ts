import * as THREE from 'three'
import type { PhysicsWorld } from '../../physics/world'
import { createTowerModelConicalBlueTower, createTowerModelGreenPillar, createTowerModelRedTower, createTowerModelYellowWideTower } from './towerModels'

export type AngryState = {
  structures: import('cannon-es').Body[]
  projectiles: import('cannon-es').Body[]
  trajectoryLine: THREE.Line | null
}

export type TrajectoryPoint = {
  position: THREE.Vector3
  time: number
}

export function createAngryMode(params: {
  scene: THREE.Scene
  physics: PhysicsWorld
}) {
  const { scene, physics } = params
  const state: AngryState = { structures: [], projectiles: [], trajectoryLine: null }

  function clearBodies(bodies: import('cannon-es').Body[]) {
    for (const b of bodies) physics.removeBody(b)
    bodies.length = 0
  }

  function reset(structureCenter = new THREE.Vector3(0, 0.5, -1)) {
    clearBodies(state.structures)
    clearBodies(state.projectiles)

    const basePos = structureCenter.clone()
    const size = new THREE.Vector3(0.25, 0.25, 0.25)
    const mat = new THREE.MeshStandardMaterial({ color: 0xffa24f })

    // Классические блоки
    // for (let i = 0; i < 6; i++) {
    //   const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), mat)
    //   mesh.position.set(basePos.x + (i % 3) * 0.3, basePos.y + Math.floor(i / 3) * 0.3, basePos.z)
    //   scene.add(mesh)
    //   const body = physics.addBox(mesh, size, 0.7)
    //   state.structures.push(body)
    // }

    // Красные башни
    // for (let i = 0; i < 3; i++) {
    //   const towerPos = new THREE.Vector3(
    //     basePos.x + (i - 1) * 0.6,
    //     basePos.y + 0.15,
    //     basePos.z - 1.0,
    //   )

    //   const model = createTowerModelRedTower({
    //     scene,
    //     physics,
    //     position: towerPos,
    //   })

    //   state.structures.push(model.body)
    // }

    // Синие конусные башни
    // for (let i = 0; i < 3; i++) {
    //   const towerPos = new THREE.Vector3(
    //     basePos.x + (i - 1) * 0.6,
    //     basePos.y + 0.15,
    //     basePos.z - 1.0,
    //   )

    //   const model = createTowerModelConicalBlueTower({
    //     scene,
    //     physics,
    //     position: towerPos,
    //   })

    //   state.structures.push(model.body)
    // }

    // Зелёные колонны
    // for (let i = 0; i < 3; i++) {
    //   const towerPos = new THREE.Vector3(
    //     basePos.x + (i - 1) * 0.6,
    //     basePos.y + 0.15,
    //     basePos.z - 1.0,
    //   )

    //   const model = createTowerModelGreenPillar({
    //     scene,
    //     physics,
    //     position: towerPos,
    //   })

    //   state.structures.push(model.body)
    // }

    // Жёлтые пирамиды
    for (let i = 0; i < 3; i++) {
      const towerPos = new THREE.Vector3(
        basePos.x + (i - 1) * 0.6,
        basePos.y + 0.15,
        basePos.z - 1.0,
      )

      const model = createTowerModelYellowWideTower({
        scene,
        physics,
        position: towerPos,
      })

      state.structures.push(model.body)
    }
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

    // Создаём геометрию линии
    const positions = new Float32Array(points.length * 3)
    for (let i = 0; i < points.length; i++) {
      positions[i * 3] = points[i].position.x
      positions[i * 3 + 1] = points[i].position.y
      positions[i * 3 + 2] = points[i].position.z
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))

    // Материал для линии траектории (красный, полупрозрачный)
    const material = new THREE.LineBasicMaterial({
      color: 0xff4b4b,
      opacity: 0.7,
      transparent: true,
      linewidth: 2,
    })

    const line = new THREE.Line(geometry, material)
    scene.add(line)
    state.trajectoryLine = line
  }

  /**
   * Скрывает траекторию
   */
  function hideTrajectory() {
    if (state.trajectoryLine) {
      scene.remove(state.trajectoryLine)
      state.trajectoryLine.geometry.dispose()
        ; (state.trajectoryLine.material as THREE.Material).dispose()
      state.trajectoryLine = null
    }
  }

  function launch(from: THREE.Vector3, dir: THREE.Vector3, power: number) {
    // Скрываем траекторию при запуске
    hideTrajectory()

    const radius = 0.12
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 18, 18),
      new THREE.MeshStandardMaterial({ color: 0xff4b4b }),
    )
    mesh.position.copy(from)
    scene.add(mesh)
    const body = physics.addSphere(mesh, radius, 0.9)
    const impulse = dir.clone().normalize().multiplyScalar(power)
    body.velocity.set(impulse.x, impulse.y, impulse.z)
    state.projectiles.push(body)
  }

  return {
    state,
    reset,
    launch,
    showTrajectory,
    hideTrajectory,
    clear: () => {
      hideTrajectory()
      clearBodies(state.structures)
      clearBodies(state.projectiles)
    },
  }
}
