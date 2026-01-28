import { FLUENT_ICON_PATHS } from "./fluent_icon_paths.ts";

const createSvgFromPaths = (paths: string[], size = 20): HTMLElement => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");
  paths.forEach((d) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "currentColor");
    svg.appendChild(path);
  });
  return svg as unknown as HTMLElement;
};

export const createFluentSvgIcon = (name: string): HTMLElement => {
  const paths = FLUENT_ICON_PATHS[name];
  if (!paths) {
    throw new Error(`Missing Fluent icon paths for "${name}"`);
  }
  return createSvgFromPaths(paths);
};
