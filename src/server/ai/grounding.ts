import { AIError } from "./errors";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function malformed(): never {
  throw new AIError("GROUNDING");
}

function referencedIds(value: unknown, out: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) referencedIds(item, out);
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    if (key === "evidenceId") {
      if (typeof nested !== "string") malformed();
      out.push(nested);
      continue;
    }
    if (key === "evidenceIds") {
      if (!Array.isArray(nested)) malformed();
      for (const item of nested) {
        if (typeof item !== "string") malformed();
        out.push(item);
      }
      continue;
    }
    if (key === "evidenceRefs") {
      if (!Array.isArray(nested)) malformed();
      for (const item of nested) {
        if (typeof item === "string") {
          out.push(item);
          continue;
        }
        if (!isPlainObject(item)) malformed();
        let found = false;
        for (const [refKey, refValue] of Object.entries(item)) {
          if (refKey === "id" || refKey === "evidenceId") {
            if (typeof refValue !== "string") malformed();
            out.push(refValue);
            found = true;
          } else {
            referencedIds(refValue, out);
          }
        }
        if (!found) malformed();
      }
      continue;
    }
    referencedIds(nested, out);
  }
}

export function assertGroundedEvidence(value: unknown, allowedEvidenceIds: readonly string[]): void {
  const allowed = new Set(allowedEvidenceIds);
  const ids: string[] = [];
  referencedIds(value, ids);
  for (const id of ids) {
    if (!allowed.has(id)) throw new AIError("GROUNDING");
  }
}
