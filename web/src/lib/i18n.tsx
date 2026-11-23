// Japanese / English / Chinese for the whole page. The choice is kept in this browser
// (localStorage) and applied in the page, without changing the URL (as on x402jp.com).
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Lang = "ja" | "en" | "zh";
export const LANGS: { id: Lang; label: string; html: string }[] = [
  { id: "ja", label: "JP", html: "ja" },
  { id: "en", label: "EN", html: "en" },
  { id: "zh", label: "中文", html: "zh-Hans" },
];
const KEY = "probe-lang";

/** One string in the three languages. */
export type L = { ja: string; en: string; zh: string };

function initial(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "ja" || v === "en" || v === "zh") return v;
  } catch {
    /* storage blocked: default */
  }
  return "ja";
}

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: (s: L) => string };
const LangContext = createContext<Ctx>({ lang: "ja", setLang: () => {}, t: (s) => s.ja });

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, set] = useState<Lang>(initial);
  const setLang = useCallback((l: Lang) => {
    set(l);
    try {
      localStorage.setItem(KEY, l);
    } catch {
      /* not kept: fine */
    }
  }, []);
  useEffect(() => {
    document.documentElement.lang = LANGS.find((x) => x.id === lang)!.html;
    document.title = TITLE[lang];
  }, [lang]);
  const value = useMemo<Ctx>(() => ({ lang, setLang, t: (s: L) => s[lang] }), [lang, setLang]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export const useLang = () => useContext(LangContext);

const TITLE: Record<Lang, string> = {
  ja: "Seller Probe — x402 の売り手を、払う前に測る",
  en: "Seller Probe — every x402 seller, measured before you pay",
  zh: "Seller Probe — 付款前先测量每个 x402 卖家",
};

/** Date as the language writes it (2026年11月8日 / Nov 8, 2026 / 2026年11月8日). */
export function fmtDate(d: string | null, lang: Lang): string {
  if (!d) return "—";
  const [y, m, day] = [Number(d.slice(0, 4)), Number(d.slice(5, 7)), Number(d.slice(8, 10))];
  if (lang === "en") return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
  return `${y}年${m}月${day}日`;
}

/** The JP / EN / 中文 pill (same form as x402jp.com's header). */
export function LangSwitch({ className = "" }: { className?: string }) {
  const { lang, setLang } = useLang();
  return (
    <div className={`flex items-center gap-0.5 rounded-full border border-white/15 p-0.5 text-xs font-medium ${className}`} role="group" aria-label="Language / 言語 / 语言">
      {LANGS.map((l) => (
        <button
          key={l.id}
          type="button"
          lang={l.html}
          aria-pressed={lang === l.id}
          onClick={() => setLang(l.id)}
          className={`rounded-full px-2.5 py-1 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70 ${lang === l.id ? "bg-white/15 text-foreground" : "text-foreground/50 hover:text-foreground/80"}`}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}
