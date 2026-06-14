import type { JSX } from "react";

interface MetricProps {
  label: string;
  value: string;
}

export function Metric({ label, value }: MetricProps): JSX.Element {
  return (
    <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-3 border-t border-border py-2 text-sm first:border-t-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <strong className="min-w-0 overflow-wrap-anywhere font-medium text-foreground">{value}</strong>
    </div>
  );
}
