"use client";

import { useState, useTransition } from "react";
import { Check, ChevronDown, ChevronRight, Plus, X } from "lucide-react";

import {
  addDeliverableTodoAction,
  deleteDeliverableTodoAction,
  renameDeliverableTodoAction,
  setDeliverableTodoDoneAction,
} from "@/lib/actions";
import type { DeliverableTodo } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The checklist under one deliverable.
 *
 * ---------------------------------------------------------------------------
 * What this is for
 * ---------------------------------------------------------------------------
 *
 * Small things that have to happen but are not units of work: move the parts
 * from Trudy's office, book the CNC, chase the vendor. Those were being entered
 * as DELIVERABLES, because a deliverable was the only place to put a thing that
 * needed doing — and a deliverable counts towards the Delivered signal, so ten
 * errands made somebody look twice as productive as the person who shipped the
 * airframe.
 *
 * A todo carries no owner, no date and no credit, and appears in no count. The
 * one thing it does is hold up the sign-off until it's ticked, which is what
 * makes writing it down worth the keystrokes.
 *
 * ---------------------------------------------------------------------------
 * Collapsed by default
 * ---------------------------------------------------------------------------
 *
 * A project with twelve deliverables and five items each is a wall of
 * checkboxes, and the deliverable list is the thing people came to read. The
 * summary line carries the only number that matters — how many are left — so
 * nothing consequential is hidden behind the chevron.
 *
 * ---------------------------------------------------------------------------
 * No <form> around a row
 * ---------------------------------------------------------------------------
 *
 * This renders inside the project page next to `DeliverableActions`, which is
 * already a form, and each row needs three separate writes (tick, rename,
 * delete). Nesting forms is invalid HTML and the browser silently drops the
 * inner one — a dead control that looks wired up. Every row control is a plain
 * button calling the action through `useTransition` instead.
 */
export function DeliverableTodos({
  deliverableId,
  projectId,
  todos,
  canManage,
  /** Signed off — the list becomes a record rather than a worklist. */
  locked = false,
}: {
  deliverableId: string;
  projectId: string;
  todos: DeliverableTodo[];
  /** The deliverable's owner, an RE of or above the project, or a Co-Lead. */
  canManage: boolean;
  locked?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const done = todos.filter((t) => t.done).length;
  const left = todos.length - done;

  // Nothing written and nobody who could write anything: show nothing at all.
  if (todos.length === 0 && (!canManage || locked)) return null;

  function run(action: (fd: FormData) => Promise<{ ok: boolean; error?: string }>, fields: Record<string, string>) {
    setError(null);
    const data = new FormData();
    data.set("deliverableId", deliverableId);
    data.set("projectId", projectId);
    for (const [k, v] of Object.entries(fields)) data.set(k, v);

    startTransition(async () => {
      const result = await action(data);
      if (!result.ok) setError(result.error ?? "That didn't work.");
    });
  }

  return (
    <div className="border-line mt-2.5 border-t pt-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-ink-soft hover:text-ink inline-flex items-center gap-1.5 text-sm font-semibold"
          aria-expanded={open}
        >
          {open ? (
            <ChevronDown className="size-4" strokeWidth={2.5} />
          ) : (
            <ChevronRight className="size-4" strokeWidth={2.5} />
          )}
          Checklist
          {todos.length > 0 ? (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs font-bold",
                left > 0
                  ? "bg-warn-bg text-warn-fg"
                  : "bg-ok-bg text-ok-fg"
              )}
            >
              {left > 0 ? `${left} left` : `${done} done`}
            </span>
          ) : (
            <span className="text-ink-muted text-xs font-normal">empty</span>
          )}
        </button>

        {!open && left > 0 ? (
          <span className="text-ink-muted text-xs">
            Sign-off is held until these are ticked.
          </span>
        ) : null}
      </div>

      {open ? (
        <div className="mt-2 space-y-1">
          {todos.length === 0 ? (
            <p className="text-ink-muted text-sm">
              Nothing here yet. Use it for the small things that have to happen
              but aren&apos;t worth their own deliverable — moving parts,
              booking the mill, chasing an order.
            </p>
          ) : (
            todos.map((todo) => (
              <TodoRow
                key={todo.id}
                todo={todo}
                canManage={canManage && !locked}
                pending={pending}
                onToggle={() =>
                  run(setDeliverableTodoDoneAction, {
                    todoId: todo.id,
                    done: String(!todo.done),
                  })
                }
                onRename={(title) =>
                  run(renameDeliverableTodoAction, { todoId: todo.id, title })
                }
                onDelete={() =>
                  run(deleteDeliverableTodoAction, { todoId: todo.id })
                }
              />
            ))
          )}

          {canManage && !locked ? (
            adding ? (
              <form
                className="flex flex-wrap items-center gap-2 pt-1.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = event.currentTarget;
                  const input = form.elements.namedItem(
                    "title"
                  ) as HTMLInputElement;
                  const title = input.value.trim();
                  if (!title) return;
                  input.value = "";
                  // Focus stays put on purpose — a checklist is written in one
                  // burst, and re-clicking the box between items is friction.
                  run(addDeliverableTodoAction, { title });
                }}
              >
                <input
                  type="text"
                  name="title"
                  autoFocus
                  maxLength={200}
                  placeholder="Move the spar jig back to the robotics room"
                  className="rounded-tile border-line bg-card text-ink min-w-[14rem] flex-1 border px-2.5 py-1.5 text-sm"
                />
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-tile bg-cardinal-600 hover:bg-cardinal-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
                >
                  Add
                </button>
                <button
                  type="button"
                  onClick={() => setAdding(false)}
                  className="text-ink-muted hover:text-ink text-sm font-semibold"
                >
                  Done adding
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="text-ink-soft hover:text-cardinal-600 inline-flex items-center gap-1 pt-1 text-sm font-semibold"
              >
                <Plus className="size-3.5" strokeWidth={2.5} />
                Add an item
              </button>
            )
          ) : null}

          {error ? (
            <p role="alert" className="text-risk-fg pt-1 text-sm font-medium">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** One line: tick it, rename it in place, or remove it. */
function TodoRow({
  todo,
  canManage,
  pending,
  onToggle,
  onRename,
  onDelete,
}: {
  todo: DeliverableTodo;
  canManage: boolean;
  pending: boolean;
  onToggle: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          autoFocus
          defaultValue={todo.title}
          maxLength={200}
          onKeyDown={(event) => {
            if (event.key === "Escape") setEditing(false);
            if (event.key === "Enter") {
              const value = event.currentTarget.value.trim();
              setEditing(false);
              if (value && value !== todo.title) onRename(value);
            }
          }}
          onBlur={(event) => {
            const value = event.currentTarget.value.trim();
            setEditing(false);
            if (value && value !== todo.title) onRename(value);
          }}
          className="rounded-tile border-line bg-card text-ink min-w-[14rem] flex-1 border px-2.5 py-1 text-sm"
        />
        <span className="text-ink-muted text-xs">Enter to save</span>
      </div>
    );
  }

  return (
    <div className="group flex items-start gap-2">
      <button
        type="button"
        onClick={onToggle}
        disabled={!canManage || pending}
        aria-pressed={todo.done}
        aria-label={todo.done ? `Untick ${todo.title}` : `Tick ${todo.title}`}
        className={cn(
          "mt-0.5 flex size-4.5 shrink-0 items-center justify-center rounded border transition-colors",
          todo.done
            ? "border-ok-fg bg-ok-fg text-white"
            : "border-line bg-card hover:border-ink-muted",
          !canManage && "cursor-default opacity-70"
        )}
      >
        {todo.done ? <Check className="size-3" strokeWidth={3.5} /> : null}
      </button>

      <button
        type="button"
        onClick={() => canManage && setEditing(true)}
        disabled={!canManage}
        className={cn(
          "flex-1 text-left text-sm",
          todo.done ? "text-ink-muted line-through" : "text-ink-soft",
          canManage && "hover:text-ink cursor-text"
        )}
      >
        {todo.title}
      </button>

      {canManage ? (
        <button
          type="button"
          onClick={onDelete}
          disabled={pending}
          aria-label={`Remove ${todo.title}`}
          title="Remove — use this when it turned out not to be needed"
          className="text-ink-muted hover:text-risk-fg mt-0.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
        >
          <X className="size-3.5" strokeWidth={2.5} />
        </button>
      ) : null}
    </div>
  );
}
