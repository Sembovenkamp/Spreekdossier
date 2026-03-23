// AVG COMPLIANCE:
// - Spraakopnames worden client-side verwerkt (WebSpeech API) en nooit naar server gestuurd
// - Memo-tekst wordt per request naar Anthropic gestuurd en NIET opgeslagen
// - Anthropic Data Processing Agreement is van toepassing (zero data retention optie)
// - Geen patiënt-identificerende data wordt gelogd
// - Sessie-IDs zijn random en niet gekoppeld aan personen

// ─── Rate limiting (in-memory, per IP) ───────────────────────────────────────
const rateLimitMap = new Map(); // IP → { count, resetTime }
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return true; // allowed
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    return false; // blocked
  }
  entry.count++;
  return true; // allowed
}

// ─── Model config ────────────────────────────────────────────────────────────
const PRIMARY_MODEL = 'claude-sonnet-4-5';
const FALLBACK_MODEL = 'claude-haiku-4-5-20251001';

// Max tokens per type — smaller docs = faster & cheaper
const MAX_TOKENS = {
  soep: 400,
  patientbericht: 600,
  verwijsbrief: 500,
  behandelplan: 500,
  tussenevaluatie: 400,
  ontslagbrief: 500,
  alle: 1000,
};

// ─── System prompt ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Je bent Spreekdossier — AI-administratieassistent voor Nederlandse fysiotherapeuten. Zet transcripties om naar medische documentatie in correct Nederlands. Stel geen vragen. Vul ontbrekende info logisch aan.

SOEP: Gebruik S/O/E/P-structuur. Professioneel, beknopt, medisch correct.
PATIENTBERICHT: Max 5 zinnen. Geen jargon. Vriendelijk. Één concrete vervolgstap.
VERWIJSBRIEF: Formele brief. Begin met 'Geachte collega,'. Sluit af met 'Met collegiale groet, [naam therapeut]'. Bevat: reden, bevindingen, behandeling, vervolgplan.
BEHANDELPLAN: Hoofdklacht → doelstellingen → methoden → frequentie → evaluatie.
TUSSENEVALUATIE: Voortgang t.o.v. doelen → wat gaat goed → bijstelling plan.
ONTSLAGBRIEF: Trajectsamenvatting → behaalde doelen → adviezen → aanbevelingen.

Gebruik ## [DOCUMENTTYPE] als header. Geen extra uitleg buiten het document.`;

// ─── User prompt builder per type ────────────────────────────────────────────
function buildUserPrompt(type, memo, template, templateName) {
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

  const typeLabel = type.toUpperCase();
  return `Genereer alleen een ${typeLabel} op basis van deze transcriptie:

TRANSCRIPTIE:
${memo}

Begin direct met ## ${typeLabel}. Geen intro, geen uitleg, geen extra secties.`;
}

// ─── Anthropic API call ───────────────────────────────────────────────────────
async function callAnthropic(apiKey, model, maxTokens, userPrompt) {
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

// ─── Parse JSON output safely ─────────────────────────────────────────────────
function parseJsonOutput(text) {
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

// ─── Type guard ───────────────────────────────────────────────────────────────
function isValidType(value) {
  return typeof value === 'string' &&
    ['soep', 'patientbericht', 'verwijsbrief', 'behandelplan', 'tussenevaluatie', 'ontslagbrief', 'alle'].includes(value);
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Rate limiting ──────────────────────────────────────────────────────────
  const ip = (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Te veel verzoeken. Probeer het over een minuut opnieuw.' });
  }

  // Destructure request
  const {
    memo,
    template,
    templateName,
    type = 'alle',
    mode,
  } = req.body;

  if (!memo) {
    return res.status(400).json({ error: 'Missing memo' });
  }

  // ── Request logging (geen patiëntdata) ────────────────────────────────────
  console.log('[chat] req', { ip, template: templateName || type, mode, memoLength: memo ? memo.length : 0 });

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  // ── Legacy mode routing ────────────────────────────────────────────────────
  if (mode === 'patient_message') {
    return handlePatientMessage(req, res, memo, ANTHROPIC_API_KEY, ip);
  }
  if (mode === 'verwijsbrief') {
    return handleVerwijsBrief(req, res, memo, ANTHROPIC_API_KEY, ip);
  }

  // ── Resolve document type ──────────────────────────────────────────────────
  const docType = isValidType(type) ? type : 'alle';
  const maxTokens = MAX_TOKENS[docType];

  const userPrompt = buildUserPrompt(docType, memo, template, templateName);

  // ── Call primary model, fall back on error ─────────────────────────────────
  let response;
  let usedModel = PRIMARY_MODEL;
  const reqStart = Date.now();

  try {
    response = await callAnthropic(ANTHROPIC_API_KEY, PRIMARY_MODEL, maxTokens, userPrompt);

    if (!response.ok) {
      const errText = await response.text();
      console.error('[chat] err', { status: response.status, message: errText.slice(0, 200), ip });
      console.warn(`Primary model error (${response.status}), falling back to ${FALLBACK_MODEL}`);
      usedModel = FALLBACK_MODEL;
      response = await callAnthropic(ANTHROPIC_API_KEY, FALLBACK_MODEL, maxTokens, userPrompt);
    }
  } catch (fetchError) {
    const elapsed = Date.now() - reqStart;
    if (fetchError.name === 'AbortError' || elapsed > 25000) {
      console.error('[chat] timeout', { ip, elapsed });
    } else {
      console.error('[chat] err', { status: 0, message: String(fetchError), ip });
    }
    console.warn('Primary model fetch failed, falling back:', fetchError);
    usedModel = FALLBACK_MODEL;
    try {
      response = await callAnthropic(ANTHROPIC_API_KEY, FALLBACK_MODEL, maxTokens, userPrompt);
    } catch (fallbackError) {
      console.error('[chat] err', { status: 0, message: String(fallbackError), ip });
      return res.status(500).json({ error: 'AI service unavailable' });
    }
  }

  if (!response.ok) {
    const errText = await response.text();
    console.error('[chat] err', { status: response.status, message: errText.slice(0, 200), ip });
    return res.status(502).json({ error: 'AI service unavailable', detail: errText });
  }

  const data = await response.json();
  const text = data.content?.[0]?.text ?? '';

  if (docType === 'alle' && template) {
    const parsed = parseJsonOutput(text);
    return res.status(200).json({ output: parsed, model: usedModel });
  }

  return res.status(200).json({ output: text, model: usedModel });
}

// ─── Legacy: patiëntbericht (mode="patient_message") ─────────────────────────
async function handlePatientMessage(_req, res, memo, apiKey, ip) {
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

  const reqStart = Date.now();
  try {
    let response = await callAnthropic(apiKey, PRIMARY_MODEL, MAX_TOKENS.patientbericht * 5, patientUserPrompt);
    if (!response.ok) {
      const errText = await response.text();
      console.error('[chat] err', { status: response.status, message: errText.slice(0, 200), ip });
      response = await callAnthropic(apiKey, FALLBACK_MODEL, MAX_TOKENS.patientbericht * 5, patientUserPrompt);
    }
    if (!response.ok) {
      const errText = await response.text();
      console.error('[chat] err', { status: response.status, message: errText.slice(0, 200), ip });
      return res.status(502).json({ error: 'AI service unavailable', detail: errText });
    }
    const data = await response.json();
    const text = data.content?.[0]?.text ?? '{}';
    const parsed = parseJsonOutput(text);
    return res.status(200).json({ output: parsed });
  } catch (error) {
    const elapsed = Date.now() - reqStart;
    if (elapsed > 25000) {
      console.error('[chat] timeout', { ip, elapsed });
    } else {
      console.error('[chat] err', { status: 0, message: String(error), ip });
    }
    return res.status(500).json({ error: 'Patiëntbericht generatie mislukt', detail: error.message });
  }
}

// ─── Legacy: verwijsbrief (mode="verwijsbrief") ───────────────────────────────
async function handleVerwijsBrief(_req, res, memo, apiKey, ip) {
  const date = new Date().toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });

  const verwijsUserPrompt = `Schrijf een professionele verwijsbrief naar een huisarts of specialist op basis van deze behandelmemo.

Gebruik placeholders voor ontbrekende info: [naam patiënt], [naam fysiotherapeut], [praktijknaam], [AGB-code].
Datum: ${date}

MEMO:
${memo}

Antwoord als geldig JSON: { "brief": "volledige brieftext" }
Geen markdown, geen extra tekst buiten de JSON.`;

  const reqStart = Date.now();
  try {
    let response = await callAnthropic(apiKey, PRIMARY_MODEL, MAX_TOKENS.verwijsbrief, verwijsUserPrompt);
    if (!response.ok) {
      const errText = await response.text();
      console.error('[chat] err', { status: response.status, message: errText.slice(0, 200), ip });
      response = await callAnthropic(apiKey, FALLBACK_MODEL, MAX_TOKENS.verwijsbrief, verwijsUserPrompt);
    }
    if (!response.ok) {
      const errText = await response.text();
      console.error('[chat] err', { status: response.status, message: errText.slice(0, 200), ip });
      return res.status(502).json({ error: 'AI service unavailable', detail: errText });
    }
    const data = await response.json();
    const text = data.content?.[0]?.text ?? '{}';
    const parsed = parseJsonOutput(text);
    return res.status(200).json({ output: parsed });
  } catch (error) {
    const elapsed = Date.now() - reqStart;
    if (elapsed > 25000) {
      console.error('[chat] timeout', { ip, elapsed });
    } else {
      console.error('[chat] err', { status: 0, message: String(error), ip });
    }
    return res.status(500).json({ error: 'Verwijsbrief generatie mislukt', detail: error.message });
  }
}
