"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ActionResult } from "@/lib/actions";

/**
 * The shared shell for every write in the app.
 *
 * Each action needs the same four things — disable while in flight, surface the
 * error as a sentence, confirm success, reset the form — and hand-rolling that
 * per form is how you end up with three that double-submit and one that swallows
 * errors silently.
 *
 * `"use client"` is required: this holds state and passes handlers. Per
 * CLAUDE.md §8, anything interactive has to be a Client Component or a Server
 * Component passing a function into it fails with an error that points nowhere
 * near the cause.
 */
export function ActionForm({
  action,
  children,
  className,
  submitLabel,
  submittingLabel,
  /** Clear inputs after a successful write. Wrong for toggles, right for entry. */
  resetOnSuccess = false,
  /** Render your own trigger instead of the default button. */
  renderSubmit,
  onSuccess,
}: {
  action: (formData: FormData) => Promise<ActionResult>;
  children?: React.ReactNode;
  className?: string;
  submitLabel?: string;
  submittingLabel?: string;
  resetOnSuccess?: boolean;
  renderSubmit?: (pending: boolean) => React.ReactNode;
  onSuccess?: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);

    startTransition(async () => {
      const outcome = await action(data);
      setResult(outcome);
      if (outcome.ok) {
        if (resetOnSuccess) form.reset();
        onSuccess?.();
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className={className}>
      {children}

      {renderSubmit ? (
        renderSubmit(pending)
      ) : (
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center gap-2 rounded-tile bg-cardinal-600 px-4 py-2.5 text-[15px] font-semibold text-white transition-colors hover:bg-cardinal-700 disabled:opacity-60"
        >
          {pending ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              {submittingLabel ?? "Saving…"}
            </>
          ) : (
            submitLabel ?? "Save"
          )}
        </button>
      )}

      {/*
        Errors are shown in full. The operations layer writes them as complete
        sentences that say what to do next ("those hours are locked because you
        already submitted a check-in covering that day"), and replacing that with
        a generic failure toast throws away the only useful part.
      */}
      {result && !result.ok ? (
        <p role="alert" className="mt-2 text-sm font-medium text-risk-fg">
          {result.error}
        </p>
      ) : null}
      {result?.ok && result.message ? (
        <p role="status" className="mt-2 text-sm font-medium text-ok-fg">
          {result.message}
        </p>
      ) : null}
    </form>
  );
}

/** A one-click action with no fields — approve, follow, sign off. */
export function ActionButton({
  action,
  fields,
  label,
  pendingLabel,
  tone = "default",
  className,
}: {
  action: (formData: FormData) => Promise<ActionResult>;
  /** Hidden values identifying what's being acted on. */
  fields: Record<string, string>;
  label: string;
  pendingLabel?: string;
  tone?: "default" | "primary" | "danger";
  className?: string;
}) {
  const tones = {
    default: "border border-line bg-card text-ink hover:bg-surface",
    primary: "bg-cardinal-600 text-white hover:bg-cardinal-700",
    danger: "border border-risk-fg/40 bg-card text-risk-fg hover:bg-risk-bg",
  } as const;

  return (
    <ActionForm
      action={action}
      className={className}
      renderSubmit={(pending) => (
        <button
          type="submit"
          disabled={pending}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-tile px-3 py-1.5 text-sm font-semibold transition-colors disabled:opacity-60",
            tones[tone]
          )}
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {pending ? (pendingLabel ?? label) : label}
        </button>
      )}
    >
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
    </ActionForm>
  );
}
