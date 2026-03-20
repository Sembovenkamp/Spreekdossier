const Anthropic = require('@anthropic-ai/sdk');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { memo } = req.body;
  if (!memo) return res.status(400).json({ error: 'Geen memo meegegeven' });

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const prompt = `Je bent Spreekdossier, een professionele AI-documentatieassistent voor Nederlandse zorgverleners.

Zet de volgende gesproken memo om naar een gestructureerde SOEP-rapportage.

Regels:
- Gebruik professioneel Nederlands zorgvakjargon
- Schrijf in derde persoon ("Cliënt rapporteert...", "Cliënt geeft aan...")
- Voeg NIETS toe wat niet in de memo staat
- Als info ontbreekt schrijf: "[Niet vermeld]"

Geef je antwoord in dit exacte JSON-formaat:
{"S": "subjectieve bevindingen", "O": "objectieve bevindingen", "E": "evaluatie", "P": "plan"}

Memo: ${memo}`;

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = message.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(500).json({ error: 'Geen JSON in response' });

    const soep = JSON.parse(jsonMatch[0]);
    res.status(200).json(soep);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
