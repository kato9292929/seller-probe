const LINKS = [
  { href: "#top", label: "Home", active: true },
  { href: "#scores", label: "Scores" },
  { href: "#formula", label: "Formula" },
  { href: "#method", label: "Method" },
  { href: "#api", label: "API" },
  { href: "/check", label: "Check" },
];

export function Nav() {
  return (
    <nav className="relative z-10 mx-auto flex w-full max-w-7xl flex-row items-center justify-between px-8 py-6">
      <a href="#top" className="text-3xl tracking-tight text-foreground" style={{ fontFamily: "'Instrument Serif', serif" }}>
        Seller Probe<sup className="ml-0.5 text-xs">x402</sup>
      </a>
      <div className="hidden items-center gap-8 md:flex">
        {LINKS.map((l) => (
          <a
            key={l.href}
            href={l.href}
            className={`text-sm transition-colors hover:text-foreground ${l.active ? "text-foreground" : "text-muted-foreground"}`}
          >
            {l.label}
          </a>
        ))}
      </div>
      <a
        href="#scores"
        className="liquid-glass rounded-full px-6 py-2.5 text-sm text-foreground transition-transform hover:scale-[1.03]"
      >
        View Scores
      </a>
    </nav>
  );
}
