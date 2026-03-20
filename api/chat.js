export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { memo, template, templateName } = req.body;

  if (!memo || !template) {
    return res.status(400).json({ error: 'Missing memo or template' });
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  const systemPrompt = `Je bent een gespecialiseerde AI-assistent voor fysiotherapeuten in Nederland.
Je taak: zet een gesproken memo van een fysiotherapeut om naar een gestructureerd ${templateName}-rapport.

DOMEINKENNIS — gebruik deze begrippen correct:
- Bewegingsonderzoek: ROM (range of motion), goniometrie, eindgevoel, hypomobiliteit, hypermobiliteit
- Pijnmeting: NRS (Numeric Rating Scale, 0-10), VAS, pijnprovocatietests
- Anatomie: rotatorcuff, glenohumerogewricht, scapula, lumbosacraal, patellofemorale gewricht, meniscus, ACL/PCL/MCL/LCL, tendo Achillis, fascia plantaris, nervus ischiadicus, plexus brachialis
- Diagnoses: impingementsyndroom, frozen shoulder, epicondylitis lateralis/medialis (tenniselleboog/golferselleboog), hernia nuclei pulposi (HNP), lumbago, ischialgie, patellofemoraal pijnsyndroom, tibialis posterior tendinopathie, hallux valgus
- ICD-10 codes: M54.5 (lage rugpijn), M75.1 (rotatorcuffsyndroom), M77.1 (laterale epicondylitis), M22.2 (patellofemoraal), M79.3 (panniculitis)
- Behandelmethoden: manuele therapie, dry needling, TENS, ultrageluid, oefentherapie, McKenzie, Mulligan, Maitland, eccentrisch trainen, proprioceptietraining
- Uitkomstmaten: DASH, PSFS, NDI, ÖGVS, SF-36, Oswestry, KOOS, HOOS
- Richtlijnen: KNGF-richtlijnen, evidence-based fysiotherapie
- Zorgcontext: EPD, zorgverzekeraar, AGB-code, DBC, NZa-prestatiecode, verwijsbrief huisarts

TRANSCRIPTIECORRECTIE — de input is spraak-naar-tekst en kan fouten bevatten:
- Corrigeer fonetisch gespelde medische termen (bv. "rotater cuff" → "rotatorcuff", "NRS ses" → "NRS 6/10", "patella femuraal" → "patellofemoraal")
- Interpreteer getallen correct (bv. "zes op tien" → "NRS 6/10", "negentig graden" → "90°")
- Herstel afgebroken zinnen of onduidelijke spraakfragmenten op basis van context

Antwoord ALTIJD in het Nederlands.
Antwoord ALTIJD als een geldig JSON-object met exact de gevraagde velden.
Geen markdown, geen extra tekst buiten het JSON-object.`;

  const userPrompt = `Zet deze gesproken memo om naar een ${templateName}-rapport:

MEMO (spraak-naar-tekst, kan fouten bevatten):
${memo}

Geef je antwoord als JSON met deze velden:
${JSON.stringify(template, null, 2)}

Vulregels:
- Vul elk veld in met relevante info uit de memo
- Corrigeer fonetische fouten en leenwoorden naar correcte medische terminologie
- Als info ontbreekt: schrijf "[Niet vermeld in memo]"
- Wees professioneel en bondig
- Gebruik standaard fysiotherapie-terminologie
- Gebruik NRS voor pijnscores (formaat: NRS X/10)
- Schrijf in derde persoon (de patiënt, hij/zij)`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Anthropic API error:', err);
      return res.status(502).json({ error: 'AI service unavailable' });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '{}';

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Try to extract JSON from the response
      const match = text.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : {};
    }

    return res.status(200).json({ output: parsed });
  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
