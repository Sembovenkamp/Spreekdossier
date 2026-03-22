// Use inline types to avoid @vercel/node dev-dependency requirement
type VercelRequest = { method?: string; body: Record<string, unknown> };
type VercelResponse = {
  status: (code: number) => VercelResponse;
  json: (body: unknown) => VercelResponse;
};

// ─── Model config ────────────────────────────────────────────────────────────
const PRIMARY_MODEL = 'claude-sonnet-4-5';
const FALLBACK_MODEL = 'claude-haiku-4-5-20251001';

// ─── Document types ──────────────────────────────────────────────────────────
type DocumentType =
  | 'soep'
  | 'patientbericht'
  | 'verwijsbrief'
  | 'behandelplan'
  | 'tussenevaluatie'
  | 'ontslagbrief'
  | 'alle';

// Max tokens per type — smaller docs = faster & cheaper
const MAX_TOKENS: Record<DocumentType, number> = {
  soep: 400,
  patientbericht: 600,
  verwijsbrief: 500,
  behandelplan: 500,
  tussenevaluatie: 400,
  ontslagbrief: 500,
  alle: 1000,
};

// ─── System prompt (centralised, used for all types) ─────────────────────────
const SYSTEM_PROMPT = `Je bent Spreekdossier — AI-administratieassistent voor Nederlandse fysiotherapeuten. Zet transcripties om naar medische documentatie in correct Nederlands. Stel geen vragen. Vul ontbrekende info logisch aan.

SOEP: Gebruik S/O/E/P-structuur. Professioneel, beknopt, medisch correct.
PATIENTBERICHT: Max 5 zinnen. Geen jargon. Vriendelijk. Één concrete vervolgstap.
VERWIJSBRIEF: Formele brief. Begin met 'Geachte collega,'. Sluit af met 'Met collegiale groet, [naam therapeut]'. Bevat: reden, bevindingen, behandeling, vervolgplan.
BEHANDELPLAN: Hoofdklacht → doelstellingen → methoden → frequentie → evaluatie.
TUSSENEVALUATIE: Voortgang t.o.v. doelen → wat gaat goed → bijstelling plan.
ONTSLAGBRIEF: Trajectsamenvatting → behaalde doelen → adviezen → aanbevelingen.

Gebruik ## [DOCUMENTTYPE] als header. Geen extra uitleg buiten het document.`;

// ─── User prompt builder per type ────────────────────────────────────────────
function buildUserPrompt(type: DocumentType, memo: string, template?: unknown, templateName?: string): string {
  // For legacy "alle" mode (or when template object is provided), preserve old JSON behaviour
  if ((type === 'alle' || type === undefined) && template) {
    return `Zet deze gesproken memo om naar een ${templateName ?? 'rapport'}:

MEMO (spraak-naar-tekst, kan fouten bevatten):
${memo}

Geef je antwoord als JSON met deze velden:
${JSON.stringify(template, null, 2)}

Vulregels:
- Vul elk veld volledig in met alle relevante info uit de memo
- Corrigeer fonetische fouten naar correcte medische terminologie
- Gebruik ALLEEN plain text — geen markdown asterisken, geen ##, geen bullets met -
- Als info ontbreekt: schrijf "[Niet vermeld in memo]"
- Gebruik NRS voor pijnscores (formaat: NRS X/10)
- Schrijf in derde persoon (de patiënt, hij/zij)`;
  }

  // Patientbericht: genereer 3 varianten met VASTE headers (exact deze tekst, geen variaties)
  if (type === 'patientbericht') {
    return `Genereer drie patiëntberichten op basis van de behandelmemo. Verwerk ALTIJD de concrete details uit de memo: welke oefeningen, hoe vaak per dag, wanneer de volgende afspraak is, en wat de patiënt moet vermijden. Geen generieke tekst — altijd specifiek op basis van de memo.

Gebruik EXACT deze drie headers op een eigen regel:
WHATSAPP:
EMAIL:
SMS:

WHATSAPP:
[Informeel, emoji's toegestaan. Noem specifieke oefeningen + frequentie + volgende afspraak. Max 6 zinnen.]

EMAIL:
[Formeel. Begin met "Onderwerp: Uw behandelinstructies". Noem specifieke oefeningen + frequentie + volgende afspraak. Max 6 zinnen.]

SMS:
[Ultra kort. Alleen de essentie: oefening + frequentie + afspraak. Max 2 zinnen, geen emoji's.]

BEHANDELMEMO:
${memo}`;
  }

  // Single-type prompt — ask for plain text with the correct ## header
  const typeLabel = type.toUpperCase();
  return `Genereer alleen een ${typeLabel} op basis van deze transcriptie:

TRANSCRIPTIE:
${memo}

Begin direct met ## ${typeLabel}. Geen intro, geen uitleg, geen extra secties.`;
}

// ─── Anthropic API call with optional fallback ────────────────────────────────
async function callAnthropic(
  apiKey: string,
  model: string,
  maxTokens: number,
  userPrompt: string
): Promise<Response> {
  return fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
}

// ─── Parse JSON output safely (legacy "alle" mode) ────────────────────────────
function parseJsonOutput(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { /* fall through */ }
    }
    return { output: text };
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Destructure — memo/template come from Whisper transcription output upstream
  const {
    memo,
    template,
    templateName,
    // New: "type" determines which document to generate
    // Falls back to "alle" for backward compatibility with existing frontend
    type = 'alle' as DocumentType,
    // Legacy mode fields (kept for backward compatibility)
    mode,
  } = req.body as {
    memo: string;
    template?: unknown;
    templateName?: string;
    type?: DocumentType;
    mode?: string;
  };

  if (!memo) {
    return res.status(400).json({ error: 'Missing memo' });
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  // ── Legacy mode routing (kept for backward compatibility with existing voice-demo.html) ──
  // These modes predate the "type" parameter and use separate JSON-structured prompts.
  // New integrations should use "type" instead.
  if (mode === 'patient_message') {
    return handlePatientMessage(req, res, memo, ANTHROPIC_API_KEY);
  }
  if (mode === 'verwijsbrief') {
    return handleVerwijsBrief(req, res, memo, ANTHROPIC_API_KEY);
  }

  // ── Resolve document type ──────────────────────────────────────────────────
  const docType: DocumentType = isValidType(type) ? type : 'alle';
  const maxTokens = MAX_TOKENS[docType];

  // Build prompt — passes template/templateName for "alle" JSON mode
  const userPrompt = buildUserPrompt(docType, memo, template, templateName);

  // ── Call primary model, fall back to Sonnet on API error ──────────────────
  let response: Response;
  let usedModel = PRIMARY_MODEL;

  try {
    response = await callAnthropic(ANTHROPIC_API_KEY, PRIMARY_MODEL, maxTokens, userPrompt);

    // If primary model returns a non-OK status, retry with fallback
    if (!response.ok) {
      const errText = await response.text();
      console.warn(`Primary model error (${response.status}), falling back to ${FALLBACK_MODEL}:`, errText);
      usedModel = FALLBACK_MODEL;
      response = await callAnthropic(ANTHROPIC_API_KEY, FALLBACK_MODEL, maxTokens, userPrompt);
    }
  } catch (fetchError) {
    // Network-level error on primary — try fallback
    console.warn('Primary model fetch failed, falling back:', fetchError);
    usedModel = FALLBACK_MODEL;
    try {
      response = await callAnthropic(ANTHROPIC_API_KEY, FALLBACK_MODEL, maxTokens, userPrompt);
    } catch (fallbackError) {
      console.error('Fallback model also failed:', fallbackError);
      return res.status(500).json({ error: 'AI service unavailable' });
    }
  }

  if (!response.ok) {
    const errText = await response.text();
    console.error('Both models failed:', errText);
    return res.status(502).json({ error: 'AI service unavailable', detail: errText });
  }

  const data = await response.json() as { content?: Array<{ text: string }> };
  const text = data.content?.[0]?.text ?? '';

  // For "alle" (legacy JSON mode), parse structured output
  // For single-type requests, return plain text directly
  if (docType === 'alle' && template) {
    const parsed = parseJsonOutput(text);
    return res.status(200).json({ output: parsed, model: usedModel });
  }

  return res.status(200).json({ output: text, model: usedModel });
}

// ─── Type guard ───────────────────────────────────────────────────────────────
function isValidType(value: unknown): value is DocumentType {
  return typeof value === 'string' &&
    ['soep', 'patientbericht', 'verwijsbrief', 'behandelplan', 'tussenevaluatie', 'ontslagbrief', 'alle'].includes(value);
}

// ─── Legacy: patiëntbericht (mode="patient_message") ─────────────────────────
// Kept for backward compat with voice-demo.html — generates 3 message variants
async function handlePatientMessage(
  _req: VercelRequest,
  res: VercelResponse,
  memo: string,
  apiKey: string
) {
  const patientSystemPrompt = `Je bent Spreekdossier — AI-administratieassistent voor Nederlandse fysiotherapeuten. Zet transcripties om naar medische documentatie in correct Nederlands. Stel geen vragen. Vul ontbrekende info logisch aan.

PATIENTBERICHT: Max 5 zinnen. Geen jargon. Vriendelijk. Één concrete vervolgstap.

Gebruik ## [DOCUMENTTYPE] als header. Geen extra uitleg buiten het document.`;

  const patientUserPrompt = `Genereer drie versies van een patiëntbericht na behandeling op basis van deze memo.

MEMO:
${memo}

Antwoord als geldig JSON:
{
  "whatsapp": "informeel, emoji's toegestaan, *vetgedrukt* voor nadruk, korte zinnen",
  "email": "formeler, volledige zinnen, begin met 'Onderwerp: ...'",
  "sms": "zeer kort, max 3-4 zinnen, geen emoji's"
}
Geen markdown buiten de JSON.`;

  try {
    // Patient messages are short — haiku is sufficient, no fallback needed here
    let response = await callAnthropic(apiKey, PRIMARY_MODEL, MAX_TOKENS.patientbericht * 5, patientUserPrompt);
    if (!response.ok) {
      response = await callAnthropic(apiKey, FALLBACK_MODEL, MAX_TOKENS.patientbericht * 5, patientUserPrompt);
    }
    if (!response.ok) {
      const errText = await response.text();
      return res.status(502).json({ error: 'AI service unavailable', detail: errText });
    }
    const data = await response.json() as { content?: Array<{ text: string }> };
    const text = data.content?.[0]?.text ?? '{}';
    const parsed = parseJsonOutput(text);
    return res.status(200).json({ output: parsed });
  } catch (error) {
    console.error('Patient message handler error:', error);
    return res.status(500).json({ error: 'Patiëntbericht generatie mislukt', detail: (error as Error).message });
  }
}

// ─── Legacy: verwijsbrief (mode="verwijsbrief") ───────────────────────────────
// Kept for backward compat — uses JSON output format for structured letter fields
async function handleVerwijsBrief(
  _req: VercelRequest,
  res: VercelResponse,
  memo: string,
  apiKey: string
) {
  const date = new Date().toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });

  const verwijsUserPrompt = `Schrijf een professionele verwijsbrief naar een huisarts of specialist op basis van deze behandelmemo.

Gebruik placeholders voor ontbrekende info: [naam patiënt], [naam fysiotherapeut], [praktijknaam], [AGB-code].
Datum: ${date}

MEMO:
${memo}

Antwoord als geldig JSON: { "brief": "volledige brieftext" }
Geen markdown, geen extra tekst buiten de JSON.`;

  try {
    let response = await callAnthropic(apiKey, PRIMARY_MODEL, MAX_TOKENS.verwijsbrief, verwijsUserPrompt);
    if (!response.ok) {
      response = await callAnthropic(apiKey, FALLBACK_MODEL, MAX_TOKENS.verwijsbrief, verwijsUserPrompt);
    }
    if (!response.ok) {
      const errText = await response.text();
      return res.status(502).json({ error: 'AI service unavailable', detail: errText });
    }
    const data = await response.json() as { content?: Array<{ text: string }> };
    const text = data.content?.[0]?.text ?? '{}';
    const parsed = parseJsonOutput(text);
    return res.status(200).json({ output: parsed });
  } catch (error) {
    console.error('Verwijsbrief handler error:', error);
    return res.status(500).json({ error: 'Verwijsbrief generatie mislukt', detail: (error as Error).message });
  }
}
