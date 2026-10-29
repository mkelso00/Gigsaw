"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { createSession, destroySession, verifyPassword } from "@/lib/auth";
import { str, type FormState } from "@/lib/forms";

export async function login(_: FormState, form: FormData): Promise<FormState> {
  const email = str(form, "email").toLowerCase();
  const password = str(form, "password");
  if (!email || !password) return { error: "Enter your email and password." };
  const user = await prisma.user.findUnique({ where: { email } });
  // Same message either way so we don't reveal which emails exist.
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return { error: "That email and password don't match." };
  }
  await createSession(user.id);
  redirect(user.role === "ARTIST" ? "/app" : "/dashboard");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
