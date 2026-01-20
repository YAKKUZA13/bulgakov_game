import * as THREE from 'three'

export type TreasureItem = {
  id: string
  mesh: THREE.Mesh
  found: boolean
}

export function createTreasureMode(params: { scene: THREE.Scene }) {
  const { scene } = params
  const items: TreasureItem[] = []

  function reset(center = new THREE.Vector3(0, 0.6, -1)) {
    clear()
    const mat = new THREE.MeshStandardMaterial({ color: 0x56ff8a })
    for (let i = 0; i < 3; i++) {
      const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 0), mat)
      mesh.position.set(center.x + (Math.random() - 0.5) * 1.2, center.y + 0.1, center.z + (Math.random() - 0.5) * 1.2)
      scene.add(mesh)
      items.push({ id: `treasure_${i}`, mesh, found: false })
    }
  }

  function update(camera: THREE.Camera, occluders: THREE.Object3D[] = []) {
    const camPos = new THREE.Vector3()
    camera.getWorldPosition(camPos)
    const camDir = new THREE.Vector3()
    camera.getWorldDirection(camDir)
    const raycaster = new THREE.Raycaster()

    for (const item of items) {
      if (item.found) continue
      const toItem = item.mesh.position.clone().sub(camPos)
      const dist = toItem.length()
      const angle = camDir.angleTo(toItem.normalize())
      if (occluders.length > 0) {
        raycaster.set(camPos, toItem)
        const hits = raycaster.intersectObjects(occluders, false)
        if (hits.length > 0 && hits[0].distance < dist) {
          continue
        }
      }
      if (dist < 0.6 && angle < THREE.MathUtils.degToRad(25)) {
        item.found = true
        item.mesh.material = new THREE.MeshStandardMaterial({ color: 0x2b5cff })
      }
    }
  }

  function clear() {
    for (const item of items) {
      item.mesh.removeFromParent()
    }
    items.length = 0
  }

  return { items, reset, update, clear }
}
