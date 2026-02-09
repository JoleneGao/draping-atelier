// Vercel Serverless Function - Claude API 代理
// Pro 计划支持最长 300 秒超时

export const config = {
  maxDuration: 300,
};

/**
 * 从 AI 原始文本中提取并解析 JSON
 * 多重容错，确保最大概率成功
 */
function extractJSON(rawText) {
  if (!rawText || !rawText.trim()) {
    throw new Error('AI 返回了空内容');
  }

  let text = rawText.trim();

  // 1. 去掉 markdown 代码块包裹（支持多种格式）
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  // 去掉可能的 BOM
  text = text.replace(/^\uFEFF/, '');
  text = text.trim();

  // 2. 直接尝试解析
  try {
    return JSON.parse(text);
  } catch (e) {
    console.log('Direct parse failed:', e.message);
  }

  // 3. 提取第一个 { 到最后一个 } 之间的内容
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    // 最后尝试：也许整个文本被包在其他字符中
    console.error('No JSON braces found. Text preview:', text.substring(0, 500));
    throw new Error('AI 返回内容中未找到 JSON 对象');
  }

  let jsonStr = text.substring(firstBrace, lastBrace + 1);

  // 4. 基础清理
  // 去除控制字符（保留 \n \r \t）
  jsonStr = jsonStr.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  // 去除尾逗号
  jsonStr = jsonStr.replace(/,\s*([}\]])/g, '$1');

  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    console.log('Cleaned parse failed:', e.message);
  }

  // 5. 深度修复：逐字符遍历，修复字符串内的所有非法字符
  let fixed = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < jsonStr.length; i++) {
    const ch = jsonStr[i];
    if (escaped) {
      // 验证转义序列是否合法
      if ('"\\\/bfnrtu'.indexOf(ch) >= 0) {
        fixed += ch;
      } else {
        // 非法转义，去掉反斜杠保留字符
        fixed += ch;
      }
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      if (inString) {
        fixed += ch;
        escaped = true;
      } else {
        // 字符串外的反斜杠，直接跳过
      }
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      fixed += ch;
      continue;
    }
    if (inString) {
      // 字符串内：换行 → \\n，制表符 → \\t
      if (ch === '\n' || ch === '\r') {
        fixed += '\\n';
        continue;
      }
      if (ch === '\t') {
        fixed += '\\t';
        continue;
      }
    }
    fixed += ch;
  }

  try {
    return JSON.parse(fixed);
  } catch (e) {
    console.log('Newline-fixed parse failed:', e.message);
    const match = e.message.match(/position\s+(\d+)/i);
    if (match) {
      const pos = parseInt(match[1]);
      console.log('Error near:', JSON.stringify(fixed.substring(Math.max(0, pos - 50), pos + 50)));
    }
  }

  // 6. 终极修复：中文引号替换 + 再次尝试
  let ultimate = fixed;
  ultimate = ultimate.replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"');  // 中文双引号 → "
  ultimate = ultimate.replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'"); // 中文单引号 → '
  // 修复可能的半角问题
  ultimate = ultimate.replace(/，/g, ',');  // 中文逗号 → 英文逗号
  ultimate = ultimate.replace(/：/g, ':');  // 中文冒号 → 英文冒号
  // 再次去除尾逗号
  ultimate = ultimate.replace(/,\s*([}\]])/g, '$1');

  try {
    return JSON.parse(ultimate);
  } catch (e) {
    console.log('Ultimate fix parse failed:', e.message);
    const match = e.message.match(/position\s+(\d+)/i);
    if (match) {
      const pos = parseInt(match[1]);
      console.log('Ultimate error near:', JSON.stringify(ultimate.substring(Math.max(0, pos - 80), pos + 80)));
    }
  }

  // 7. 最后手段：用正则提取关键字段手动构建
  try {
    console.log('Attempting regex field extraction...');
    const getName = (str, key) => {
      const re = new RegExp('"' + key + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"', 's');
      const m = str.match(re);
      return m ? m[1].replace(/\\n/g, ' ').replace(/\\"/g, '"') : '';
    };
    const getNum = (str, key) => {
      const re = new RegExp('"' + key + '"\\s*:\\s*(\\d+)');
      const m = str.match(re);
      return m ? parseInt(m[1]) : 3;
    };

    // 提取 steps 数组 - 找到所有 title+desc 对
    const stepRegex = /\{"title"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"desc"\s*:\s*"((?:[^"\\]|\\.)*)"/gs;
    const stepsArr = [];
    let stepMatch;
    while ((stepMatch = stepRegex.exec(jsonStr)) !== null) {
      stepsArr.push({
        title: stepMatch[1].replace(/\\n/g, ' ').replace(/\\"/g, '"'),
        desc: stepMatch[2].replace(/\\n/g, ' ').replace(/\\"/g, '"'),
        technique: '',
        icon: 'pin',
        area: 'full',
        tips: '',
        troubles: []
      });
    }

    if (stepsArr.length > 0) {
      console.log('Regex extraction found', stepsArr.length, 'steps');
      return {
        designName: getName(jsonStr, 'designName') || '立裁教程',
        designAnalysis: getName(jsonStr, 'designAnalysis') || '',
        difficulty: getNum(jsonStr, 'difficulty'),
        difficultyReason: getName(jsonStr, 'difficultyReason') || '',
        estimatedTime: getName(jsonStr, 'estimatedTime') || '未知',
        materials: [],
        tools: [],
        steps: stepsArr
      };
    }
  } catch (regexErr) {
    console.log('Regex extraction failed:', regexErr.message);
  }

  console.error('All parse attempts failed. JSON preview:', jsonStr.substring(0, 800));
  throw new Error('多次尝试后仍无法解析 AI 返回的 JSON');
}

/**
 * 校验并补全解析后的数据，确保前端不会崩溃
 */
function validateAndFix(data) {
  return {
    designName: data.designName || '立裁教程',
    designAnalysis: data.designAnalysis || '',
    difficulty: (function() { const n = Number(data.difficulty); return (Number.isFinite(n) && n >= 1 && n <= 5) ? Math.round(n) : 3; })(),
    difficultyReason: data.difficultyReason || '',
    estimatedTime: data.estimatedTime || '未知',
    materials: Array.isArray(data.materials) ? data.materials.map(m => ({
      item: m.item || '未知材料',
      spec: m.spec || '',
      qty: m.qty || '适量'
    })) : [],
    tools: Array.isArray(data.tools) ? data.tools.map(t => ({
      name: t.name || '未知工具',
      purpose: t.purpose || ''
    })) : [],
    steps: Array.isArray(data.steps) ? data.steps.map(s => ({
      title: s.title || '操作步骤',
      desc: s.desc || '',
      technique: s.technique || '',
      icon: s.icon || 'pin',
      area: s.area || 'full',
      tips: s.tips || '',
      troubles: Array.isArray(s.troubles) ? s.troubles.map(t => ({
        q: t.q || '', a: t.a || ''
      })) : []
    })) : []
  };
}


export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: '只支持 POST 请求' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const apiBase = process.env.API_BASE_URL || 'https://api.anthropic.com';
  const model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929';

  if (!apiKey) return res.status(500).json({ error: '服务器未配置 API Key' });

  try {
    const { imageBase64, mediaType } = req.body;
    if (!imageBase64 || !mediaType) return res.status(400).json({ error: '缺少图片数据' });

    const PROMPT = `你是一位拥有20年经验的立裁（draping）大师和时装设计教育家。请分析这张立裁/服装设计图片，为零基础初学者提供一份完整的、手把手的立裁操作教程。

请用中文回答。严格只返回JSON，不要有任何其他文字、markdown标记或代码块：
{"designName":"简洁的设计名称","designAnalysis":"2-3句话描述这件设计的核心特征和整体风格","difficulty":3,"difficultyReason":"难度评估原因","estimatedTime":"预计完成时间","materials":[{"item":"材料名","spec":"规格克重质地等","qty":"用量"}],"tools":[{"name":"工具名","purpose":"用途"}],"steps":[{"title":"步骤标题","desc":"详细操作说明，用初学者能理解的语言描述手怎么放、布怎么摆、针怎么插，至少3-4句话","technique":"核心技法","icon":"pin","area":"chest","tips":"操作贴士","troubles":[{"q":"可能的问题","a":"解决方法"}]}]}

要求：1.步骤详细，每步只做一个核心动作 2.通俗易懂，专业术语附解释 3.提供8-15个步骤 4.area只能是：neck/shoulder/chest/waist/hip/hem/side/back/full 5.icon只能是：pin/scissors/pencil/ruler/hand/fold/iron/measure 6.所有字符串值内不要包含换行，保持在一行内`;

    // 构建请求体
    const requestBody = JSON.stringify({
      model,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
            { type: 'text', text: PROMPT },
          ],
        },
        {
          role: 'assistant',
          content: '{"designName":"',
        },
      ],
    });

    // 带重试的 fetch（最多 2 次，同一 endpoint）
    const apiUrl = apiBase + '/v1/messages';
    let response;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 150000);
      console.log(`Fetch attempt ${attempt}, endpoint: ${apiBase}`);

      try {
        response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          signal: controller.signal,
          body: requestBody,
        });
        clearTimeout(timeout);
        console.log(`Response status: ${response.status}`);
        break;
      } catch (fetchErr) {
        clearTimeout(timeout);
        console.error(`Attempt ${attempt} failed:`, fetchErr.message);
        if (fetchErr.name === 'AbortError') {
          return res.status(504).json({ error: 'AI 服务响应超时（150秒），请稍后重试或更换较小的图片' });
        }
        if (attempt === 2) {
          return res.status(502).json({ error: '无法连接到 AI 服务（' + apiBase + '），请检查 API_BASE_URL 配置或稍后重试' });
        }
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    const responseText = await response.text();

    // 检测代理网关错误（HTML 响应）
    if (responseText.includes('Gateway Time-out') || responseText.includes('<html')) {
      console.error('Gateway error:', responseText.substring(0, 300));
      return res.status(504).json({ error: 'API 代理网关超时或返回异常，请稍后重试' });
    }

    if (!response.ok) {
      let errorMsg = '调用 AI 服务失败';
      try {
        const errorData = JSON.parse(responseText);
        errorMsg = errorData.error?.message || errorData.error || errorMsg;
      } catch {
        errorMsg = responseText.substring(0, 200) || errorMsg;
      }
      return res.status(response.status).json({ error: errorMsg });
    }

    // 解析 Claude API 响应
    let apiData;
    try {
      apiData = JSON.parse(responseText);
    } catch {
      console.error('Claude API response not JSON:', responseText.substring(0, 300));
      return res.status(502).json({ error: 'AI 服务返回了无效的响应格式' });
    }

    // 提取文本内容（加回 prefill 前缀以还原完整 JSON）
    const rawAiText = (apiData.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');
    const aiText = '{"designName":"' + rawAiText;

    if (!aiText.trim()) {
      console.error('Claude returned empty text. Full response:', JSON.stringify(apiData).substring(0, 500));
      return res.status(502).json({ error: 'AI 未返回文本内容，请重试' });
    }

    console.log('AI text length:', aiText.length);
    console.log('AI text preview:', aiText.substring(0, 200));

    // 在服务器端解析 JSON（这里集中处理所有解析问题）
    let tutorial;
    try {
      tutorial = extractJSON(aiText);
    } catch (parseErr) {
      console.error('JSON extraction failed:', parseErr.message);
      console.error('AI full text:', aiText.substring(0, 1000));
      return res.status(422).json({ error: '解析 AI 返回内容失败: ' + parseErr.message });
    }

    // 校验和补全数据
    if (!tutorial.steps || !Array.isArray(tutorial.steps) || tutorial.steps.length === 0) {
      console.error('No steps found. Keys:', Object.keys(tutorial));
      return res.status(422).json({ error: 'AI 返回的教程缺少步骤信息，请重试' });
    }

    const result = validateAndFix(tutorial);

    // 返回干净的、已校验的 JSON 给前端
    return res.status(200).json({ tutorial: result });

  } catch (error) {
    console.error('Server Error:', error);
    return res.status(500).json({ error: '服务器内部错误: ' + error.message });
  }
}
