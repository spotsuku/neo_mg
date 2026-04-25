// クライアントへ Supabase 接続情報を返す（公開可能な anon key）
// Vercel 環境変数:
//   SUPABASE_URL          (server / client 共通)
//   SUPABASE_ANON_KEY     (client 用、公開可)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=300');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url     = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return res.status(500).json({
      error: 'SUPABASE_URL / SUPABASE_ANON_KEY 環境変数が未設定です',
    });
  }

  return res.status(200).json({ supabaseUrl: url, anonKey });
}
