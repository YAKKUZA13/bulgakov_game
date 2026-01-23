import * as THREE from 'three'

export type SceneBundle = {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  raycaster: THREE.Raycaster
}

export function createScene(canvas: HTMLCanvasElement): SceneBundle {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance',
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))

  const scene = new THREE.Scene()

  const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000)
  camera.rotation.reorder('YXZ')
  camera.position.set(0, 1.2, 2.5)

  scene.add(new THREE.AmbientLight(0xffffff, 0.65))
  const dir = new THREE.DirectionalLight(0xffffff, 0.8)
  dir.position.set(2, 4, 2)
  scene.add(dir)

  const raycaster = new THREE.Raycaster()

  function resize() {
    const w = canvas.clientWidth || window.innerWidth
    const h = canvas.clientHeight || window.innerHeight
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }

  resize()
  window.addEventListener('resize', resize)

  return { renderer, scene, camera, raycaster }
}

export function getPointerRay(
  bundle: SceneBundle,
  clientX: number,
  clientY: number,
  viewportW: number,
  viewportH: number,
) {
  const x = (clientX / viewportW) * 2 - 1
  const y = -(clientY / viewportH) * 2 + 1
  bundle.raycaster.setFromCamera(new THREE.Vector2(x, y), bundle.camera)
  return bundle.raycaster.ray
}


