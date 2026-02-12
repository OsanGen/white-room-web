export class DebugOverlay {
  private readonly root: HTMLPreElement;
  private visible = false;

  constructor(parent: HTMLElement) {
    this.root = document.createElement("pre");
    this.root.className = "debug-overlay";
    this.root.setAttribute("aria-live", "polite");
    parent.appendChild(this.root);
    this.setVisible(false);
  }

  render(snapshot: Record<string, unknown>): void {
    const lines = Object.entries(snapshot).map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
    this.root.textContent = lines.join("\n");
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.root.classList.toggle("hidden", !visible);
  }

  toggle(): boolean {
    this.setVisible(!this.visible);
    return this.visible;
  }

  isVisible(): boolean {
    return this.visible;
  }
}
