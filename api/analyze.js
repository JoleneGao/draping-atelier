// Vercel Serverless Function - Claude API 代理
// 用于隐藏 API Key，安全调用 Claude API

export default async function handler(req, res) {
  // 设置 CORS 头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // 处理 OPTIONS 预检请求
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 只允许 POST 请求
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '只支持 POST 请求' });
  }

  // 检查 API Key 是否配置
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: '服务器未配置 API Key' });
  }

  try {
    const { imageBase64, mediaType } = req.body;

    // 验证请求参数
    if (!imageBase64 || !mediaType) {
      return res.status(400).json({ error: '缺少图片数据' });
    }

    // 立裁分析提示词
    const PROMPT = `你是一位拥有20年经验的立裁（draping）大师和时装设计教育家。请分析这张立裁/服装设计图片，为零基础初学者提供一份完整的、手把手的立裁操作教程。

请用中文回答。严格只返回JSON，不要有任何其他文字、markdown标记或代码块：
{"designName":"简洁的设计名称","designAnalysis":"2-3句话描述这件设计的核心特征和整体风格","difficulty":3,"difficultyReason":"难度评估原因","estimatedTime":"预计完成时间","materials":[{"item":"材料名","spec":"规格克重质地等","qty":"用量"}],"tools":[{"name":"工具名","purpose":"用途"}],"steps":[{"title":"步骤标题","desc":"详细操作说明，用初学者能理解的语言描述手怎么放、布怎么摆、针怎么插，至少3-4句话","technique":"核心技法","icon":"pin","area":"chest","tips":"操作贴士","troubles":[{"q":"可能的问题","a":"解决方法"}]}]}

要求：1.步骤详细，每步只做一个核心动作 2.通俗易懂，专业术语附解释 3.提供8-15个步骤 4.area只能是：neck/shoulder/chest/waist/hip/hem/side/back/full 5.icon只能是：pin/scissors/pencil/ruler/hand/fold/iron/measure`;

    // 调用 Claude API（通过第三方代理）
    const apiBase = process.env.API_BASE_URL || 'https://api.anthropic.com';
    const response = await fetch(`${apiBase}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929',
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mediaType,
                  data: imageBase64,
                },
              },
              {
                type: 'text',
                text: PROMPT,
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Claude API Error:', errorData);
      return res.status(response.status).json({
        error: errorData.error?.message || '调用 AI 服务失败'
      });
    }

    const data = await response.json();

    // 返回结果给前端
    return res.status(200).json(data);

  } catch (error) {
    console.error('Server Error:', error);
    return res.status(500).json({ error: '服务器内部错误: ' + error.message });
  }
}
