export type ConfigValue = null | boolean | number | string | ConfigValue[] | ConfigObject;
export type ConfigObject = { [key: string]: ConfigValue };

export type SchemaNode = {
  type: "object" | "string" | "number" | "integer" | "boolean";
  title?: string;
  description?: string;
  properties?: Record<string, SchemaNode>;
  enum?: Array<string | number | boolean>;
  minimum?: number;
  maximum?: number;
  multipleOf?: number;
  format?: "color";
  readOnly?: boolean;
};

export type SketchDefinition = { config: ConfigObject; schema: SchemaNode };
export type ControlField = { path: string[]; label: string; value: ConfigValue; schema: SchemaNode };
export type ControlGroup = { title: string; fields: ControlField[] };

const dangerousKeys = new Set(["__proto__", "prototype", "constructor"]);

export function parseDefinition(config: unknown, schema: unknown): SketchDefinition {
  const parsedSchema = parseSchema(schema);
  if (parsedSchema.type !== "object") throw new Error("The root config schema must have type object.");
  if (!isRecord(config)) throw new Error("window.sketchConfig must be an object.");
  if (JSON.stringify(config).length > 100_000) throw new Error("Sketch config exceeds 100 KB.");
  const cloned = clone(config) as ConfigObject;
  validateValue(parsedSchema, cloned, "config");
  return { config: cloned, schema: parsedSchema };
}

export function mergeConfig(schema: SchemaNode, defaults: ConfigObject, previous?: ConfigObject): ConfigObject {
  return mergeNode(schema, defaults, previous) as ConfigObject;
}

export function setConfigValue(config: ConfigObject, schema: SchemaNode, path: string[], value: unknown): ConfigObject {
  if (path.length === 0 || path.length > 8) throw new Error("Config paths must contain 1-8 segments.");
  const leaf = schemaAtPath(schema, path);
  validateValue(leaf, value, path.join("."));
  const next = clone(config);
  let target: ConfigObject = next;
  for (const segment of path.slice(0, -1)) {
    const child = target[segment];
    if (!isRecord(child)) throw new Error(`Config path ${path.join(".")} does not exist.`);
    target = child as ConfigObject;
  }
  target[path.at(-1)!] = clone(value) as ConfigValue;
  return next;
}

export function controlGroups(schema: SchemaNode, config: ConfigObject): ControlGroup[] {
  const groups = new Map<string, ControlField[]>();
  collectControls(schema, config, [], [], groups);
  return [...groups].map(([title, fields]) => ({ title, fields }));
}

function parseSchema(value: unknown, depth = 0): SchemaNode {
  if (depth > 8) throw new Error("Config schema exceeds 8 nested levels.");
  if (!isRecord(value)) throw new Error("window.sketchConfigSchema must be an object.");
  const type = value.type;
  if (!new Set(["object", "string", "number", "integer", "boolean"]).has(type as string)) {
    throw new Error("Config schema contains an unsupported type.");
  }
  const node: SchemaNode = { type: type as SchemaNode["type"] };
  for (const key of ["title", "description"] as const) {
    if (value[key] !== undefined && typeof value[key] !== "string") throw new Error(`Schema ${key} must be a string.`);
    if (typeof value[key] === "string") node[key] = value[key].slice(0, 200);
  }
  if (value.readOnly !== undefined) {
    if (typeof value.readOnly !== "boolean") throw new Error("Schema readOnly must be a boolean.");
    node.readOnly = value.readOnly;
  }
  if (value.format !== undefined) {
    if (value.format !== "color") throw new Error("Only the color string format is supported.");
    node.format = "color";
  }
  for (const key of ["minimum", "maximum", "multipleOf"] as const) {
    if (value[key] !== undefined && (!Number.isFinite(value[key]) || typeof value[key] !== "number")) throw new Error(`Schema ${key} must be finite.`);
    if (typeof value[key] === "number") node[key] = value[key];
  }
  if (node.multipleOf !== undefined && node.multipleOf <= 0) throw new Error("Schema multipleOf must be positive.");
  if (value.enum !== undefined) {
    if (!Array.isArray(value.enum) || value.enum.length === 0 || value.enum.length > 100 || value.enum.some((item) => !["string", "number", "boolean"].includes(typeof item))) {
      throw new Error("Schema enum must contain 1-100 primitive values.");
    }
    node.enum = [...value.enum] as SchemaNode["enum"];
  }
  if (node.type === "object") {
    if (!isRecord(value.properties)) throw new Error("Object schemas require properties.");
    const entries = Object.entries(value.properties);
    if (entries.length > 200) throw new Error("Config schema exceeds 200 properties in one group.");
    node.properties = Object.fromEntries(entries.map(([key, child]) => {
      if (!key || key.length > 80 || dangerousKeys.has(key)) throw new Error(`Unsupported config property: ${key}.`);
      return [key, parseSchema(child, depth + 1)];
    }));
  }
  return node;
}

function validateValue(schema: SchemaNode, value: unknown, path: string): void {
  if (schema.enum && !schema.enum.includes(value as never)) throw new Error(`${path} must be one of its allowed values.`);
  if (schema.type === "object") {
    if (!isRecord(value)) throw new Error(`${path} must be an object.`);
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (!(key in value)) throw new Error(`${path}.${key} is required.`);
      validateValue(child, value[key], `${path}.${key}`);
    }
    return;
  }
  if (schema.type === "string") {
    if (typeof value !== "string" || value.length > 2_000) throw new Error(`${path} must be a string under 2,000 characters.`);
    if (schema.format === "color" && !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`${path} must be a six-digit hex color.`);
    return;
  }
  if (schema.type === "boolean") {
    if (typeof value !== "boolean") throw new Error(`${path} must be a boolean.`);
    return;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || (schema.type === "integer" && !Number.isInteger(value))) throw new Error(`${path} must be a finite ${schema.type}.`);
  if (schema.minimum !== undefined && value < schema.minimum) throw new Error(`${path} is below its minimum.`);
  if (schema.maximum !== undefined && value > schema.maximum) throw new Error(`${path} is above its maximum.`);
  if (schema.multipleOf !== undefined && Math.abs(value / schema.multipleOf - Math.round(value / schema.multipleOf)) > 1e-9) throw new Error(`${path} must be a multiple of ${schema.multipleOf}.`);
}

function schemaAtPath(schema: SchemaNode, path: string[]): SchemaNode {
  let current = schema;
  for (const segment of path) {
    if (dangerousKeys.has(segment) || current.type !== "object" || !current.properties?.[segment]) throw new Error(`Unknown config path: ${path.join(".")}.`);
    current = current.properties[segment];
  }
  if (current.type === "object" || current.readOnly) throw new Error(`Config path ${path.join(".")} is not editable.`);
  return current;
}

function mergeNode(schema: SchemaNode, fallback: unknown, previous: unknown): ConfigValue {
  if (schema.type === "object") {
    const defaults = isRecord(fallback) ? fallback : {};
    const old = isRecord(previous) ? previous : {};
    return Object.fromEntries(Object.entries(schema.properties ?? {}).map(([key, child]) => [key, mergeNode(child, defaults[key], old[key])])) as ConfigObject;
  }
  try {
    validateValue(schema, previous, "previous config");
    return clone(previous) as ConfigValue;
  } catch {
    validateValue(schema, fallback, "default config");
    return clone(fallback) as ConfigValue;
  }
}

function collectControls(schema: SchemaNode, value: ConfigObject, path: string[], titles: string[], groups: Map<string, ControlField[]>) {
  for (const [key, child] of Object.entries(schema.properties ?? {})) {
    const childPath = [...path, key];
    if (child.type === "object") {
      collectControls(child, value[key] as ConfigObject, childPath, [...titles, child.title ?? humanize(key)], groups);
      continue;
    }
    const title = titles.join(" / ") || "Sketch";
    const fields = groups.get(title) ?? [];
    fields.push({ path: childPath, label: child.title ?? humanize(key), value: value[key], schema: child });
    groups.set(title, fields);
  }
}

function humanize(value: string) {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
