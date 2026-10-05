import { useId } from "react";

/** Her mark — the same drawing as the site's icon (app/icon.svg): a participant's tile, her speaking. */
export default function Logo({ className = "size-7" }: { className?: string }) {
  // Its own ids, so several on one page do not share a gradient; letters only, for url(#…).
  const id = `logo${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-tile`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#38bdf8" />
          <stop offset="1" stopColor="#2563eb" />
        </linearGradient>
        <clipPath id={`${id}-round`}>
          <rect width="64" height="64" rx="15" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id}-round)`}>
        <rect width="64" height="64" fill={`url(#${id}-tile)`} />
        <circle cx="24" cy="26" r="10.5" fill="#fff" />
        <path d="M3 64C3 49 12 41.5 24 41.5S45 49 45 64Z" fill="#fff" />
      </g>
      <g fill="none" stroke="#fff" strokeLinecap="round" strokeWidth="4.5">
        <path d="M38.6 16.4a17 17 0 0 1 0 19.2" />
        <path d="M45.6 11.2a25.5 25.5 0 0 1 0 29.6" opacity=".75" />
      </g>
    </svg>
  );
}
