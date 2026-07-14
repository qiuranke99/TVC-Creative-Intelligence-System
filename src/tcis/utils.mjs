import { createHash, randomUUID } from 'node:crypto';

export function nowIso(clock = () => new Date()) {
  return clock().toISOString();
}

export function stableId(prefix) {
  return `${prefix}-${randomUUID()}`;
}

export function sha256(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  return createHash('sha256').update(buffer).digest('hex');
}

export function stableStringify(value) {
  return JSON.stringify(sortValue(value));
}

export function compareCodeUnits(left, right) {
  const leftString = String(left);
  const rightString = String(right);
  if (leftString < rightString) return -1;
  if (leftString > rightString) return 1;
  return 0;
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareCodeUnits(left, right))
        .map(([key, child]) => [key, sortValue(child)]),
    );
  }
  return value;
}

export function clone(value) {
  return structuredClone(value);
}

export function immutableSnapshot(value) {
  return deepFreeze(clone(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function uniqueStrings(values) {
  return [...new Set(values)].sort(compareCodeUnits);
}

export function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}
