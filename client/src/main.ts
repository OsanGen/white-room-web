import "./styles/main.css";
import { TopDownGameLoopController } from "./app/TopDownGameLoopController";

const app = document.getElementById("app");
if (!app) {
  throw new Error("#app root not found");
}

new TopDownGameLoopController(app).mount();
