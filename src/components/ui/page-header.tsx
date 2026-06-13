type PageHeaderProps = {
  title: string;
  description: string;
};

export function PageHeader({ title, description }: PageHeaderProps) {
  return (
    <div className="mb-3">
      <h1 className="text-xl font-bold tracking-normal text-ink sm:text-2xl">{title}</h1>
      <p className="mt-1.5 max-w-2xl text-sm leading-5 text-black/62">{description}</p>
    </div>
  );
}
