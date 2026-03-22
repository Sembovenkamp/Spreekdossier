export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OpenAI API key not configured' });
  }

  try {
    // Read raw body as buffer
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    const rawBody = Buffer.concat(chunks);

    // Get content-type to parse boundary
    const contentType = req.headers['content-type'] || '';
    const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);
    if (!boundaryMatch) {
      return res.status(400).json({ error: 'No boundary in multipart form' });
    }

    const boundary = boundaryMatch[1];

    // Simple multipart parser
    const parts = parseMultipart(rawBody, boundary);
    const audioPart = parts.find(p => p.name === 'audio');

    if (!audioPart || !audioPart.data || audioPart.data.length === 0) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    // Determine correct extension
    const mimeType = audioPart.contentType || 'audio/webm';
    let ext = 'webm';
    if (mimeType.includes('mp4') || mimeType.includes('m4a')) ext = 'mp4';
    else if (mimeType.includes('ogg')) ext = 'ogg';
    const filename = audioPart.filename || `audio.${ext}`;

    // Build FormData for Whisper API
    const formData = new FormData();
    const blob = new Blob([audioPart.data], { type: mimeType });
    formData.append('file', blob, filename);
    formData.append('model', 'whisper-1');
    formData.append('language', 'nl');
    formData.append('response_format', 'json');
    formData.append('prompt', 'Fysiotherapie sessie notitie. Termen: SOEP, NRS, ROM, rotatorcuff, patellofemorale, lumbosacraal, manuele therapie, dry needling, KNGF, EPD, AGB-code, Maitland, McKenzie, DASH, PSFS, intake, behandelplan, evaluatie, afsluiting, ICD-10.');

    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: formData,
    });

    if (!whisperRes.ok) {
      const errText = await whisperRes.text();
      console.error('Whisper API error:', errText);
      return res.status(502).json({ error: 'Transcription service unavailable' });
    }

    const result = await whisperRes.json();
    return res.status(200).json({ transcript: result.text || '' });

  } catch (error) {
    console.error('Transcribe handler error:', error);
    return res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
}

function parseMultipart(body, boundary) {
  const parts = [];
  const boundaryBuf = Buffer.from('--' + boundary);
  const boundaryEnd = Buffer.from('--' + boundary + '--');

  let pos = 0;
  while (pos < body.length) {
    // Find boundary
    const boundaryIdx = indexOf(body, boundaryBuf, pos);
    if (boundaryIdx === -1) break;

    // Check if it's the end boundary
    const afterBoundary = boundaryIdx + boundaryBuf.length;
    if (body[afterBoundary] === 45 && body[afterBoundary + 1] === 45) break; // '--'

    // Skip past boundary + CRLF
    let headerStart = afterBoundary + 2; // skip \r\n

    // Find end of headers (double CRLF)
    const headerEnd = indexOf(body, Buffer.from('\r\n\r\n'), headerStart);
    if (headerEnd === -1) break;

    const headerStr = body.slice(headerStart, headerEnd).toString();
    const dataStart = headerEnd + 4; // skip \r\n\r\n

    // Find next boundary
    const nextBoundary = indexOf(body, boundaryBuf, dataStart);
    if (nextBoundary === -1) break;

    // Data ends 2 bytes before next boundary (strip trailing \r\n)
    const dataEnd = nextBoundary - 2;
    const data = body.slice(dataStart, dataEnd);

    // Parse headers
    const nameMatch = headerStr.match(/name="([^"]+)"/);
    const filenameMatch = headerStr.match(/filename="([^"]+)"/);
    const ctMatch = headerStr.match(/Content-Type:\s*([^\r\n]+)/i);

    parts.push({
      name: nameMatch ? nameMatch[1] : '',
      filename: filenameMatch ? filenameMatch[1] : null,
      contentType: ctMatch ? ctMatch[1].trim() : 'application/octet-stream',
      data,
    });

    pos = nextBoundary;
  }

  return parts;
}

function indexOf(buf, search, start = 0) {
  for (let i = start; i <= buf.length - search.length; i++) {
    let found = true;
    for (let j = 0; j < search.length; j++) {
      if (buf[i + j] !== search[j]) { found = false; break; }
    }
    if (found) return i;
  }
  return -1;
}
