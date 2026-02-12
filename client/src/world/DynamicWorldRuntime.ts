import * as THREE from "three";
import {
  AnimatePropPayload,
  DespawnPropPayload,
  SpaceDistortionPayload,
  SpawnPropPayload,
  WorldDirective,
} from "@white-room/shared";

interface DynamicWorldRuntimeOptions {
  max_props?: number;
  max_distortions?: number;
}

interface ActivePropRuntime {
  id: string;
  mesh: THREE.Mesh;
  anchor: "rabbit" | "player" | "room";
  created_at_ms: number;
  expires_at_ms: number;
  amplitude: number;
  speed: number;
  animation: "pulse" | "oscillate" | "float";
  base_position: THREE.Vector3;
}

interface ActiveDistortionRuntime {
  id: string;
  mesh: THREE.Mesh;
  anchor: "rabbit" | "player" | "room";
  distortion: "wave" | "skew" | "ripple";
  created_at_ms: number;
  expires_at_ms: number;
  intensity: number;
  radius: number;
}

export interface DynamicWorldSnapshot {
  active_prop_count: number;
  active_distortion_count: number;
  active_prop_ids: string[];
  active_distortion_ids: string[];
}

export class DynamicWorldRuntime {
  private readonly maxProps: number;
  private readonly maxDistortions: number;
  private readonly props = new Map<string, ActivePropRuntime>();
  private readonly distortions = new Map<string, ActiveDistortionRuntime>();
  private readonly anchorBuffer = new THREE.Vector3();
  private readonly positionBuffer = new THREE.Vector3();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly rabbit: THREE.Object3D,
    private readonly playerCamera: THREE.PerspectiveCamera,
    options: DynamicWorldRuntimeOptions = {},
  ) {
    this.maxProps = options.max_props ?? 6;
    this.maxDistortions = options.max_distortions ?? 2;
  }

  applyDirectives(directives: WorldDirective[], nowMs: number): void {
    for (const directive of directives) {
      switch (directive.type) {
        case "spawn_prop":
          this.handleSpawnProp(directive, directive.payload as SpawnPropPayload, nowMs);
          break;
        case "animate_prop":
          this.handleAnimateProp(directive.payload as AnimatePropPayload, directive, nowMs);
          break;
        case "space_distortion":
          this.handleSpaceDistortion(directive, directive.payload as SpaceDistortionPayload, nowMs);
          break;
        case "despawn_prop":
          this.handleDespawnProp(directive.payload as DespawnPropPayload);
          break;
      }
    }
  }

  update(nowMs: number, deltaSeconds: number): void {
    for (const [id, runtime] of this.props) {
      if (runtime.expires_at_ms <= nowMs) {
        this.removeProp(id);
        continue;
      }
      this.resolveAnchorPosition(runtime.anchor, this.anchorBuffer);
      runtime.base_position.copy(this.anchorBuffer);
      this.applyPropAnimation(runtime, nowMs, deltaSeconds);
    }

    for (const [id, runtime] of this.distortions) {
      if (runtime.expires_at_ms <= nowMs) {
        this.removeDistortion(id);
        continue;
      }
      this.resolveAnchorPosition(runtime.anchor, this.anchorBuffer);
      runtime.mesh.position.copy(this.anchorBuffer);
      const pulse = 1 + Math.sin(nowMs * 0.0032) * 0.08 * runtime.intensity;
      runtime.mesh.scale.setScalar(runtime.radius * pulse);
      runtime.mesh.rotation.z += deltaSeconds * 0.35 * runtime.intensity;
      runtime.mesh.rotation.y += deltaSeconds * 0.2;
    }
  }

  clear(): void {
    for (const key of this.props.keys()) {
      this.removeProp(key);
    }
    for (const key of this.distortions.keys()) {
      this.removeDistortion(key);
    }
  }

  getSnapshot(): DynamicWorldSnapshot {
    return {
      active_prop_count: this.props.size,
      active_distortion_count: this.distortions.size,
      active_prop_ids: Array.from(this.props.keys()),
      active_distortion_ids: Array.from(this.distortions.keys()),
    };
  }

  private handleSpawnProp(directive: WorldDirective, payload: SpawnPropPayload, nowMs: number): void {
    const existing = this.props.get(directive.id);
    if (existing) {
      existing.expires_at_ms = nowMs + directive.ttl_ms;
      existing.anchor = directive.anchor;
      return;
    }

    this.enforcePropBudget();
    const mesh = this.createPropMesh(payload.prop_kind, directive.intensity, payload.color);
    this.resolveAnchorPosition(directive.anchor, this.positionBuffer);
    this.positionBuffer.x += payload.offset_x ?? 0;
    this.positionBuffer.y += payload.offset_y ?? 0.3;
    this.positionBuffer.z += payload.offset_z ?? 0;
    mesh.position.copy(this.positionBuffer);
    const scale = payload.scale ?? 1;
    mesh.scale.setScalar(scale);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    this.scene.add(mesh);

    this.props.set(directive.id, {
      id: directive.id,
      mesh,
      anchor: directive.anchor,
      created_at_ms: nowMs,
      expires_at_ms: nowMs + directive.ttl_ms,
      amplitude: 0.09 + directive.intensity * 0.35,
      speed: 1 + directive.intensity * 2.2,
      animation: "float",
      base_position: mesh.position.clone(),
    });
  }

  private handleAnimateProp(payload: AnimatePropPayload, directive: WorldDirective, nowMs: number): void {
    const target = this.props.get(payload.target_id);
    if (!target) return;
    target.animation = payload.animation;
    target.amplitude = payload.amplitude ?? (0.06 + directive.intensity * 0.4);
    target.speed = payload.speed ?? (1 + directive.intensity * 2.4);
    target.expires_at_ms = Math.max(target.expires_at_ms, nowMs + directive.ttl_ms);
  }

  private handleSpaceDistortion(directive: WorldDirective, payload: SpaceDistortionPayload, nowMs: number): void {
    const existing = this.distortions.get(directive.id);
    if (existing) {
      existing.expires_at_ms = nowMs + directive.ttl_ms;
      existing.anchor = directive.anchor;
      existing.intensity = directive.intensity;
      existing.radius = payload.radius ?? 1.1;
      return;
    }

    this.enforceDistortionBudget();
    const mesh = this.createDistortionMesh(payload.distortion, directive.intensity);
    this.resolveAnchorPosition(directive.anchor, this.positionBuffer);
    mesh.position.copy(this.positionBuffer);
    this.scene.add(mesh);

    this.distortions.set(directive.id, {
      id: directive.id,
      mesh,
      anchor: directive.anchor,
      distortion: payload.distortion,
      created_at_ms: nowMs,
      expires_at_ms: nowMs + directive.ttl_ms,
      intensity: directive.intensity,
      radius: payload.radius ?? 1.1,
    });
  }

  private handleDespawnProp(payload: DespawnPropPayload): void {
    if (this.props.has(payload.target_id)) {
      this.removeProp(payload.target_id);
      return;
    }
    if (this.distortions.has(payload.target_id)) {
      this.removeDistortion(payload.target_id);
    }
  }

  private applyPropAnimation(runtime: ActivePropRuntime, nowMs: number, deltaSeconds: number): void {
    const phase = nowMs * 0.001 * runtime.speed;
    const base = runtime.base_position;
    if (runtime.animation === "float") {
      runtime.mesh.position.set(base.x, base.y + Math.sin(phase) * runtime.amplitude, base.z);
    } else if (runtime.animation === "pulse") {
      const s = 1 + (Math.sin(phase * 2) * 0.5 + 0.5) * runtime.amplitude;
      runtime.mesh.scale.setScalar(s);
      runtime.mesh.position.copy(base);
    } else {
      runtime.mesh.position.set(base.x + Math.sin(phase) * runtime.amplitude, base.y, base.z + Math.cos(phase) * runtime.amplitude);
      runtime.mesh.rotation.y += deltaSeconds * runtime.speed * 0.5;
    }
  }

  private createPropMesh(kind: SpawnPropPayload["prop_kind"], intensity: number, colorOverride?: string): THREE.Mesh {
    const color = colorOverride ?? this.colorForKind(kind);
    const material = new THREE.MeshStandardMaterial({
      color,
      metalness: 0.15 + intensity * 0.35,
      roughness: 0.3 + (1 - intensity) * 0.4,
      emissive: color,
      emissiveIntensity: 0.08 + intensity * 0.25,
      transparent: true,
      opacity: 0.88,
    });

    switch (kind) {
      case "orb":
        return new THREE.Mesh(new THREE.SphereGeometry(0.24, 18, 14), material);
      case "pillar":
        return new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.92, 12), material);
      case "shard":
        return new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.56, 8), material);
      case "ribbon":
        return new THREE.Mesh(new THREE.TorusKnotGeometry(0.18, 0.05, 64, 12), material);
      case "echo_cube":
        return new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), material);
      default:
        return new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), material);
    }
  }

  private createDistortionMesh(kind: SpaceDistortionPayload["distortion"], intensity: number): THREE.Mesh {
    const material = new THREE.MeshBasicMaterial({
      color: "#8fd8ff",
      opacity: 0.1 + intensity * 0.26,
      transparent: true,
      wireframe: true,
      depthWrite: false,
    });

    if (kind === "ripple") {
      return new THREE.Mesh(new THREE.RingGeometry(0.2, 0.8, 24, 2), material);
    }
    if (kind === "skew") {
      return new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2, 8, 8), material);
    }
    return new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.06, 12, 32), material);
  }

  private colorForKind(kind: SpawnPropPayload["prop_kind"]): string {
    switch (kind) {
      case "orb":
        return "#8ed9ff";
      case "pillar":
        return "#ffd0a8";
      case "shard":
        return "#c8f6dc";
      case "ribbon":
        return "#f4c6ff";
      case "echo_cube":
        return "#ffe87a";
      default:
        return "#d6ecff";
    }
  }

  private resolveAnchorPosition(anchor: "rabbit" | "player" | "room", target: THREE.Vector3): THREE.Vector3 {
    if (anchor === "rabbit") {
      this.rabbit.getWorldPosition(target);
      target.y += 1.1;
      return target;
    }
    if (anchor === "player") {
      target.copy(this.playerCamera.position);
      target.y -= 0.2;
      target.add(this.playerCamera.getWorldDirection(new THREE.Vector3()).multiplyScalar(1.3));
      return target;
    }
    target.set(0, -0.1, 0);
    return target;
  }

  private enforcePropBudget(): void {
    if (this.props.size < this.maxProps) return;
    const oldest = [...this.props.values()].sort((a, b) => a.created_at_ms - b.created_at_ms)[0];
    if (oldest) {
      this.removeProp(oldest.id);
    }
  }

  private enforceDistortionBudget(): void {
    if (this.distortions.size < this.maxDistortions) return;
    const oldest = [...this.distortions.values()].sort((a, b) => a.created_at_ms - b.created_at_ms)[0];
    if (oldest) {
      this.removeDistortion(oldest.id);
    }
  }

  private removeProp(id: string): void {
    const runtime = this.props.get(id);
    if (!runtime) return;
    this.scene.remove(runtime.mesh);
    runtime.mesh.geometry.dispose();
    if (Array.isArray(runtime.mesh.material)) {
      runtime.mesh.material.forEach((material) => material.dispose());
    } else {
      runtime.mesh.material.dispose();
    }
    this.props.delete(id);
  }

  private removeDistortion(id: string): void {
    const runtime = this.distortions.get(id);
    if (!runtime) return;
    this.scene.remove(runtime.mesh);
    runtime.mesh.geometry.dispose();
    if (Array.isArray(runtime.mesh.material)) {
      runtime.mesh.material.forEach((material) => material.dispose());
    } else {
      runtime.mesh.material.dispose();
    }
    this.distortions.delete(id);
  }
}
