"use client";

export type SubLine = { id: number; text: string; out: boolean };

/**
 * Short, line-by-line subtitles over the stage. Lines cross-fade in place (grid stacking),
 * so long replies never overflow or get cut off.
 */
export default function Subtitles({ lines, label }: { lines: SubLine[]; label: string }) {
  return (
    <div aria-live="polite" aria-atomic="true" className="grid min-h-[3.2em] place-items-end justify-items-center text-center">
      {lines.map((l) => (
        <p
          key={l.id}
          data-out={l.out}
          className="sub-line max-w-[34ch] font-medium text-[17px] leading-snug text-balance break-words text-accent-50 sm:text-xl"
        >
          <span className="sr-only">{label}: </span>
          {l.text}
        </p>
      ))}
    </div>
  );
}
