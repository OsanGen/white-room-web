export interface Vec2 {
  x: number;
  y: number;
}

export interface TopDownBounds {
  min_x: number;
  max_x: number;
  min_y: number;
  max_y: number;
}

interface TopDownControllerOptions {
  walk_speed?: number;
  run_multiplier?: number;
  bounds?: TopDownBounds;
}

const DEFAULT_BOUNDS: TopDownBounds = {
  min_x: 0,
  max_x: 1000,
  min_y: 0,
  max_y: 1000,
};

export class TopDownController {
  private readonly keysDown = new Set<string>();
  private readonly walkSpeed: number;
  private readonly runMultiplier: number;
  private bounds: TopDownBounds;
  private enabled = true;

  private position: Vec2 = { x: 0, y: 0 };

  constructor(start: Vec2, options: TopDownControllerOptions = {}) {
    this.walkSpeed = options.walk_speed ?? 250;
    this.runMultiplier = options.run_multiplier ?? 1.45;
    this.bounds = options.bounds ?? DEFAULT_BOUNDS;
    this.position = { x: start.x, y: start.y };

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.keysDown.clear();
    }
  }

  setBounds(bounds: TopDownBounds): void {
    this.bounds = bounds;
    this.position.x = Math.max(this.bounds.min_x, Math.min(this.bounds.max_x, this.position.x));
    this.position.y = Math.max(this.bounds.min_y, Math.min(this.bounds.max_y, this.position.y));
  }

  setPosition(position: Vec2): void {
    this.position.x = Math.max(this.bounds.min_x, Math.min(this.bounds.max_x, position.x));
    this.position.y = Math.max(this.bounds.min_y, Math.min(this.bounds.max_y, position.y));
  }

  getPosition(target: Vec2 = { x: 0, y: 0 }): Vec2 {
    target.x = this.position.x;
    target.y = this.position.y;
    return target;
  }

  update(deltaSeconds: number): void {
    if (!this.enabled || deltaSeconds <= 0) {
      return;
    }

    const up = this.keysDown.has("w") || this.keysDown.has("arrowup");
    const down = this.keysDown.has("s") || this.keysDown.has("arrowdown");
    const left = this.keysDown.has("a") || this.keysDown.has("arrowleft");
    const right = this.keysDown.has("d") || this.keysDown.has("arrowright");

    let dx = 0;
    let dy = 0;
    if (left) dx -= 1;
    if (right) dx += 1;
    if (up) dy -= 1;
    if (down) dy += 1;

    if (dx === 0 && dy === 0) {
      return;
    }

    const norm = Math.hypot(dx, dy) || 1;
    dx /= norm;
    dy /= norm;

    const speed = this.keysDown.has("shift") ? this.walkSpeed * this.runMultiplier : this.walkSpeed;
    this.position.x += dx * speed * deltaSeconds;
    this.position.y += dy * speed * deltaSeconds;

    this.position.x = Math.max(this.bounds.min_x, Math.min(this.bounds.max_x, this.position.x));
    this.position.y = Math.max(this.bounds.min_y, Math.min(this.bounds.max_y, this.position.y));
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    const key = event.key.toLowerCase();
    if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift"].includes(key)) {
      this.keysDown.add(key);
    }
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keysDown.delete(event.key.toLowerCase());
  };
}
