export function SectionTitle({ eyebrow, title, children }: { eyebrow: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-8 max-w-3xl">
      <p className="mb-3 text-xs uppercase tracking-[0.2em] text-muted-foreground">{eyebrow}</p>
      <h2 className="text-4xl font-normal leading-tight tracking-tight sm:text-5xl" style={{ fontFamily: "'Instrument Serif', serif" }}>
        {title}
      </h2>
      {children && <div className="mt-4 leading-relaxed text-muted-foreground">{children}</div>}
    </div>
  );
}
