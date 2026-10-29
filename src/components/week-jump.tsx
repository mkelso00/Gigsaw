"use client";

import { useRouter } from "next/navigation";

/** Pick any date to jump the rota to the week it falls in. */
export function WeekJump({ value, path = "/rota" }: { value: string; path?: string }) {
  const router = useRouter();
  return (
    <form action={path} className="flex items-center">
      <label className="sr-only" htmlFor="week-jump">
        Go to date
      </label>
      <input
        id="week-jump"
        name="week"
        type="date"
        defaultValue={value}
        className="input w-44"
        onChange={(e) => e.target.value && router.push(`${path}?week=${e.target.value}`)}
      />
      <noscript>
        <button className="btn ml-2">Go</button>
      </noscript>
    </form>
  );
}
