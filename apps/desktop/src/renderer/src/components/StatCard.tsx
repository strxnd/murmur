import type { JSX } from "react";

interface StatCardProps {
  label: string;
  value: string;
  detail?: string;
}

export function StatCard({ label, value, detail }: StatCardProps): JSX.Element {
  return (
    <section className="studio-stat-card relative overflow-hidden rounded-[15px] border border-border bg-surface p-4">
      <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-subtle">{label}</div>
      <div className="mt-2 text-2xl font-medium tracking-[-0.035em] text-foreground">{value}</div>
      {detail && <div className="mt-1 text-xs text-muted-foreground">{detail}</div>}
    </section>
  );
}
