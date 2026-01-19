import * as THREE from 'three'
import type { DepthResult } from './depth'

export type DepthMeshOptions = {
  /** Larger => more detail but heavier */
  stride: number
  /** Controls depth exaggeration */
  zScale: number
  /** Invert depth direction if needed */
  invert: boolean
  /** Texture anisotropy for sharpness (set from renderer capabilities). */
  anisotropy: number
}

const DEFAULTS: DepthMeshOptions = {
  stride: 2,
  zScale: 1.8,
  invert: true,
  anisotropy: 1,
}

export function createDepthMesh(depth: DepthResult, opts?: Partial<DepthMeshOptions>) {
  const o: DepthMeshOptions = { ...DEFAULTS, ...(opts ?? {}) }
  const stride = Math.max(1, Math.floor(o.stride))

  const w = depth.width
  const h = depth.height
  const gw = Math.max(2, Math.floor(w / stride))
  const gh = Math.max(2, Math.floor(h / stride))

  // Geometry in camera-facing plane. We'll displace vertices along +Z.
  const aspect = h / w
  const geom = new THREE.PlaneGeometry(1, aspect, gw - 1, gh - 1)
  const pos = geom.getAttribute('position') as THREE.BufferAttribute

  // Map plane vertices to depth pixels
  for (let iy = 0; iy < gh; iy++) {
    const py = Math.min(h - 1, Math.floor((iy / (gh - 1)) * (h - 1)))
    for (let ix = 0; ix < gw; ix++) {
      const px = Math.min(w - 1, Math.floor((ix / (gw - 1)) * (w - 1)))
      const d = depth.depth01[py * w + px] ?? 0.5
      const dz = (o.invert ? 1 - d : d) * o.zScale
      const i = iy * gw + ix
      pos.setZ(i, dz)
    }
  }
  pos.needsUpdate = true
  geom.computeVertexNormals()

  // Texture from captured RGB canvas
  const tex = new THREE.CanvasTexture(depth.rgbCanvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = true
  tex.anisotropy = Math.max(1, Math.floor(o.anisotropy))
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.needsUpdate = true

  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    side: THREE.DoubleSide,
  })

  const mesh = new THREE.Mesh(geom, mat)
  mesh.frustumCulled = false
  return { mesh, texture: tex, geometry: geom }
}


