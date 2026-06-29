/** Apple-style indeterminate spinner for auth bootstrap. */
export function AppleSpinner({ size = 44 }: { size?: number }) {
  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="status"
      aria-label="Loading"
    >
      <svg
        className="animate-spin"
        viewBox="0 0 24 24"
        fill="none"
        width={size}
        height={size}
        aria-hidden
      >
        {Array.from({ length: 12 }).map((_, i) => (
          <rect
            key={i}
            x="11"
            y="1"
            width="2"
            height="6"
            rx="1"
            fill="currentColor"
            opacity={0.15 + (i / 12) * 0.85}
            transform={`rotate(${i * 30} 12 12)`}
          />
        ))}
      </svg>
    </div>
  );
}

export function AuthBootstrapSplash({ message = "Signing in…" }: { message?: string }) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-background/70 backdrop-blur-xl">
      <div className="flex flex-col items-center gap-4 text-foreground">
        <AppleSpinner />
        <p className="text-sm font-medium text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}
