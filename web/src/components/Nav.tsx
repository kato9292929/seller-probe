import { LangSwitch, useLang } from "@/lib/i18n";

const LINKS = [
  { href: "/", label: "Home", active: true },
  { href: "/purchases", label: "Purchases" },
  { href: "/#scores", label: "Scores" },
  { href: "/#formula", label: "Formula" },
  { href: "/#method", label: "Method" },
  { href: "/#api", label: "API" },
  { href: "/check", label: "Check" },
];

export function Nav() {
  const { t } = useLang();
  return (
    <nav className="relative z-10 mx-auto flex w-full max-w-7xl flex-row flex-wrap items-center justify-between gap-3 px-8 py-6">
      <a href="/" className="text-3xl tracking-tight text-foreground" style={{ fontFamily: "'Instrument Serif', serif" }}>
        Seller Probe<sup className="ml-0.5 text-xs">x402</sup>
      </a>
      <div className="hidden items-center gap-8 lg:flex">
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
      <div className="flex items-center gap-3">
        <LangSwitch />
        <a
          href="/#scores"
          className="liquid-glass hidden rounded-full px-6 py-2.5 text-sm text-foreground transition-transform hover:scale-[1.03] sm:inline-block"
        >
          {t({ ja: "View Scores", en: "View Scores", zh: "查看评分" })}
        </a>
      </div>
    </nav>
  );
}
