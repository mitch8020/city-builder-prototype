import * as THREE from 'three'
import { MapControls } from 'three/addons/controls/MapControls.js'
import { CAMERA_LIMITS, clampCameraTarget } from './camera-utils'

interface CameraTween {
  startedAt: number
  duration: number
  fromPosition: THREE.Vector3
  fromTarget: THREE.Vector3
  toPosition: THREE.Vector3
  toTarget: THREE.Vector3
}

interface CameraRigOptions {
  width: number
  height: number
  countyBounds: [number, number, number, number]
  localOrigin: [number, number]
  onViewChange: (delay?: number) => void
}

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera
  readonly controls: MapControls
  private readonly homePosition: THREE.Vector3
  private readonly homeTarget = new THREE.Vector3()
  private readonly keys = new Set<string>()
  private readonly edgePan = new THREE.Vector2()
  private tween?: CameraTween

  constructor(
    canvas: HTMLCanvasElement,
    private readonly options: CameraRigOptions,
  ) {
    const countySize = Math.max(
      options.countyBounds[2] - options.countyBounds[0],
      options.countyBounds[3] - options.countyBounds[1],
    )
    this.camera = new THREE.PerspectiveCamera(
      34,
      options.width / options.height,
      5,
      220_000,
    )
    this.homePosition = new THREE.Vector3(
      countySize * 0.68,
      countySize * 1.12,
      countySize * 0.94,
    )
    this.camera.position.copy(this.homePosition)

    this.controls = new MapControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.minDistance = CAMERA_LIMITS.minimumDistance
    this.controls.maxDistance = countySize * 1.75
    this.controls.minPolarAngle = CAMERA_LIMITS.minimumTiltRadians
    this.controls.maxPolarAngle = CAMERA_LIMITS.maximumTiltRadians
    this.controls.screenSpacePanning = false
    this.controls.target.copy(this.homeTarget)
    this.controls.update()
    this.controls.addEventListener('change', this.handleControlsChange)
  }

  get target() {
    return this.controls.target
  }

  get distance() {
    return this.camera.position.distanceTo(this.controls.target)
  }

  home() {
    this.tweenCamera(this.homeTarget, this.homePosition.length(), 800, true)
  }

  zoomBy(factor: number) {
    const offset = this.camera.position.clone().sub(this.controls.target)
    const distance = THREE.MathUtils.clamp(
      offset.length() * factor,
      this.controls.minDistance,
      this.controls.maxDistance,
    )
    offset.setLength(distance)
    this.camera.position.copy(this.controls.target).add(offset)
    this.controls.update()
    this.options.onViewChange()
  }

  rotateToNorth() {
    const offset = this.camera.position.clone().sub(this.controls.target)
    const horizontal = Math.hypot(offset.x, offset.z)
    offset.x = 0
    offset.z = horizontal
    this.camera.position.copy(this.controls.target).add(offset)
    this.controls.update()
    this.options.onViewChange()
  }

  tiltBy(radians: number) {
    const offset = this.camera.position.clone().sub(this.controls.target)
    const spherical = new THREE.Spherical().setFromVector3(offset)
    spherical.phi = THREE.MathUtils.clamp(
      spherical.phi + radians,
      this.controls.minPolarAngle,
      this.controls.maxPolarAngle,
    )
    offset.setFromSpherical(spherical)
    this.camera.position.copy(this.controls.target).add(offset)
    this.controls.update()
    this.options.onViewChange()
  }

  flyTo(target: THREE.Vector3, distance: number, duration: number) {
    this.tweenCamera(target, distance, duration)
  }

  setKey(key: string, pressed: boolean) {
    if (pressed) this.keys.add(key)
    else this.keys.delete(key)
  }

  setEdgePan(x: number, y: number) {
    this.edgePan.set(x, y)
  }

  update(delta: number) {
    this.applyCameraTween()
    this.applyKeyboard(delta)
    this.clampTarget()
    this.controls.update()
  }

  resize(width: number, height: number) {
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
  }

  dispose() {
    this.controls.removeEventListener('change', this.handleControlsChange)
    this.controls.dispose()
  }

  private readonly handleControlsChange = () => {
    this.options.onViewChange()
  }

  private applyKeyboard(delta: number) {
    if (this.tween) return

    const offset = this.camera.position.clone().sub(this.controls.target)
    const distance = offset.length()
    const forward = this.controls.target
      .clone()
      .sub(this.camera.position)
      .setY(0)
      .normalize()
    const right = new THREE.Vector3().crossVectors(
      forward,
      new THREE.Vector3(0, 1, 0),
    )
    const direction = new THREE.Vector3()
    if (this.keys.has('w') || this.keys.has('arrowup')) direction.add(forward)
    if (this.keys.has('s') || this.keys.has('arrowdown')) direction.sub(forward)
    if (this.keys.has('d') || this.keys.has('arrowright')) direction.add(right)
    if (this.keys.has('a') || this.keys.has('arrowleft')) direction.sub(right)
    direction
      .addScaledVector(right, this.edgePan.x)
      .addScaledVector(forward, this.edgePan.y)
    if (direction.lengthSq() > 0) {
      const speed = THREE.MathUtils.clamp(distance * 0.55, 240, 10_000)
      direction.normalize().multiplyScalar(speed * delta)
      this.camera.position.add(direction)
      this.controls.target.add(direction)
      this.options.onViewChange()
    }
    if (this.keys.has('q') || this.keys.has('e')) {
      const sign = this.keys.has('q') ? 1 : -1
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), sign * delta * 1.15)
      this.camera.position.copy(this.controls.target).add(offset)
      this.options.onViewChange()
    }
    if (this.keys.has('z') || this.keys.has('x')) {
      const factor = this.keys.has('z') ? 1 - delta : 1 + delta
      this.zoomBy(factor)
    }
    if (this.keys.has('home') || this.keys.has('end')) {
      this.tiltBy((this.keys.has('home') ? -1 : 1) * delta * 0.65)
    }
  }

  private tweenCamera(
    target: THREE.Vector3,
    distance: number,
    duration: number,
    useHomePosition = false,
  ) {
    const offset = useHomePosition
      ? this.homePosition.clone()
      : this.camera.position
          .clone()
          .sub(this.controls.target)
          .setLength(distance)
    this.tween = {
      startedAt: performance.now(),
      duration,
      fromPosition: this.camera.position.clone(),
      fromTarget: this.controls.target.clone(),
      toPosition: target.clone().add(offset),
      toTarget: target.clone(),
    }
  }

  private applyCameraTween() {
    if (!this.tween) return

    const elapsed =
      (performance.now() - this.tween.startedAt) / this.tween.duration
    const progress = THREE.MathUtils.clamp(elapsed, 0, 1)
    const eased =
      progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - (-2 * progress + 2) ** 3 / 2
    this.camera.position.lerpVectors(
      this.tween.fromPosition,
      this.tween.toPosition,
      eased,
    )
    this.controls.target.lerpVectors(
      this.tween.fromTarget,
      this.tween.toTarget,
      eased,
    )
    if (progress >= 1) {
      this.tween = undefined
      this.options.onViewChange(0)
    }
  }

  private clampTarget() {
    const clamped = clampCameraTarget(
      this.controls.target.x,
      this.controls.target.z,
      this.options.countyBounds,
      this.options.localOrigin,
    )
    const dx = clamped.x - this.controls.target.x
    const dz = clamped.z - this.controls.target.z
    if (dx || dz) {
      this.controls.target.x = clamped.x
      this.controls.target.z = clamped.z
      this.camera.position.x += dx
      this.camera.position.z += dz
    }
  }
}
