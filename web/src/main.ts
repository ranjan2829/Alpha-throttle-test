import { mount } from "./app.ts";
import "./styles.css";
import "./patches.ts";

const root = document.querySelector<HTMLElement>("#app");
if (!root) {
  throw new Error("#app missing");
}
mount(root);
