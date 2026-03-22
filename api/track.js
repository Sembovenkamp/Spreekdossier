export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { template, session_id } = req.body;
  if (!template || !session_id) return res.status(400).json({ error: 'Missing fields' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  await fetch(`${SUPABASE_URL}/rest/v1/usage_events`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({ template, session_id })
  });

  return res.status(200).json({ ok: true });
}
