import { Nav } from "./Nav";

const VIDEO =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260314_131748_f2ca2a28-fed7-44c8-b9a9-bd9acdd5ec31.mp4";

export function Hero() {
  return (
    <header id="top" className="relative flex min-h-screen flex-col overflow-hidden">
      <video className="absolute inset-0 z-0 h-full w-full object-cover" src={VIDEO} autoPlay loop muted playsInline aria-hidden="true" />
      <Nav />
      <section className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 pb-40 pt-32 py-[90px] text-center">
        <h1
          className="animate-fade-rise max-w-7xl text-5xl font-normal leading-[0.95] tracking-[-2.46px] sm:text-7xl md:text-8xl"
          style={{ fontFamily: "'Instrument Serif', serif" }}
        >
          Every seller, <em className="not-italic text-muted-foreground">measured</em> before you{" "}
          <em className="not-italic text-muted-foreground">pay.</em>
        </h1>
        <p className="animate-fade-rise-delay mt-8 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
          x402 の売り手が本当に動くかを、私たちのエージェントが毎日外から測っています。
          402 の形式から決済、納品まで。結果はホストごとのスコアとして、算出式ごと公開します。
        </p>
        <a
          href="#scores"
          className="animate-fade-rise-delay-2 liquid-glass mt-12 cursor-pointer rounded-full px-14 py-5 text-base text-foreground transition-transform hover:scale-[1.03]"
        >
          View Scores
        </a>
      </section>
    </header>
  );
}
