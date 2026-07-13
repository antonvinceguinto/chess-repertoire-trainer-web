"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { pct } from "@/lib/evalFormat";

export function ControlButton({
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-md border border-slate-700 bg-slate-800/80 px-2 text-sm text-slate-200 transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-35 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-emerald-600 text-white hover:bg-emerald-500 border border-emerald-500",
  secondary:
    "bg-slate-800 text-slate-100 hover:bg-slate-700 border border-slate-700",
  danger:
    "bg-rose-950/60 text-rose-300 hover:bg-rose-900/60 border border-rose-800/70",
  ghost: "bg-transparent text-slate-300 hover:bg-slate-800 border border-transparent",
};

export function Button({
  children,
  variant = "secondary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${VARIANT[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-slate-800 bg-slate-900/60 ${className}`}
    >
      {children}
    </section>
  );
}

export function PanelHeader({
  title,
  right,
}: {
  title: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-3 py-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {title}
      </h2>
      {right}
    </div>
  );
}

/** White / draw / black result distribution bar. */
export function WdlBar({
  white,
  draws,
  black,
  total,
}: {
  white: number;
  draws: number;
  black: number;
  total: number;
}) {
  const w = pct(white, total);
  const d = pct(draws, total);
  const b = pct(black, total);
  return (
    <div className="flex h-4 w-full overflow-hidden rounded-sm text-[9px] font-semibold leading-4">
      <div
        className="flex items-center justify-center bg-slate-100 text-slate-700"
        style={{ width: `${w}%` }}
        title={`White wins ${w.toFixed(0)}%`}
      >
        {w >= 14 ? `${w.toFixed(0)}%` : ""}
      </div>
      <div
        className="flex items-center justify-center bg-slate-500 text-slate-100"
        style={{ width: `${d}%` }}
        title={`Draws ${d.toFixed(0)}%`}
      >
        {d >= 14 ? `${d.toFixed(0)}%` : ""}
      </div>
      <div
        className="flex items-center justify-center bg-slate-900 text-slate-300"
        style={{ width: `${b}%` }}
        title={`Black wins ${b.toFixed(0)}%`}
      >
        {b >= 14 ? `${b.toFixed(0)}%` : ""}
      </div>
    </div>
  );
}
