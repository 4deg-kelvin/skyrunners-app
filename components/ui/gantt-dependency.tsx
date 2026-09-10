"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatDay } from "@/lib/dates";

/** Keep dependency details outside the chart's clipping/scrolling container. */
export function GanttDependency({
  name,
  date,
  pct,
  conflict,
  item,
}: {
  name: string;
  date: string;
  pct: number;
  conflict?: boolean;
  item: string;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{
    left: number;
    top?: number;
    bottom?: number;
  } | null>(null);
  const show = () => {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(240, window.innerWidth - 32);
    setPosition({
      left: Math.max(
        16,
        Math.min(
          rect.left + rect.width / 2 - width / 2,
          window.innerWidth - width - 16
        )
      ),
      ...(rect.top > 160
        ? { bottom: window.innerHeight - rect.top + 8 }
        : { top: rect.bottom + 8 }),
    });
  };
  useEffect(() => {
    if (!position) return;
    const close = () => setPosition(null);
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node)) close();
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    document.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      document.removeEventListener("pointerdown", outside);
    };
  }, [position]);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={
          item +
          " is waiting on " +
          name +
          ", due " +
          date +
          (conflict ? " — after this item's due date" : "")
        }
        className="focus-visible:outline-info-fg absolute top-1/2 z-30 flex h-10 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-sm outline-offset-2"
        style={{ left: pct + "%" }}
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse") show();
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === "mouse") setPosition(null);
        }}
        onFocus={show}
        onBlur={() => setPosition(null)}
        onClick={show}
        onKeyDown={(event) => {
          if (event.key === "Escape") setPosition(null);
        }}
      >
        <span
          aria-hidden
          className={"h-7 w-0.5 " + (conflict ? "bg-risk-fg" : "bg-ink-muted")}
        />
      </button>
      {position
        ? createPortal(
            <div
              aria-hidden
              className="border-line bg-card text-ink rounded-tile pointer-events-none fixed z-[100] w-60 max-w-[calc(100vw-2rem)] border p-3 text-xs leading-relaxed shadow-lg"
              style={position}
            >
              <span className="text-ink-muted block text-[10px] font-bold tracking-wide uppercase">
                Waiting on
              </span>
              <span className="font-semibold break-words">{name}</span>
              <span
                className={
                  "mt-1 block " + (conflict ? "text-risk-fg" : "text-ink-muted")
                }
              >
                Due {formatDay(date, { month: "short", day: "numeric" })}
                {conflict ? " · after this item's due date" : ""}
              </span>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
