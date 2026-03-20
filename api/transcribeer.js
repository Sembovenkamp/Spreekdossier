const OpenAI = require('openai');
const formidable = require('formidable');
const fs = require('fs');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const form = formidable({ maxFileSize: 25 * 1024 * 1024 });
  
  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(400).json({ error: 'Upload mislukt' });
    
    const audioFile = files.audio?.[0] || files.audio;
    if (!audioFile) return res.status(400).json({ error: 'Geen audio bestand' });

    try {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      
      const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(audioFile.filepath),
        model: 'whisper-1',
        language: 'nl',
        response_format: 'text'
      });

      // Verwijder tijdelijk bestand
      fs.unlinkSync(audioFile.filepath);

      res.status(200).json({ transcriptie: transcription });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
