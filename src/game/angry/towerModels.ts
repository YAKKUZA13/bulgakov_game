import * as THREE from 'three'
import type { PhysicsWorld } from '../../physics/world'

export type TowerModel = {
    mesh: THREE.Mesh
    body: import('cannon-es').Body
    mat: THREE.Material
}

export function createTowerModelRedTower(params: {
    scene: THREE.Scene
    physics: PhysicsWorld
    position?: THREE.Vector3
}): TowerModel {
    const { scene, physics } = params
    const pos = params.position ?? new THREE.Vector3(0, 0.5, -1)

    const geom = new THREE.CylinderGeometry(0.3, 0.3, 1.0, 64)
    const mat = new THREE.MeshStandardMaterial({ color: 0xff0000 })
    const mesh = new THREE.Mesh(geom, mat)
    mesh.position.copy(pos)
    scene.add(mesh)

    // Use cylinder physics shape (approximated with box) instead of sphere
    const body = physics.addCylinder(mesh, 0.3, 1.0, 0.2)

    return { mesh, body, mat }
}

export function createTowerModelConicalBlueTower(params: {
    scene: THREE.Scene
    physics: PhysicsWorld
    position?: THREE.Vector3
}): TowerModel {
    const { scene, physics } = params
    const pos = params.position ?? new THREE.Vector3(0, 0.5, -1)

    const geom = new THREE.ConeGeometry(0.3, 1.0, 64)
    const mat = new THREE.MeshStandardMaterial({ color: 0x0000ff })
    const mesh = new THREE.Mesh(geom, mat)
    mesh.position.copy(pos)
    scene.add(mesh)

    // Use cylinder physics shape (approximated with box) instead of sphere
    const body = physics.addCylinder(mesh, 0.3, 1.0, 0.2)

    return { mesh, body, mat }
}

export function createTowerModelGreenPillar(params: {
    scene: THREE.Scene
    physics: PhysicsWorld
    position?: THREE.Vector3
}): TowerModel {
    const { scene, physics } = params
    const pos = params.position ?? new THREE.Vector3(0, 0.5, -1)

    const geom = new THREE.CylinderGeometry(0.15, 0.15, 1.5, 64)
    const mat = new THREE.MeshStandardMaterial({ color: 0x00ff00 })
    const mesh = new THREE.Mesh(geom, mat)
    mesh.position.copy(pos)
    scene.add(mesh)

    // Use cylinder physics shape (approximated with box) instead of sphere
    const body = physics.addCylinder(mesh, 0.15, 1.5, 0.2)

    return { mesh, body, mat }
}

export function createTowerModelYellowWideTower(params: {
    scene: THREE.Scene
    physics: PhysicsWorld
    position?: THREE.Vector3
}): TowerModel {
    const { scene, physics } = params
    const pos = params.position ?? new THREE.Vector3(0, 0.5, -1)

    const geom = new THREE.CylinderGeometry(0.4, 0.4, 0.8, 64)
    const mat = new THREE.MeshStandardMaterial({ color: 0xffff00 })
    const mesh = new THREE.Mesh(geom, mat)
    mesh.position.copy(pos)
    scene.add(mesh)

    // Use cylinder physics shape (approximated with box) instead of sphere
    const body = physics.addCylinder(mesh, 0.4, 0.8, 0.2)

    return { mesh, body, mat }
}