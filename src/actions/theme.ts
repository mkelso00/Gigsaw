"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

/** Switch the agency pages between dark (the default) and light. Remembered on this device for a year. */
export async function toggleTheme(current: "dark" | "light") {
  (await cookies()).set("gigsaw_theme", current === "dark" ? "light" : "dark", { path: "/", maxAge: 365 * 24 * 3600, sameSite: "lax" });
  revalidatePath("/", "layout");
}
