import { useEffect, useState } from "react";
import { ApiSection } from "@/components/ApiSection";
import { Footer } from "@/components/Footer";
import { FormulaSection } from "@/components/FormulaSection";
import { Hero } from "@/components/Hero";
import { MethodSection } from "@/components/MethodSection";
import { ScoresSection } from "@/components/ScoresSection";
import { type Scores, type Weights, getJson } from "@/lib/data";

export default function App() {
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
        <ScoresSection data={scores} error={error} />
        <FormulaSection w={weights} />
        <MethodSection data={scores} />
        <ApiSection />
      </main>
      <Footer />
    </>
  );
}
