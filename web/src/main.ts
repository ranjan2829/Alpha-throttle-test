import { mount } from "./app.ts";
import "./styles.css";

const root = document.querySelector<HTMLElement>("#app");
if (!root) {
  throw new Error("#app missing");
}
mount(root);
