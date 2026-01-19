import * as THREE from 'three'

export type PlayerInput = {
  jumpPressed: boolean
  moveX: number // -1..+1 (left/right)
}

export type PlayerState = {
  // plane-local coordinates
  u: number
  v: number
  height: number
  velN: number
  heading: number // radians, rotation around plane normal
}

export type PlayerTuning = {
  speed: number
  strafeSpeed: number
  gravity: number
  jumpSpeed: number
  cubeSize: number
}

export function createPlayerState(): PlayerState {
  return {
    u: 0,
    v: 0,
    height: 0,
    velN: 0,
    heading: 0,
  }
}

export const defaultTuning: PlayerTuning = {
  speed: 0.8,
  strafeSpeed: 0.7,
  gravity: 3.2,
  jumpSpeed: 1.6,
  cubeSize: 0.25,
}

export function stepPlayer(state: PlayerState, input: PlayerInput, dt: number, tuning: PlayerTuning) {
  return stepPlayerWithGround(state, input, dt, tuning, 0)
}

export function stepPlayerWithGround(
  state: PlayerState,
  input: PlayerInput,
  dt: number,
  tuning: PlayerTuning,
  groundHeight: number,
) {
  state.v += tuning.speed * dt
  state.u += input.moveX * tuning.strafeSpeed * dt

  // gravity toward the plane (negative normal direction)
  state.velN -= tuning.gravity * dt
  state.height += state.velN * dt

  const onGround = state.height <= groundHeight
  if (onGround) {
    state.height = groundHeight
    state.velN = 0
    if (input.jumpPressed) {
      state.velN = tuning.jumpSpeed
      state.height += state.velN * dt
    }
  }
}

export function computePlayerPose(
  planePos: THREE.Vector3,
  planeQuat: THREE.Quaternion,
  state: PlayerState,
  tuning: PlayerTuning,
) {
  // Plane local axes (X,Y) and normal (+Z) in world
  const axisU = new THREE.Vector3(1, 0, 0).applyQuaternion(planeQuat)
  const axisV = new THREE.Vector3(0, 1, 0).applyQuaternion(planeQuat)
  const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(planeQuat)

  const half = tuning.cubeSize / 2
  const pos = new THREE.Vector3()
    .copy(planePos)
    .addScaledVector(axisU, state.u)
    .addScaledVector(axisV, state.v)
    .addScaledVector(normal, half + state.height)

  // Orientation: align cube with plane, then rotate around normal by heading
  const headingQ = new THREE.Quaternion().setFromAxisAngle(normal, state.heading)
  const quat = planeQuat.clone().multiply(headingQ)

  return { pos, quat, axisU, axisV, normal }
}


