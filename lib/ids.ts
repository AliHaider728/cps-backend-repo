import crypto from "crypto";

export function createId(): string {
  return crypto.randomUUID();
}

export function isValidId(value: any): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function normalizeId(value: any): string | null {
  if (!isValidId(String(value || ""))) return null;
  return String(value).trim();
}
