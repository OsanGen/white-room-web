import type {
  AnimatePropPayload,
  DespawnPropPayload,
  SpaceDistortionPayload,
  SpawnPropPayload,
  WorldDirective,
} from "@white-room/shared";
import type { Vec2 } from "../player/TopDownController";

interface DynamicWorldRuntime2DOptions {
  max_props?: number;
  max_distortions?: number;
}

interface AnchorPoints2D {
  rabbit: Vec2;
  player: Vec2;
  room: Vec2;
}

interface ActiveProp2D {
  id: string;
  kind: SpawnPropPayload["prop_kind"];
  color: string;
  anchor: "rabbit" | "player" | "room";
  offset: Vec2;
  created_at_ms: number;
  expires_at_ms: number;
  base_radius: number;
  amplitude: number;
  speed: number;
  animation: "pulse" | "oscillate" | "float";
  position: Vec2;
  draw_radius: number;
}

interface ActiveDistortion2D {
  id: string;
  distortion: SpaceDistortionPayload["distortion"];
  anchor: "rabbit" | "player" | "room";
  offset: Vec2;
  created_at_ms: number;
  expires_at_ms: number;
  intensity: number;
  radius: number;
  position: Vec2;
}

interface RoomVisualProfile2D {
  orb: string;
  pillar: string;
  shard: string;
  ribbon: string;
  echo_cube: string;
  distortion: string;
}

export interface DynamicWorldSnapshot2D {
  active_prop_count: number;
  active_distortion_count: number;
  active_prop_ids: string[];
  active_distortion_ids: string[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function hashUnit(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return (hash % 1000) / 1000;
}

export class DynamicWorldRuntime2D {
  private readonly maxProps: number;
  private readonly maxDistortions: number;
  private readonly props = new Map<string, ActiveProp2D>();
  private readonly distortions = new Map<string, ActiveDistortion2D>();
  private visualProfile: RoomVisualProfile2D;
  private anchors: AnchorPoints2D = {
    rabbit: { x: 0, y: 0 },
    player: { x: 0, y: 0 },
    room: { x: 0, y: 0 },
  };

  constructor(options: DynamicWorldRuntime2DOptions = {}) {
    this.maxProps = options.max_props ?? 6;
    this.maxDistortions = options.max_distortions ?? 2;
    this.visualProfile = {
      orb: "rgba(124, 190, 240, 0.8)",
      pillar: "rgba(245, 200, 150, 0.82)",
      shard: "rgba(150, 230, 190, 0.82)",
      ribbon: "rgba(220, 180, 250, 0.8)",
      echo_cube: "rgba(255, 230, 140, 0.78)",
      distortion: "rgba(80, 155, 192, 0.33)",
    };
  }

  applyDirectives(directives: WorldDirective[], nowMs: number): void {
    for (const directive of directives) {
      switch (directive.type) {
        case "spawn_prop":
          this.handleSpawnProp(directive, directive.payload as SpawnPropPayload, nowMs);
          break;
        case "animate_prop":
          this.handleAnimateProp(directive, directive.payload as AnimatePropPayload, nowMs);
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

  setVisualProfile(profile: Partial<RoomVisualProfile2D>): void {
    this.visualProfile = {
      ...this.visualProfile,
      ...profile,
    };

    for (const prop of this.props.values()) {
      prop.color = this.resolvePropColor(prop.kind);
    }
  }

  update(nowMs: number, deltaSeconds: number, anchors: AnchorPoints2D): void {
    this.anchors = anchors;

    for (const [id, prop] of this.props) {
      if (prop.expires_at_ms <= nowMs) {
        this.props.delete(id);
        continue;
      }

      const base = this.anchorPosition(prop.anchor);
      const phase = nowMs * 0.001 * prop.speed;
      prop.position.x = base.x + prop.offset.x;
      prop.position.y = base.y + prop.offset.y;
      prop.draw_radius = prop.base_radius;

      if (prop.animation === "float") {
        prop.position.y += Math.sin(phase) * prop.amplitude * 14;
      } else if (prop.animation === "oscillate") {
        prop.position.x += Math.cos(phase) * prop.amplitude * 16;
        prop.position.y += Math.sin(phase * 0.7) * prop.amplitude * 12;
      } else {
        prop.draw_radius = prop.base_radius * (1 + (Math.sin(phase * 1.8) * 0.5 + 0.5) * prop.amplitude);
      }

      // Mild drift to avoid static-looking overlays.
      prop.position.x += Math.sin(phase * 0.35) * deltaSeconds * 8;
    }

    for (const [id, distortion] of this.distortions) {
      if (distortion.expires_at_ms <= nowMs) {
        this.distortions.delete(id);
        continue;
      }
      const base = this.anchorPosition(distortion.anchor);
      distortion.position.x = base.x + distortion.offset.x;
      distortion.position.y = base.y + distortion.offset.y;
    }
  }

  draw(ctx: CanvasRenderingContext2D, nowMs: number): void {
    const time = nowMs * 0.001;

    for (const distortion of this.distortions.values()) {
      const pulse = 1 + Math.sin(time * 3.1) * 0.08 * distortion.intensity;
      const radius = distortion.radius * pulse;

      ctx.save();
      ctx.translate(distortion.position.x, distortion.position.y);
      ctx.strokeStyle = this.visualProfile.distortion;
      ctx.lineWidth = 1.4;

      if (distortion.distortion === "ripple") {
        for (let i = 0; i < 3; i += 1) {
          ctx.beginPath();
          ctx.arc(0, 0, radius + i * 14, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else if (distortion.distortion === "skew") {
        const size = radius * 1.2;
        ctx.rotate(Math.sin(time * 0.8) * 0.14);
        ctx.strokeRect(-size, -size, size * 2, size * 2);
      } else {
        ctx.beginPath();
        ctx.ellipse(0, 0, radius * 1.2, radius * 0.75, Math.sin(time) * 0.25, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.restore();
    }

    for (const prop of this.props.values()) {
      ctx.save();
      ctx.translate(prop.position.x, prop.position.y);
      ctx.fillStyle = prop.color;
      ctx.strokeStyle = "rgba(15, 23, 32, 0.15)";
      ctx.lineWidth = 1;

      const r = prop.draw_radius;
      switch (prop.kind) {
        case "orb":
          ctx.beginPath();
          ctx.arc(0, 0, r, 0, Math.PI * 2);
          ctx.fill();
          break;
        case "pillar":
          ctx.fillRect(-r * 0.5, -r * 1.3, r, r * 2.6);
          break;
        case "shard":
          ctx.rotate(Math.sin(time * 0.9) * 0.4);
          ctx.beginPath();
          ctx.moveTo(0, -r * 1.3);
          ctx.lineTo(r * 0.8, r);
          ctx.lineTo(-r * 0.8, r);
          ctx.closePath();
          ctx.fill();
          break;
        case "ribbon":
          ctx.rotate(time);
          ctx.beginPath();
          ctx.arc(0, 0, r * 1.1, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2);
          ctx.stroke();
          break;
        case "echo_cube":
          ctx.rotate(Math.sin(time * 0.7) * 0.25);
          ctx.fillRect(-r, -r, r * 2, r * 2);
          break;
      }
      ctx.restore();
    }
  }

  clear(): void {
    this.props.clear();
    this.distortions.clear();
  }

  getSnapshot(): DynamicWorldSnapshot2D {
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
    const scale = clamp(payload.scale ?? 1, 0.3, 2.5);
    const seed = hashUnit(directive.id);
    const angle = seed * Math.PI * 2;
    const radius = 38 + seed * 18;
    const offsetX = (payload.offset_x ?? Math.cos(angle) * (radius / 40)) * 40;
    const offsetY = (payload.offset_z ?? Math.sin(angle) * (radius / 40)) * 40;

    this.props.set(directive.id, {
      id: directive.id,
      kind: payload.prop_kind,
      color: payload.color ?? this.colorForKind(payload.prop_kind),
      anchor: directive.anchor,
      offset: { x: offsetX, y: offsetY },
      created_at_ms: nowMs,
      expires_at_ms: nowMs + directive.ttl_ms,
      base_radius: clamp(8 + directive.intensity * 12, 6, 22) * scale,
      amplitude: clamp(0.2 + directive.intensity * 0.8, 0.15, 1),
      speed: clamp(0.8 + directive.intensity * 2.2, 0.6, 4),
      animation: "float",
      position: { x: 0, y: 0 },
      draw_radius: 10,
    });
  }

  private handleAnimateProp(directive: WorldDirective, payload: AnimatePropPayload, nowMs: number): void {
    const target = this.props.get(payload.target_id);
    if (!target) {
      return;
    }

    target.animation = payload.animation;
    target.amplitude = clamp(payload.amplitude ?? (0.2 + directive.intensity * 0.7), 0.1, 1);
    target.speed = clamp(payload.speed ?? (0.9 + directive.intensity * 2.1), 0.4, 4);
    target.expires_at_ms = Math.max(target.expires_at_ms, nowMs + directive.ttl_ms);
  }

  private handleSpaceDistortion(directive: WorldDirective, payload: SpaceDistortionPayload, nowMs: number): void {
    const existing = this.distortions.get(directive.id);
    if (existing) {
      existing.expires_at_ms = nowMs + directive.ttl_ms;
      existing.anchor = directive.anchor;
      existing.intensity = directive.intensity;
      existing.radius = clamp((payload.radius ?? 1.2) * 38, 18, 190);
      return;
    }

    this.enforceDistortionBudget();
    const seed = hashUnit(directive.id);
    this.distortions.set(directive.id, {
      id: directive.id,
      distortion: payload.distortion,
      anchor: directive.anchor,
      offset: {
        x: Math.cos(seed * Math.PI * 2) * 10,
        y: Math.sin(seed * Math.PI * 2) * 10,
      },
      created_at_ms: nowMs,
      expires_at_ms: nowMs + directive.ttl_ms,
      intensity: directive.intensity,
      radius: clamp((payload.radius ?? 1.2) * 38, 18, 190),
      position: { x: 0, y: 0 },
    });
  }

  private handleDespawnProp(payload: DespawnPropPayload): void {
    if (this.props.has(payload.target_id)) {
      this.props.delete(payload.target_id);
      return;
    }
    if (this.distortions.has(payload.target_id)) {
      this.distortions.delete(payload.target_id);
    }
  }

  private anchorPosition(anchor: "rabbit" | "player" | "room"): Vec2 {
    if (anchor === "rabbit") {
      return this.anchors.rabbit;
    }
    if (anchor === "player") {
      return this.anchors.player;
    }
    return this.anchors.room;
  }

  private enforcePropBudget(): void {
    if (this.props.size < this.maxProps) {
      return;
    }
    const oldest = [...this.props.values()].sort((a, b) => a.created_at_ms - b.created_at_ms)[0];
    if (oldest) {
      this.props.delete(oldest.id);
    }
  }

  private enforceDistortionBudget(): void {
    if (this.distortions.size < this.maxDistortions) {
      return;
    }
    const oldest = [...this.distortions.values()].sort((a, b) => a.created_at_ms - b.created_at_ms)[0];
    if (oldest) {
      this.distortions.delete(oldest.id);
    }
  }

  private colorForKind(kind: SpawnPropPayload["prop_kind"]): string {
    return this.resolvePropColor(kind);
  }

  private resolvePropColor(kind: SpawnPropPayload["prop_kind"]): string {
    switch (kind) {
      case "orb":
        return "rgba(124, 190, 240, 0.8)";
      case "pillar":
        return "rgba(245, 200, 150, 0.82)";
      case "shard":
        return "rgba(150, 230, 190, 0.82)";
      case "ribbon":
        return "rgba(220, 180, 250, 0.8)";
      case "echo_cube":
        return "rgba(255, 230, 140, 0.78)";
      default:
        return "rgba(200, 220, 245, 0.8)";
    }
  }
}
