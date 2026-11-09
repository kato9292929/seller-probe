import { useEffect, useState } from "react";
import { ApiSection } from "@/components/ApiSection";
import { CheckPage } from "@/components/CheckPage";
import { CuratedSection } from "@/components/CuratedSection";
import { Footer } from "@/components/Footer";
import { FormulaSection } from "@/components/FormulaSection";
import { Hero } from "@/components/Hero";
import { MethodSection } from "@/components/MethodSection";
import { Nav } from "@/components/Nav";
import { OperatorCards } from "@/components/OperatorCards";
import { ScoresSection } from "@/components/ScoresSection";
import { type Scores, type Weights, getJson } from "@/lib/data";

export default function App() {
  const path = window.location.pathname.replace(/\/$/, "");
  if (path === "/check") return <CheckPage />;
  if (path === "/purchases") return <Purchases />;
  return <Home />;
}

function Home() {
  const [scores, setScores] = useState<Scores | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [weights, setWeights] = useState<Weights | null>(null);

  useEffect(() => {
    getJson<Scores>("/scores").then(setScores, (e) => setError(String(e?.message ?? e)));
    getJson<Weights>("/data/weights.json").then(setWeights, () => setWeights(null));
  }, []);

  return (
    <>
      <Hero />
      <main>
        {/* Top: the curated purchases as operator cards (12; the rest on /purchases) */}
        <OperatorCards limit={12} />
        <CuratedSection />
        <ScoresSection data={scores} error={error} />
        <FormulaSection w={weights} />
        <MethodSection data={scores} />
        <ApiSection />
      </main>
      <Footer />
    </>
  );
}

/** Every curated operator's card, then the per-endpoint results and definitions. */
function Purchases() {
  return (
    <>
      <div className="bg-[rgb(12_12_12)]">
        <Nav />
      </div>
      <main>
        <OperatorCards full />
        <CuratedSection />
      </main>
      <Footer />
    </>
  );
}
