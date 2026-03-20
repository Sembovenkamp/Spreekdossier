# Spreekdossier — AI-rapportageassistent

> **Minder typen. Meer behandelen.**

Marketingpagina + live SOEP-demo voor Spreekdossier, gebouwd met een Node.js proxy server zodat de Anthropic API key veilig op de server blijft.

## Starten

### 1. Installeer dependencies

```bash
cd /home/sem/.openclaw/workspace/spreekdossier-site
npm install
```

### 2. Start de server

```bash
# Automatisch API key uit OpenClaw config laden:
npm start

# Of handmatig met eigen key:
ANTHROPIC_API_KEY=sk-ant-... node server.js
```

### 3. Open in browser

```
http://localhost:8100
```

## Structuur

```
spreekdossier-site/
├── index.html     # Volledige marketingpagina met live demo
├── server.js      # Node.js proxy server (poort 8100)
├── package.json   # Dependencies
└── README.md      # Dit bestand
```

## API

**POST /api/soep**

Request:
```json
{ "memo": "Patiënt De Vries, 58 jaar, fysiotherapie..." }
```

Response:
```json
{
  "S": "Subjectieve bevindingen...",
  "O": "Objectieve bevindingen...",
  "E": "Evaluatie...",
  "P": "Plan..."
}
```

## Technisch

- Server: Node.js + Express
- AI: Anthropic Claude (claude-sonnet-4-6)
- API key: via environment variable `ANTHROPIC_API_KEY`
- Poort: 8100 (aanpassen via `PORT` env var)

## Deployment

Voor productie:
1. Zet `ANTHROPIC_API_KEY` als environment variable
2. Gebruik een process manager zoals PM2: `pm2 start server.js`
3. Reverse proxy via Nginx naar poort 8100

## Domein

- spreekdossier.nl
- spreekdossier.com
