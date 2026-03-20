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
Gebruik professionele medische terminologie passend bij fysiotherapie.
Antwoord ALTIJD in het Nederlands.
Antwoord ALTIJD als een geldig JSON-object met exact de gevraagde velden.
Geen markdown, geen extra tekst buiten het JSON-object.`;

  const userPrompt = `Zet deze gesproken memo om naar een ${templateName}-rapport:

MEMO:
${memo}

Geef je antwoord als JSON met deze velden:
${JSON.stringify(template, null, 2)}

Vulregels:
- Vul elk veld in met relevante info uit de memo
- Als info ontbreekt: schrijf "[Niet vermeld in memo]"
- Wees professioneel en bondig
- Gebruik standaard fysiotherapie-terminologie
- Gebruik NRS voor pijnscores
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
