import { addEventTask, deleteEventTask, toggleEventTask } from "@/actions/events";
import { ActionForm, SubmitButton, ServerForm } from "@/components/forms";
import { autoDone } from "@/lib/events";
import type { EventPageData, EventView } from "../_data";
import { dayLabel } from "./day-label";

/** The event's tasks. Some tick themselves once the app can see they're done (e.g. the contract is signed). */
export function ChecklistSection({
  event: e,
  tasks,
  totals: t,
  sent,
  contractSigned,
  today,
}: {
  event: EventView;
  tasks: EventPageData["tasks"];
  totals: EventPageData["totals"];
  sent: EventPageData["sent"];
  contractSigned: boolean;
  today: string;
}) {
  return (
    <section className="card card-pad">
      <h2 className="section-title mb-3">Checklist</h2>
      <ul className="space-y-1">
        {tasks.map((task) => {
          const auto = autoDone(task.key, e, t, sent, contractSigned);
          const done = !!task.doneAt || auto;
          const late = !done && task.dueDate && task.dueDate < today;
          return (
            <li key={task.id} className="group flex items-start gap-2">
              <ServerForm action={toggleEventTask.bind(null, task.id)}>
                <button
                  disabled={auto && !task.doneAt}
                  className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded-md border text-xs ${done ? "border-emerald-500 bg-emerald-500 text-white" : "border-ink-300 hover:border-ink-950"}`}
                  aria-label={done ? `Mark "${task.title}" as not done` : `Mark "${task.title}" as done`}
                >
                  {done ? "✓" : ""}
                </button>
              </ServerForm>
              <div className="min-w-0 flex-1 text-sm">
                <div className={done ? "text-ink-500 line-through" : ""}>{task.title}</div>
                <div className={`text-xs ${late ? "font-medium text-rose-700" : "text-ink-500"}`}>
                  {auto && !task.doneAt
                    ? "Done automatically"
                    : task.dueDate
                      ? `${late ? "Overdue: " : "By "}${dayLabel(task.dueDate, { day: "numeric", month: "short" })}`
                      : ""}
                </div>
              </div>
              {!task.key && (
                <ServerForm action={deleteEventTask.bind(null, task.id)} className="opacity-0 group-hover:opacity-100">
                  <button className="text-xs text-ink-400 hover:text-rose-700" aria-label={`Delete "${task.title}"`}>
                    ✕
                  </button>
                </ServerForm>
              )}
            </li>
          );
        })}
      </ul>
      <ActionForm action={addEventTask.bind(null, e.id)} className="mt-4 grid grid-cols-[1fr_auto] gap-2 border-t border-ink-100 pt-4">
        <input name="title" required placeholder="Add a task, e.g. Book the PA" className="input" />
        <SubmitButton className="btn">Add</SubmitButton>
        <input name="dueDate" type="date" aria-label="Due date" className="input col-span-2" />
      </ActionForm>
    </section>
  );
}
