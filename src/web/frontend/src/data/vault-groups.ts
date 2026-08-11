// Predefined vault key groups, ordered by importance for AI model providers.
// Used by the vault "add key" form's group selector and by the group migration.
//
// Naming convention: "{平台名}" or "{平台名} · {地域}".
// 国内/国际 key 不通用的平台才加地域后缀;只有一个地域的不加。
// Coding Plan 和开放平台的 key 放同一组(不区分),只区分地域。

export const PREDEFINED_GROUPS: string[] = [
  // ── 国际大厂 ──
  'OpenAI',
  'Anthropic',
  'Google Gemini',
  'xAI',
  'Mistral',
  // ── 国内/国际分站 ──
  '智谱AI · 国内',
  '智谱AI · 国际',
  'MiniMax · 国内',
  'MiniMax · 国际',
  'Kimi · 国内',
  'Kimi · 国际',
  // ── 仅国内 ──
  'DeepSeek',
  '阿里云百炼',
  '百度千帆',
  '火山引擎',
  '腾讯云',
  '阶跃星辰',
  '小米 MiMo',
  // ── 聚合/代理 ──
  'OpenRouter',
  '硅基流动',
  // ── 基础设施 ──
  'Cloudflare',
];
