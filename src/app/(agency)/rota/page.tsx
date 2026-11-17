import { redirect } from "next/navigation";

// The Rota has been taken out: its old links land on the calendar instead.
export default function Page() {
  redirect("/calendar");
}
