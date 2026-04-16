import crypto from "crypto";

export function createId() {
  return crypto.randomUUID();
}

export function isValidId(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function normalizeId(value) {
  if (!isValidId(String(value || ""))) return null;
  return String(value).trim();
}
