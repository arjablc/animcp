import type { SvgPart } from "../editor/model";

const elements = new Set(["svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "title", "defs", "linearGradient", "radialGradient", "stop", "clipPath", "mask", "use"]);
const attributes = new Set(["xmlns", "viewBox", "width", "height", "preserveAspectRatio", "id", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "d", "points", "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-opacity", "opacity", "offset", "stop-color", "stop-opacity", "gradientUnits", "gradientTransform", "transform", "clip-path", "mask", "href", "font-family", "font-size", "font-weight", "text-anchor", "vector-effect", "paint-order"]);
const styleAttributes = new Set(["fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-opacity", "opacity"]);
const visibleParts = new Set(["g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "use"]);

export function validViewBox(value: string | null) {
  if (!value) return false;
  const values = value.trim().split(/[\s,]+/).map(Number);
  return values.length === 4 && values.every(Number.isFinite) && values[2] > 0 && values[3] > 0;
}

export function viewBoxFromDimensions(width: string | null, height: string | null) {
  const values = [Number(width), Number(height)];
  return values.every((value) => Number.isFinite(value) && value > 0) ? `0 0 ${values[0]} ${values[1]}` : undefined;
}

export function sanitizeSvg(source: string) {
  const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
  if (parsed.querySelector("parsererror") || parsed.documentElement.localName !== "svg") throw new Error("The file is not valid SVG.");
  const sourceViewBox = parsed.documentElement.getAttribute("viewBox");
  if (sourceViewBox !== null && !validViewBox(sourceViewBox)) throw new Error("The SVG has an invalid viewBox.");
  const output = document.implementation.createDocument("http://www.w3.org/2000/svg", "svg");

  function copy(input: Element, target: Element) {
    for (const attribute of input.attributes) {
      if (attribute.name === "style") {
        for (const declaration of attribute.value.split(";")) {
          const [name, ...rest] = declaration.split(":");
          const value = rest.join(":").trim();
          if (styleAttributes.has(name.trim()) && safeValue(value)) target.setAttribute(name.trim(), value);
        }
        continue;
      }
      if (!attributes.has(attribute.name) || attribute.name.startsWith("on") || !safeValue(attribute.value)) continue;
      if (attribute.name === "href" && !/^#[A-Za-z][\w:.-]*$/.test(attribute.value.trim())) continue;
      target.setAttribute(attribute.name, attribute.value.trim());
    }
    for (const child of input.childNodes) {
      if (child.nodeType === Node.TEXT_NODE && ["text", "tspan", "title"].includes(input.localName)) target.append(output.createTextNode(child.textContent ?? ""));
      if (!(child instanceof Element) || !elements.has(child.localName)) continue;
      const next = output.createElementNS("http://www.w3.org/2000/svg", child.localName);
      target.append(next);
      copy(child, next);
    }
  }

  copy(parsed.documentElement, output.documentElement);
  if (sourceViewBox === null) {
    const viewBox = viewBoxFromDimensions(output.documentElement.getAttribute("width"), output.documentElement.getAttribute("height"));
    if (!viewBox) throw new Error("The SVG needs a viewBox or numeric width and height.");
    output.documentElement.setAttribute("viewBox", viewBox);
  }
  output.documentElement.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const ids = [...output.querySelectorAll("[id]")].map((element) => element.id);
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) throw new Error("SVG part IDs must be unique and non-empty.");
  return new XMLSerializer().serializeToString(output);
}

export function inspectSvg(source: string) {
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  const root = document.documentElement;
  const viewBox = root.getAttribute("viewBox")!.split(/[\s,]+/).map(Number);
  const parts = [...root.querySelectorAll("[id]")].filter((element) => visibleParts.has(element.localName) && !element.closest("defs,clipPath,mask")).map((element): SvgPart => ({
    id: element.id,
    name: element.id.replace(/[-_]+/g, " "),
    tag: element.localName,
    parentId: closestPartId(element.parentElement),
    fill: inheritedAttribute(element, "fill"),
    stroke: inheritedAttribute(element, "stroke"),
    opacity: optionalNumber(inheritedAttribute(element, "opacity")),
    strokeWidth: optionalNumber(inheritedAttribute(element, "stroke-width")),
  }));
  if (!parts.length) throw new Error("The SVG must contain at least one visible element with an id.");
  return { viewBox: root.getAttribute("viewBox")!, width: viewBox[2], height: viewBox[3], parts };
}

export function svgContent(source: string) {
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  return { viewBox: document.documentElement.getAttribute("viewBox")!, content: document.documentElement.innerHTML };
}

function safeValue(value: string) {
  return !/javascript:|data:|https?:|\/\//i.test(value) && (!/url\(/i.test(value) || /^url\(#[A-Za-z][\w:.-]*\)$/.test(value.trim()));
}

function closestPartId(element: Element | null): string | undefined {
  while (element && element.localName !== "svg") {
    if (element.id && visibleParts.has(element.localName)) return element.id;
    element = element.parentElement;
  }
}

function inheritedAttribute(element: Element, name: string): string | undefined {
  while (element) {
    const value = element.getAttribute(name);
    if (value !== null) return value;
    element = element.parentElement!;
  }
}

function optionalNumber(value?: string) {
  if (value === undefined) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
