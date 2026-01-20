import * as THREE from 'three'
import type { PhysicsWorld } from '../../physics/world'

export type AngryState = {
  structures: import('cannon-es').Body[]
  projectiles: import('cannon-es').Body[]
}

export function createAngryMode(params: {
  scene: THREE.Scene
  physics: PhysicsWorld
}) {
  const { scene, physics } = params
  const state: AngryState = { structures: [], projectiles: [] }

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

    for (let i = 0; i < 6; i++) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), mat)
      mesh.position.set(basePos.x + (i % 3) * 0.3, basePos.y + Math.floor(i / 3) * 0.3, basePos.z)
      scene.add(mesh)
      const body = physics.addBox(mesh, size, 0.7)
      state.structures.push(body)
    }
  }

  function launch(from: THREE.Vector3, dir: THREE.Vector3, power: number) {
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
    clear: () => {
      clearBodies(state.structures)
      clearBodies(state.projectiles)
    },
  }
}
