import type { LucideIcon } from "lucide-react";

type StatusCardProps = {
  title: string;
  value: string;
  detail: string;
  icon: LucideIcon;
};

export function StatusCard({ title, value, detail, icon: Icon }: StatusCardProps) {
  return (
    <section className="rounded-lg border border-black/10 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-black/58">{title}</p>
          <p className="mt-2 text-2xl font-bold text-ink">{value}</p>
        </div>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primaq-50 text-primaq-700">
          <Icon aria-hidden className="h-5 w-5" />
        </span>
      </div>
      <p className="mt-4 text-sm leading-5 text-black/62">{detail}</p>
    </section>
  );
}
