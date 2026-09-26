/** Orbital's mark: the reserve sphere, one tilted range ring and the peg point. Shared by the landing page and /app. */
export function OrbitalLogo({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
    <circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" strokeWidth="2" />
    <ellipse cx="16" cy="16" rx="13" ry="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" transform="rotate(-28 16 16)" />
    <circle cx="16" cy="16" r="3.2" fill="currentColor" />
  </svg>;
}
