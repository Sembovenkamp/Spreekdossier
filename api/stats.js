const MINUTES_SAVED = {
  intake: 12,
  soep: 7,
  behandelplan: 10,
  evaluatie: 8,
  afsluiting: 9,
  administratie: 5
};

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  const r = await fetch(`${SUPABASE_URL}/rest/v1/usage_events?select=template,session_id`, {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
    }
  });

  const rows = await r.json();
  if (!Array.isArray(rows)) return res.status(200).json({ minutes: 0, users: 0 });

  const minutes = rows.reduce((sum, row) => sum + (MINUTES_SAVED[row.template] || 7), 0);
  const users = new Set(rows.map(r => r.session_id)).size;

  res.setHeader('Cache-Control', 's-maxage=60');
  return res.status(200).json({ minutes, users });
}
