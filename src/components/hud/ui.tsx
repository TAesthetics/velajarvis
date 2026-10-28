"use client";

export function ToggleChip({
  active,
  children,
  className = "",
  ...rest
}: { active: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={`h-9 min-w-12 rounded-full border px-3 font-display text-[10px] tracking-[0.25em] transition-all duration-300 active:scale-95 disabled:opacity-30 ${className} ${
        active
          ? "border-accent-300/70 bg-accent-400/15 text-accent-100 shadow-[0_0_14px_rgb(var(--glow)/0.45)]"
          : "border-accent-400/25 text-accent-400/60 hover:text-accent-200"
      }`}
    >
      {children}
    </button>
  );
}

export function MicIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className={className}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeLinecap="round" />
    </svg>
  );
}
