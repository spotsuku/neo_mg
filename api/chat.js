export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('[chat] ANTHROPIC_API_KEY is not set');
    return res.status(500).json({
      error: 'ANTHROPIC_API_KEY が設定されていません。Vercel の Environment Variables を確認してください。'
    });
  }

  try {
    const { messages, max_tokens = 1200 } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages は配列で指定してください' });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens,
        messages,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[chat] Anthropic API error:', data);
      return res.status(response.status).json({
        error: data.error?.message || `Anthropic API error: ${response.status}`
      });
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error('[chat] Unexpected error:', error);
    return res.status(500).json({ error: error.message });
  }
}
