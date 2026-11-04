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

const DIGEST_PREFIX = "gigsaw-form-error:";

/**
 * A FormError that also reaches the user when it's thrown outside handleForm, e.g. by requireStaff
 * at the top of an action. Next hides a thrown error's message from the browser but passes on its
 * digest, so the message travels there and ActionForm shows it (see formErrorFromDigest).
 */
export class ShownFormError extends FormError {
  readonly digest: string;
  constructor(message: string) {
    super(message);
    this.digest = DIGEST_PREFIX + encodeURIComponent(message);
  }
}

/** The message of a ShownFormError that came back from a server action, or null for any other error. */
export function formErrorFromDigest(e: unknown): string | null {
  const digest = typeof e === "object" && e !== null && "digest" in e ? (e as { digest: unknown }).digest : null;
  if (typeof digest !== "string" || !digest.startsWith(DIGEST_PREFIX)) return null;
  try {
    return decodeURIComponent(digest.slice(DIGEST_PREFIX.length));
  } catch {
    return null;
  }
}

/**
 * What a form action returns. `confirm` asks the user to check something before saving
 * (e.g. a possible double booking); submitting again with "Save anyway" sends confirmed=yes.
 */
export type FormState = { error?: string; ok?: string; confirm?: { title: string; items: string[]; button?: string } } | undefined;

/** True when the user pressed "Save anyway" on a confirm box. */
export function confirmed(form: FormData) {
  return form.get("confirmed") === "yes";
}

/** Run a form action, turning FormErrors (and only those) into a message for the user. */
export async function handleForm(fn: () => Promise<FormState | void>): Promise<FormState> {
  try {
    return (await fn()) ?? undefined;
  } catch (e) {
    if (e instanceof FormError) return { error: e.message };
    throw e;
  }
}
