const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8100;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!ANTHROPIC_API_KEY) {
  console.error('❌ ANTHROPIC_API_KEY environment variable is not set!');
  console.error('Start the server with: ANTHROPIC_API_KEY=your-key node server.js');
  process.exit(1);
}

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// POST /api/soep — generate SOEP report from memo
app.post('/api/soep', async (req, res) => {
  const { memo } = req.body;

  if (!memo || typeof memo !== 'string' || memo.trim().length === 0) {
    return res.status(400).json({ error: 'Memo is verplicht.' });
  }

  const prompt = `Je bent Spreekdossier, een professionele AI-documentatieassistent voor Nederlandse zorgverleners.

Zet de volgende gesproken memo om naar een gestructureerde SOEP-rapportage.

Regels:
- Gebruik professioneel Nederlands zorgvakjargon
- Schrijf in derde persoon ("Cliënt rapporteert...", "Cliënt geeft aan...")
- Voeg NIETS toe wat niet in de memo staat
- Als info ontbreekt schrijf: "[Niet vermeld]"

Geef je antwoord in dit exacte JSON-formaat:
{
  "S": "subjectieve bevindingen",
  "O": "objectieve bevindingen",
  "E": "evaluatie",
  "P": "plan"
}

Memo: ${memo.trim()}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [
          { role: 'user', content: prompt }
        ]
      })
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error('Anthropic API error:', response.status, errBody);
      return res.status(502).json({ error: 'AI-service tijdelijk niet beschikbaar. Probeer het opnieuw.' });
    }

    const data = await response.json();
    const rawText = data.content?.[0]?.text || '';

    // Extract JSON from the response
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('Could not parse JSON from AI response:', rawText);
      return res.status(502).json({ error: 'Ongeldige response van AI. Probeer het opnieuw.' });
    }

    const soep = JSON.parse(jsonMatch[0]);
    res.json(soep);

  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Serverfout. Probeer het opnieuw.' });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Spreekdossier server draait op http://localhost:${PORT}`);
});
