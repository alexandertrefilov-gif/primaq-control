type ActionPanelProps = {
  title: string;
  children: React.ReactNode;
};

export function ActionPanel({ title, children }: ActionPanelProps) {
  return (
    <section className="rounded-lg border border-black/10 bg-white p-4 shadow-sm">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      <div className="mt-4 grid gap-3">{children}</div>
    </section>
  );
}
