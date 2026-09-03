type ClassValue = string | number | boolean | undefined | null | ClassValue[] | Record<string, unknown>;

const getConflictGroup = (cls: string): string | null => {
  const base = cls.split(":").pop() ?? cls;
  if (/^(p|px|py|pt|pr|pb|pl)-/.test(base)) return "padding";
  if (/^(m|mx|my|mt|mr|mb|ml)-/.test(base)) return "margin";
  if (base.startsWith("bg-")) return "bg";
  if (/^text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)$/.test(base)) return "text-size";
  if (/^text-/.test(base) && !base.startsWith("text-[")) return "text-color";
  return null;
};

const flatten = (input: ClassValue, out: string[]): void => {
  if (input === undefined || input === null || input === false || input === "") return;
  if (typeof input === "string" || typeof input === "number") {
    const s = String(input).trim();
    if (s) out.push(...s.split(/\s+/));
    return;
  }
  if (Array.isArray(input)) {
    for (const item of input) flatten(item, out);
    return;
  }
  if (typeof input === "object") {
    for (const [key, value] of Object.entries(input)) {
      if (value) out.push(...key.trim().split(/\s+/));
    }
  }
};

export const cn = (...inputs: ClassValue[]): string => {
  const flat: string[] = [];
  for (const input of inputs) flatten(input, flat);
  // tailwind-merge-lite: aynı conflict grubunda son kazanır
  const lastIndexByGroup = new Map<string, number>();
  flat.forEach((cls, i) => {
    const group = getConflictGroup(cls);
    if (group) lastIndexByGroup.set(group, i);
  });
  const seen = new Set<string>();
  const result: string[] = [];
  flat.forEach((cls, i) => {
    const group = getConflictGroup(cls);
    if (group && lastIndexByGroup.get(group) !== i) return;
    if (!group) {
      if (seen.has(cls)) return;
      seen.add(cls);
    }
    result.push(cls);
  });
  return result.join(" ");
};

export default cn;
