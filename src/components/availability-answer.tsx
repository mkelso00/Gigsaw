"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { answerAvailabilityByToken, answerAvailabilityInApp, type AnswerResult } from "@/actions/availability";

/**
 * Yes / No for "Are you free?", with an optional note. Used on the private link page (light,
 * by token) and in the act app (dark, by reply id). After answering, the act can change it.
 */
export function AvailabilityAnswer({
  token,
  replyId,
  answer,
  note,
  dark = false,
}: {
  token?: string;
  replyId?: string;
  answer: string | null;
  note: string;
  dark?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(!answer);
  const [text, setText] = useState(note);
  const [result, setResult] = useState<AnswerResult | null>(null);
  const send = (a: "YES" | "NO") =>
    start(async () => {
      const r = token ? await answerAvailabilityByToken(token, a, text) : await answerAvailabilityInApp(replyId!, a, text);
      setResult(r);
      if (r.ok) setEditing(false);
      router.refresh();
    });

  const box = dark ? "bg-white/[0.06] text-ink-200" : "bg-ink-100 text-ink-700";
  if (!editing)
    return (
      <div className="space-y-2">
        {result && (
          <p
            role="status"
            className={`rounded-xl px-4 py-3 text-sm font-medium ${result.ok ? (dark ? "bg-volt-400/15 text-volt-300" : "bg-emerald-50 text-emerald-800") : "bg-rose-50 text-rose-800"}`}
          >
            {result.message}
          </p>
        )}
        {!result && (
          <p className={`rounded-xl px-4 py-3 text-sm font-medium ${box}`}>
            {answer === "YES" ? "You said you're free." : "You said you're not free."}
            {note ? <span className="mt-1 block font-normal opacity-80">“{note}”</span> : null}
          </p>
        )}
        <button
          type="button"
          onClick={() => setEditing(true)}
          className={`text-sm underline ${dark ? "text-ink-400 hover:text-white" : "text-ink-500 hover:text-ink-950"}`}
        >
          Change answer
        </button>
      </div>
    );
  return (
    <div className="space-y-3">
      {result && !result.ok && <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">{result.message}</p>}
      <label className="block">
        <span className={`mb-1.5 block text-[13px] font-medium ${dark ? "text-ink-300" : "text-ink-800"}`}>Note (optional)</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder="e.g. Free after 8pm, or free but would need a lift"
          className={
            dark
              ? "block w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-base text-white placeholder:text-ink-500 focus:border-volt-400/60 focus:outline-none"
              : "input"
          }
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => send("YES")}
          className={dark ? "h-11 rounded-xl bg-volt-400 text-[15px] font-medium text-ink-950 hover:bg-volt-300 disabled:opacity-50" : "btn btn-primary"}
        >
          Yes, I&apos;m free
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => send("NO")}
          className={
            dark ? "h-11 rounded-xl border border-white/10 bg-white/[0.06] text-[15px] font-medium text-white hover:bg-white/[0.1] disabled:opacity-50" : "btn"
          }
        >
          No, I&apos;m not
        </button>
      </div>
    </div>
  );
}
