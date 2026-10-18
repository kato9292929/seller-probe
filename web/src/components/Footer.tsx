export function Footer() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-7xl flex-col gap-2 px-6 py-10 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <span style={{ fontFamily: "'Instrument Serif', serif" }} className="text-xl text-foreground">
          Seller Probe<sup className="ml-0.5 text-xs">x402</sup>
        </span>
        <span>
          運営：
          <a className="underline underline-offset-4 hover:text-foreground" href="https://x402jp.com">
            x402jp.com
          </a>{" "}
          ·{" "}
          <a className="underline underline-offset-4 hover:text-foreground" href="https://github.com/kato9292929/seller-probe">
            GitHub
          </a>
        </span>
      </div>
    </footer>
  );
}
