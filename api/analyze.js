// Vercel Edge Function - Claude API 代理（流式传输）
// 使用 streaming 避免超时：边接收边转发，不等完整响应

export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: '只支持 POST 请求' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const apiBase = process.env.API_BASE_URL || 'https://api.anthropic.com';
  const model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929';

  if (!apiKey) {
    return new Response(JSON.stringify({ error: '服务器未配置 API Key' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { imageBase64, mediaType } = await req.json();

    if (!imageBase64 || !mediaType) {
      return new Response(JSON.stringify({ error: '缺少图片数据' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const PROMPT = `你是一位拥有20年经验的立裁（draping）大师和时装设计教育家。请分析这张立裁/服装设计图片，为零基础初学者提供一份完整的、手把手的立裁操作教程。

请用中文回答。严格只返回JSON，不要有任何其他文字、markdown标记或代码块：
{"designName":"简洁的设计名称","designAnalysis":"2-3句话描述这件设计的核心特征和整体风格","difficulty":3,"difficultyReason":"难度评估原因","estimatedTime":"预计完成时间","materials":[{"item":"材料名","spec":"规格克重质地等","qty":"用量"}],"tools":[{"name":"工具名","purpose":"用途"}],"steps":[{"title":"步骤标题","desc":"详细操作说明，用初学者能理解的语言描述手怎么放、布怎么摆、针怎么插，至少3-4句话","technique":"核心技法","icon":"pin","area":"chest","tips":"操作贴士","troubles":[{"q":"可能的问题","a":"解决方法"}]}]}

要求：1.步骤详细，每步只做一个核心动作 2.通俗易懂，专业术语附解释 3.提供8-15个步骤 4.area只能是：neck/shoulder/chest/waist/hip/hem/side/back/full 5.icon只能是：pin/scissors/pencil/ruler/hand/fold/iron/measure`;

    // 使用 streaming 模式调用 API
    const response = await fetch(`${apiBase}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        stream: true,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
              { type: 'text', text: PROMPT },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMsg = '调用 AI 服务失败';
      try {
        const errorData = JSON.parse(errorText);
        errorMsg = errorData.error?.message || errorData.error || errorMsg;
      } catch {
        errorMsg = errorText.substring(0, 200) || errorMsg;
      }
      return new Response(JSON.stringify({ error: errorMsg }), {
        status: response.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 流式读取所有 SSE 数据，拼接文本后返回完整 JSON
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let inputTokens = 0;
    let outputTokens = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;

        try {
          const event = JSON.parse(data);

          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            fullText += event.delta.text;
          }
          if (event.type === 'message_start' && event.message?.usage) {
            inputTokens = event.message.usage.input_tokens || 0;
          }
          if (event.type === 'message_delta' && event.usage) {
            outputTokens = event.usage.output_tokens || 0;
          }
        } catch {
          // 忽略无法解析的行
        }
      }
    }

    // 构造与非流式 API 兼容的响应格式
    const result = {
      content: [{ type: 'text', text: fullText }],
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    };

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: '服务器内部错误: ' + error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}
