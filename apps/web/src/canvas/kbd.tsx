export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border bg-background px-1 py-px font-mono text-[10px] text-foreground">
      {children}
    </kbd>
  );
}
