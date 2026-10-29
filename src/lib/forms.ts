// Small helpers for reading values out of submitted forms.

export function str(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export function optStr(form: FormData, key: string): string | null {
  const v = str(form, key);
  return v === "" ? null : v;
}

export function num(form: FormData, key: string): number | null {
  const v = str(form, key);
  if (v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new FormError(`"${key}" must be a number`);
  return n;
}

export function int(form: FormData, key: string): number | null {
  const n = num(form, key);
  return n === null ? null : Math.round(n);
}

export function required(form: FormData, key: string, label = key): string {
  const v = str(form, key);
  if (!v) throw new FormError(`${label} is required`);
  return v;
}

export function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Normalise "rock, Live ,rock" into "rock, live". */
export function normaliseTags(raw: string): string {
  const seen = new Set<string>();
  for (const t of raw.split(",")) {
    const tag = t.trim().toLowerCase();
    if (tag) seen.add(tag);
  }
  return [...seen].join(", ");
}

export function splitTags(raw: string): string[] {
  return raw ? raw.split(",").map((t) => t.trim()).filter(Boolean) : [];
}

/** An error whose message is safe to show to the user. */
export class FormError extends Error {}

export type FormState = { error?: string; ok?: string } | undefined;

/** Run a form action, turning FormErrors (and only those) into a message for the user. */
export async function handleForm(fn: () => Promise<FormState | void>): Promise<FormState> {
  try {
    return (await fn()) ?? undefined;
  } catch (e) {
    if (e instanceof FormError) return { error: e.message };
    throw e;
  }
}
