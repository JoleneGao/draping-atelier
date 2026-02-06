// 返回前端所需的 API 配置（不含敏感信息的完整暴露）
export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const apiBase = process.env.API_BASE_URL || 'https://api.anthropic.com';
  const model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929';

  if (!apiKey) {
    return res.status(500).json({ error: '未配置 API Key' });
  }

  return res.status(200).json({
    apiKey,
    apiBase,
    model
  });
}
