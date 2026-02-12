export class CalmModeToggle {
  private readonly input: HTMLInputElement;

  constructor(parent: HTMLElement, onChange: (enabled: boolean) => void) {
    const wrapper = document.createElement("label");
    wrapper.className = "mode-toggle";

    this.input = document.createElement("input");
    this.input.type = "checkbox";

    const text = document.createElement("span");
    text.textContent = "Calm Mode";

    wrapper.appendChild(this.input);
    wrapper.appendChild(text);

    this.input.addEventListener("change", () => onChange(this.input.checked));
    parent.appendChild(wrapper);
  }

  setChecked(value: boolean): void {
    this.input.checked = value;
  }
}
