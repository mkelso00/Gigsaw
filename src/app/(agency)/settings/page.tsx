import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";

// Settings is a set of pages; admins start on General, agents have their own profile instead.
export default async function SettingsIndex() {
  const user = await requireStaff();
  redirect(user.role === "ADMIN" ? "/settings/general" : "/profile");
}
