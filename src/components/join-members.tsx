"use client";

import { useState } from "react";

/** Rows for the other people in the act, on the join form. Add as many as needed. */
export function JoinMembers() {
  const [rows, setRows] = useState<number[]>([]);
  const [next, setNext] = useState(0);
  return (
    <div className="space-y-3">
      {rows.map((k, i) => (
        <div key={k} className="grid gap-2 rounded-xl border border-ink-200 p-3 sm:grid-cols-[1.2fr_1.2fr_1fr_1fr_auto] sm:items-center">
          <input name="member_name" placeholder={`Member ${i + 2} name`} required className="input" />
          <input name="member_email" type="email" placeholder="Email" className="input" />
          <input name="member_phone" type="tel" placeholder="Mobile" className="input" />
          <input name="member_role" placeholder="Role, e.g. drums" className="input" />
          <button type="button" onClick={() => setRows(rows.filter((r) => r !== k))} className="btn btn-sm" aria-label="Remove member">
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => {
          setRows([...rows, next]);
          setNext(next + 1);
        }}
        className="btn btn-sm"
      >
        + Add a member
      </button>
    </div>
  );
}
