import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

const client = new Anthropic();

const SYSTEM_PROMPT = `Je bent Spreekdossier — AI-administratieassistent voor Nederlandse fysiotherapeuten. Zet transcripties om naar medische documentatie in correct Nederlands. Stel geen vragen. Vul ontbrekende info logisch aan.

SOEP: Gebruik S/O/E/P-structuur. Professioneel, beknopt, medisch correct.
PATIENTBERICHT: Max 5 zinnen. Geen jargon. Vriendelijk. Één concrete vervolgstap.
VERWIJSBRIEF: Formele brief. Begin met 'Geachte collega,'. Sluit af met 'Met collegiale groet, [naam therapeut]'. Bevat: reden, bevindingen, behandeling, vervolgplan.
BEHANDELPLAN: Hoofdklacht → doelstellingen → methoden → frequentie → evaluatie.
TUSSENEVALUATIE: Voortgang t.o.v. doelen → wat gaat goed → bijstelling plan.
ONTSLAGBRIEF: Trajectsamenvatting → behaalde doelen → adviezen → aanbevelingen.

Gebruik ## [DOCUMENTTYPE] als header. Geen extra uitleg buiten het document.`;

const MAX_TOKENS: Record<string, number> = {
  soep: 400,
  patientbericht: 600,
  verwijsbrief: 500,
  behandelplan: 500,
  tussenevaluatie: 400,
  ontslagbrief: 500,
  alle: 1000,
};

export async function POST(req: NextRequest) {
  const { memo, type = "alle" } = await req.json();

  const model = "claude-sonnet-4-6-20250514";
  const fallback = "claude-haiku-4-5-20251001"; // fallback ongewijzigd

  const run = async (m: string) =>
    client.messages.create({
      model: m,
      max_tokens: MAX_TOKENS[type] ?? 1000,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ] as any,
      messages: [{ role: "user", content: memo }],
    });

  try {
    const res = await run(model);
    const text = res.content.map((b: any) => (b.type === "text" ? b.text : "")).join("");
    return NextResponse.json({ result: text, model });
  } catch {
    const res = await run(fallback);
    const text = res.content.map((b: any) => (b.type === "text" ? b.text : "")).join("");
    return NextResponse.json({ result: text, model: fallback });
  }
}
