import * as THREE from 'three'
import type { SceneBundle } from '../scene/scene'

export type PlaneMode = 'horizontal' | 'vertical'

export type AnchorSettings = {
  mode: PlaneMode
  depthMeters: number
  rotateDeg: number
}

export type AnchorState = AnchorSettings & {
  placed: boolean
  position: THREE.Vector3
  baseYawRad: number
}

export function createAnchorPlane(scene: THREE.Scene) {
  const geom = new THREE.PlaneGeometry(4, 4, 10, 10)
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.12,
    wireframe: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(geom, mat)
  mesh.visible = false
  scene.add(mesh)

  return { mesh }
}

function getCameraYawRad(camera: THREE.Camera) {
  const fwd = new THREE.Vector3()
  camera.getWorldDirection(fwd)
  fwd.y = 0
  if (fwd.lengthSq() < 1e-6) return 0
  fwd.normalize()
  return Math.atan2(fwd.x, fwd.z)
}

export function placeAnchorFromRay(bundle: SceneBundle, state: AnchorState, ray: THREE.Ray) {
  const p = new THREE.Vector3()
  p.copy(ray.origin).addScaledVector(ray.direction, state.depthMeters)

  state.position.copy(p)
  state.placed = true
  state.baseYawRad = getCameraYawRad(bundle.camera)
}

export function applyAnchorToPlane(planeMesh: THREE.Mesh, state: AnchorState) {
  if (!state.placed) {
    planeMesh.visible = false
    return
  }

  planeMesh.visible = true
  planeMesh.position.copy(state.position)

  const rotateRad = THREE.MathUtils.degToRad(state.rotateDeg)

  if (state.mode === 'horizontal') {
    // Make plane lie on XZ: default PlaneGeometry is XY (normal +Z).
    planeMesh.rotation.set(-Math.PI / 2, state.baseYawRad + rotateRad, 0)
  } else {
    // Vertical plane: face the camera (by yaw), allow rotate offset.
    planeMesh.rotation.set(0, state.baseYawRad + Math.PI + rotateRad, 0)
  }
}

export function nudgeAnchor(state: AnchorState, planeMesh: THREE.Mesh, dx: number, dy: number) {
  if (!state.placed) return

  // Ensure plane transform matches current state so its axes are correct
  applyAnchorToPlane(planeMesh, state)
  planeMesh.updateMatrixWorld(true)

  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(planeMesh.quaternion)
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(planeMesh.quaternion)

  // For horizontal: interpret dy as "forward" on the plane (use cross of up and right)
  if (state.mode === 'horizontal') {
    const forward = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), right).normalize()
    state.position.addScaledVector(right, dx)
    state.position.addScaledVector(forward, dy)
  } else {
    // For vertical: dx along right, dy along up
    state.position.addScaledVector(right, dx)
    state.position.addScaledVector(up, dy)
  }
}


