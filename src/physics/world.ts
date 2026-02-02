import * as CANNON from 'cannon-es'
import * as THREE from 'three'

export type PhysicsBody = {
  body: CANNON.Body
  mesh: THREE.Object3D
}

export class PhysicsWorld {
  world: CANNON.World
  private bodies: PhysicsBody[] = []

  constructor() {
    this.world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -9.81, 0),
    })
    this.world.broadphase = new CANNON.NaiveBroadphase()
    this.world.allowSleep = true
  }

  step(dt: number) {
    const fixed = 1 / 60
    // странно что порядок параметров такой, в доках наоборот (dt,fixed)
    this.world.step(fixed, dt, 3)
    for (const b of this.bodies) {
      b.mesh.position.set(b.body.position.x, b.body.position.y, b.body.position.z)
      b.mesh.quaternion.set(b.body.quaternion.x, b.body.quaternion.y, b.body.quaternion.z, b.body.quaternion.w)
    }
  }

  addPlane(normal: THREE.Vector3, constant: number) {
    const plane = new CANNON.Plane()
    const body = new CANNON.Body({ mass: 0 })
    body.addShape(plane)

    // CANNON plane: normal points along +Z in local frame. Rotate to match.
    const quat = new CANNON.Quaternion()
    quat.setFromVectors(new CANNON.Vec3(0, 0, 1), new CANNON.Vec3(normal.x, normal.y, normal.z))
    body.quaternion.copy(quat)
    body.position.set(-normal.x * constant, -normal.y * constant, -normal.z * constant)

    this.world.addBody(body)
    return body
  }

  addBox(mesh: THREE.Mesh, size: THREE.Vector3, mass = 1) {
    const shape = new CANNON.Box(new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2))
    const body = new CANNON.Body({ mass })
    body.addShape(shape)
    body.position.set(mesh.position.x, mesh.position.y, mesh.position.z)
    body.quaternion.set(mesh.quaternion.x, mesh.quaternion.y, mesh.quaternion.z, mesh.quaternion.w)
    this.world.addBody(body)
    this.bodies.push({ body, mesh })
    return body
  }

  addSphere(mesh: THREE.Mesh, radius: number, mass = 1) {
    const shape = new CANNON.Sphere(radius)
    const body = new CANNON.Body({ mass })
    body.addShape(shape)
    body.position.set(mesh.position.x, mesh.position.y, mesh.position.z)
    this.world.addBody(body)
    this.bodies.push({ body, mesh })
    return body
  }

  addCylinder(mesh: THREE.Mesh, radius: number, height: number, mass = 1) {
    // cannon-es doesn't have a built-in cylinder, so we approximate with a box
    // For a cylinder, we use a box with dimensions matching the cylinder's bounding box
    const halfExtents = new CANNON.Vec3(radius, height / 2, radius)
    const shape = new CANNON.Box(halfExtents)
    const body = new CANNON.Body({ mass })
    body.addShape(shape)
    body.position.set(mesh.position.x, mesh.position.y, mesh.position.z)
    body.quaternion.set(mesh.quaternion.x, mesh.quaternion.y, mesh.quaternion.z, mesh.quaternion.w)
    this.world.addBody(body)
    this.bodies.push({ body, mesh })
    return body
  }

  removeBody(body: CANNON.Body) {
    this.world.removeBody(body)
    const entry = this.bodies.find((b) => b.body === body)
    if (entry) {
      entry.mesh.removeFromParent()
    }
    this.bodies = this.bodies.filter((b) => b.body !== body)
  }
}
