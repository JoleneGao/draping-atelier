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
// 默认材料和工具，当 Claude 返回空数组时使用
const DEFAULT_MATERIALS = [
  { item: '白色坯布（胚布）', spec: '纯棉，中等克重，幅宽150cm', qty: '2-3米' },
  { item: '大头针/珠针', spec: '不锈钢，长3cm', qty: '一盒（约50枚）' },
  { item: '标记笔/划粉', spec: '可水洗消失', qty: '1支' },
  { item: '缝纫线', spec: '棉线，白色', qty: '1卷' },
];
const DEFAULT_TOOLS = [
  { name: '人台/人体模型', purpose: '作为立裁的基础支撑，模拟人体曲线' },
  { name: '裁剪剪刀', purpose: '裁剪布料' },
  { name: '软尺/皮尺', purpose: '测量尺寸和曲线长度' },
  { name: '直尺', purpose: '画直线和测量平面距离' },
];

// 有效的 icon 和 area 列表
const VALID_ICONS = ['pin','scissors','pencil','ruler','hand','fold','iron','measure','drape','wrap','pleat','gather','tuck','dart','trim','baste'];
const VALID_AREAS = ['neck','shoulder','chest','waist','hip','hem','side','back','full'];

// 根据步骤标题/描述智能推断 icon
function inferIcon(step) {
  const text = ((step.title || '') + ' ' + (step.desc || '')).toLowerCase();
  if (/裁|剪|cut|trim/.test(text)) return 'scissors';
  if (/画|标|记|mark|pencil/.test(text)) return 'pencil';
  if (/量|测|measure|尺/.test(text)) return 'measure';
  if (/熨|烫|iron|press/.test(text)) return 'iron';
  if (/折|fold/.test(text)) return 'fold';
  if (/褶|pleat/.test(text)) return 'pleat';
  if (/缝|baste|假缝/.test(text)) return 'baste';
  if (/省|dart/.test(text)) return 'dart';
  if (/收|gather|抽/.test(text)) return 'gather';
  if (/披|挂|覆|drape|布料.*放|铺/.test(text)) return 'drape';
  if (/裹|缠|wrap/.test(text)) return 'wrap';
  if (/修|整|修边/.test(text)) return 'trim';
  if (/整理|调整|手|smooth|hand/.test(text)) return 'hand';
  if (/尺|ruler|直线/.test(text)) return 'ruler';
  if (/固定|pin|珠针|大头针/.test(text)) return 'pin';
  if (/叠|tuck|裥/.test(text)) return 'tuck';
  return null; // 无法推断
}

// 根据步骤标题/描述智能推断 area
function inferArea(step) {
  const text = ((step.title || '') + ' ' + (step.desc || '')).toLowerCase();
  if (/领|颈|neck|衣领/.test(text)) return 'neck';
  if (/肩|shoulder/.test(text)) return 'shoulder';
  if (/胸|chest|bust|前片/.test(text)) return 'chest';
  if (/腰|waist/.test(text)) return 'waist';
  if (/臀|hip|胯/.test(text)) return 'hip';
  if (/摆|hem|底边|下摆/.test(text)) return 'hem';
  if (/侧|side|边/.test(text)) return 'side';
  if (/背|后|back/.test(text)) return 'back';
  return null; // 无法推断
}

function validateAndFix(data) {
  // 修复 designName — 如果它看起来像一句话（太长或包含非设计名词汇），截取或替换
  let designName = data.designName || '立裁教程';
  if (designName.length > 30) {
    // 尝试截取到第一个标点或逗号
    const cut = designName.match(/^[^，。,\.\!！？\?]+/);
    designName = cut ? cut[0].substring(0, 20) : designName.substring(0, 20);
  }
  // 如果包含明显的对话词汇（Claude 说了一句话而不是设计名），替换掉
  if (/我注意|我看到|你发送|你上传|这是一|这张图|I see|I notice|you sent|you upload/i.test(designName)) {
    designName = '立裁设计教程';
  }

  // 修复 materials — 如果空的，使用默认值
  let materials = Array.isArray(data.materials) && data.materials.length > 0
    ? data.materials.map(m => ({ item: m.item || '未知材料', spec: m.spec || '', qty: m.qty || '适量' }))
    : DEFAULT_MATERIALS;

  // 修复 tools — 如果空的，使用默认值
  let tools = Array.isArray(data.tools) && data.tools.length > 0
    ? data.tools.map(t => ({ name: t.name || '未知工具', purpose: t.purpose || '' }))
    : DEFAULT_TOOLS;

  // 修复 steps
  let steps = Array.isArray(data.steps) ? data.steps.map(s => {
    let icon = s.icon || 'pin';
    let area = s.area || 'full';

    // 验证 icon 是否合法
    if (!VALID_ICONS.includes(icon)) icon = 'pin';
    // 验证 area 是否合法
    if (!VALID_AREAS.includes(area)) area = 'full';

    return {
      title: s.title || '操作步骤',
      desc: s.desc || '',
      technique: s.technique || '',
      icon,
      area,
      tips: s.tips || '',
      troubles: Array.isArray(s.troubles) ? s.troubles.map(t => ({
        q: t.q || '', a: t.a || ''
      })) : []
    };
  }) : [];

  // 检查 icon 多样性 — 如果全部相同，根据步骤内容智能推断
  const uniqueIcons = new Set(steps.map(s => s.icon));
  if (uniqueIcons.size <= 1 && steps.length > 3) {
    console.log('All icons identical, applying smart inference...');
    // 用一个循环后备列表来确保多样性
    const fallbackIcons = ['drape','pin','scissors','pencil','hand','fold','pleat','dart','gather','measure','baste','trim','iron','wrap','tuck','ruler'];
    steps.forEach((s, i) => {
      const inferred = inferIcon(s);
      if (inferred) {
        s.icon = inferred;
      } else {
        s.icon = fallbackIcons[i % fallbackIcons.length];
      }
    });
  }

  // 检查 area 多样性 — 如果全部是 full，根据步骤内容智能推断
  const uniqueAreas = new Set(steps.map(s => s.area));
  if (uniqueAreas.size <= 1 && steps.length > 3) {
    console.log('All areas identical, applying smart inference...');
    const fallbackAreas = ['full','chest','waist','shoulder','hip','hem','side','back','neck'];
    steps.forEach((s, i) => {
      const inferred = inferArea(s);
      if (inferred) {
        s.area = inferred;
      } else {
        s.area = fallbackAreas[i % fallbackAreas.length];
      }
    });
  }

  return {
    designName,
    designAnalysis: data.designAnalysis || '',
    difficulty: (function() { const n = Number(data.difficulty); return (Number.isFinite(n) && n >= 1 && n <= 5) ? Math.round(n) : 3; })(),
    difficultyReason: data.difficultyReason || '',
    estimatedTime: data.estimatedTime || '未知',
    materials,
    tools,
    steps,
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

    const PROMPT = `分析此服装设计图，生成立裁教程JSON。直接从designName的值开始续写，因为JSON已经以 {"designName":" 开头了。

designName：给这个设计取一个简短的中文名称（2-6个字），例如"A字连衣裙"、"不对称半裙"。不要写完整的句子，只要名称。

必须填写的字段：
- materials：至少3种（布料、辅料等），格式 {"item":"名称","spec":"规格","qty":"用量"}
- tools：至少3种，格式 {"name":"工具名","purpose":"用途"}
- steps：8-15步，每步格式 {"title":"标题","desc":"详细说明3-4句","technique":"技法","icon":"操作类型","area":"身体区域","tips":"贴士","troubles":[{"q":"问题","a":"解法"}]}

icon必须从以下选择（至少用5种不同的）：pin(珠针固定)/scissors(裁剪)/pencil(标记)/ruler(测量)/hand(整理)/fold(折叠)/iron(熨烫)/measure(量取)/drape(披挂)/wrap(裹缠)/pleat(打褶)/gather(收褶)/tuck(折裥)/dart(省道)/trim(修边)/baste(假缝)

area必须从以下选择（根据实际操作区域选，不要全部用full）：neck/shoulder/chest/waist/hip/hem/side/back/full

用中文。只输出JSON值，不要markdown、不要代码块、不要多余文字。`;

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
    let rawAiText = (apiData.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    // 清洗 rawAiText：处理 Claude 可能添加的 markdown 代码块标记
    rawAiText = rawAiText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
    rawAiText = rawAiText.trimStart();

    // 检测 Claude 是否重复了 prefill（完整重新开始了 JSON），如果是则不拼接 prefill
    let aiText;
    if (/^\s*\{\s*"designName"/.test(rawAiText)) {
      console.log('Claude repeated prefill, using rawAiText directly');
      aiText = rawAiText;
    } else {
      aiText = '{"designName":"' + rawAiText;
    }

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
