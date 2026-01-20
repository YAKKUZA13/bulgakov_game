import * as THREE from 'three'
import type { PhysicsWorld } from '../../physics/world'

export type RunnerInput = {
  moveX: number
  jumpPressed: boolean
}

export type RunnerState = {
  mesh: THREE.Mesh
  body: import('cannon-es').Body
}

export function createRunner(params: {
  scene: THREE.Scene
  physics: PhysicsWorld
  startPosition?: THREE.Vector3
}) {
  const { scene, physics } = params
  const start = params.startPosition ?? new THREE.Vector3(0, 1, 0)

  const geom = new THREE.BoxGeometry(0.25, 0.25, 0.25)
  const mat = new THREE.MeshStandardMaterial({ color: 0x3c78ff })
  const mesh = new THREE.Mesh(geom, mat)
  mesh.position.copy(start)
  scene.add(mesh)

  const body = physics.addBox(mesh, new THREE.Vector3(0.25, 0.25, 0.25), 1)
  body.linearDamping = 0.35
  body.angularDamping = 0.7

  const input: RunnerInput = { moveX: 0, jumpPressed: false }

  function setInput(next: RunnerInput) {
    input.moveX = next.moveX
    input.jumpPressed = next.jumpPressed
  }

  function update() {
    // Move forward (Z) in world space; allow strafe left/right on X.
    const speed = 1.2
    const strafe = 1.0
    const desired = new THREE.Vector3(input.moveX * strafe, 0, -speed)
    body.velocity.x = desired.x
    body.velocity.z = desired.z

    if (input.jumpPressed && Math.abs(body.velocity.y) < 0.05) {
      body.velocity.y = 3.2
    }
  }

  function setPosition(pos: THREE.Vector3) {
    body.position.set(pos.x, pos.y, pos.z)
    body.velocity.set(0, 0, 0)
  }

  return { mesh, body, setInput, update, setPosition }
}
