import * as THREE from "three";

interface FirstPersonBounds {
  min_x: number;
  max_x: number;
  min_z: number;
  max_z: number;
}

interface FirstPersonControllerOptions {
  height?: number;
  walk_speed?: number;
  run_multiplier?: number;
  look_sensitivity?: number;
  bounds?: FirstPersonBounds;
}

interface FirstPersonSnapshot {
  pointer_locked: boolean;
  enabled: boolean;
  yaw: number;
  pitch: number;
}

const DEFAULT_BOUNDS: FirstPersonBounds = {
  min_x: -4.2,
  max_x: 4.2,
  min_z: -4.2,
  max_z: 4.2,
};

export class FirstPersonController {
  private readonly keysDown = new Set<string>();
  private readonly rotation = new THREE.Euler(0, 0, 0, "YXZ");
  private readonly moveVector = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly lookForward = new THREE.Vector3();

  private readonly height: number;
  private readonly walkSpeed: number;
  private readonly runMultiplier: number;
  private readonly lookSensitivity: number;
  private readonly bounds: FirstPersonBounds;

  private pointerLocked = false;
  private enabled = true;
  private yaw = 0;
  private pitch = 0;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly lockElement: HTMLElement,
    options: FirstPersonControllerOptions = {},
  ) {
    this.height = options.height ?? 1.6;
    this.walkSpeed = options.walk_speed ?? 2.4;
    this.runMultiplier = options.run_multiplier ?? 1.45;
    this.lookSensitivity = options.look_sensitivity ?? 0.0021;
    this.bounds = options.bounds ?? DEFAULT_BOUNDS;

    const initial = new THREE.Euler().setFromQuaternion(this.camera.quaternion, "YXZ");
    this.yaw = initial.y;
    this.pitch = initial.x;
    this.camera.position.y = this.height;
    this.applyRotation();

    document.addEventListener("pointerlockchange", this.onPointerLockChange);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  dispose(): void {
    document.removeEventListener("pointerlockchange", this.onPointerLockChange);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.releasePointerLock();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.keysDown.clear();
    }
  }

  requestPointerLock(): void {
    const requester = this.lockElement as HTMLElement & { requestPointerLock?: () => void };
    requester.requestPointerLock?.();
  }

  releasePointerLock(): void {
    if (document.pointerLockElement === this.lockElement) {
      void document.exitPointerLock();
    }
  }

  update(deltaSeconds: number): void {
    if (!this.enabled) {
      return;
    }

    const speed = this.keysDown.has("shift") ? this.walkSpeed * this.runMultiplier : this.walkSpeed;
    this.moveVector.set(0, 0, 0);
    this.forward.set(Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.right.set(Math.cos(this.yaw), 0, Math.sin(this.yaw));

    if (this.keysDown.has("w")) this.moveVector.add(this.forward);
    if (this.keysDown.has("s")) this.moveVector.sub(this.forward);
    if (this.keysDown.has("a")) this.moveVector.sub(this.right);
    if (this.keysDown.has("d")) this.moveVector.add(this.right);

    if (this.moveVector.lengthSq() > 0) {
      this.moveVector.normalize().multiplyScalar(speed * deltaSeconds);
      this.camera.position.add(this.moveVector);
      this.camera.position.x = THREE.MathUtils.clamp(this.camera.position.x, this.bounds.min_x, this.bounds.max_x);
      this.camera.position.z = THREE.MathUtils.clamp(this.camera.position.z, this.bounds.min_z, this.bounds.max_z);
    }
    this.camera.position.y = this.height;
  }

  getPosition(target = new THREE.Vector3()): THREE.Vector3 {
    return target.copy(this.camera.position);
  }

  getForwardDirection(target = new THREE.Vector3()): THREE.Vector3 {
    return this.camera.getWorldDirection(target).setY(0).normalize();
  }

  getSnapshot(): FirstPersonSnapshot {
    return {
      pointer_locked: this.pointerLocked,
      enabled: this.enabled,
      yaw: this.yaw,
      pitch: this.pitch,
    };
  }

  private onPointerLockChange = (): void => {
    this.pointerLocked = document.pointerLockElement === this.lockElement;
  };

  private onMouseMove = (event: MouseEvent): void => {
    if (!this.enabled || !this.pointerLocked) {
      return;
    }
    this.yaw -= event.movementX * this.lookSensitivity;
    this.pitch -= event.movementY * this.lookSensitivity;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.2, 1.2);
    this.applyRotation();
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    const key = event.key.toLowerCase();
    if (["w", "a", "s", "d", "shift"].includes(key)) {
      this.keysDown.add(key);
    }
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keysDown.delete(event.key.toLowerCase());
  };

  private applyRotation(): void {
    this.rotation.set(this.pitch, this.yaw, 0);
    this.camera.quaternion.setFromEuler(this.rotation);
    this.camera.getWorldDirection(this.lookForward);
  }
}
