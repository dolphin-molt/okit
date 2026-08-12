// Official documentation URLs for each provider preset.
// Surfaced in the Models page edit modal as a "接入文档" link so users can
// reach the provider's own setup guide (base_url, auth, model list, Codex/Claude
// integration steps) without leaving OKIT.
//
// Keys are provider preset ids. Add entries here as providers are onboarded.

export const PROVIDER_DOCS: Record<string, string> = {
  // 国际官方
  'anthropic': 'https://docs.anthropic.com/en/api/getting-started',
  'anthropic-agent': 'https://docs.anthropic.com/en/docs/claude-code',
  'openai': 'https://platform.openai.com/docs/models',
  'openai-codex': 'https://learn.chatgpt.com/docs/codex',
  'google': 'https://ai.google.dev/gemini-api/docs',
  'google-agent': 'https://ai.google.dev/gemini-api/docs/cli',
  'xai': 'https://docs.x.ai/',
  'xai-grok-build': 'https://docs.x.ai/',
  'github-copilot': 'https://docs.github.com/copilot',
  'mistral': 'https://docs.mistral.ai/',

  // 国内厂商
  'zai': 'https://open.bigmodel.cn/dev/api',
  'zai-global': 'https://docs.z.ai/guides/overview',
  'glm-coding': 'https://open.bigmodel.cn/dev/api/coding',
  'zai-global-coding': 'https://docs.z.ai/guides/coding-plan',
  'minimax': 'https://platform.minimaxi.com/document',
  'minimax-global': 'https://platform.minimaxi.com/document',
  'minimax-coding': 'https://platform.minimaxi.com/document/coding-plan',
  'minimax-global-coding': 'https://platform.minimaxi.com/document/coding-plan',
  'moonshot': 'https://platform.moonshot.cn/docs',
  'moonshot-coding-plan': 'https://platform.moonshot.cn/docs/guide/coding-plan',
  'kimi-coding': 'https://platform.moonshot.cn/docs',
  'kimi-coding-plan': 'https://platform.moonshot.cn/docs/guide/coding-plan',
  'deepseek': 'https://api-docs.deepseek.com/',
  'qwen': 'https://help.aliyun.com/zh/dashscope/',
  'qwen-coding': 'https://help.aliyun.com/zh/model-studio/coding-plan',
  'qianfan': 'https://cloud.baidu.com/doc/QIANFAN/',
  'qianfan-coding': 'https://cloud.baidu.com/doc/QIANFAN/s/Um5c8hmoc',
  'tencent': 'https://cloud.tencent.com/document/product/1772',
  'volcengine': 'https://www.volcengine.com/docs/82379',
  'volcengine-coding': 'https://www.volcengine.com/docs/82379/1399900',
  'volcengine-agent': 'https://www.volcengine.com/docs/82379',
  'siliconflow': 'https://docs.siliconflow.cn/',
  'stepfun': 'https://platform.stepfun.com/docs',
  'stepfun-global': 'https://platform.stepfun.ai/docs/en/',
  'xiaomi': 'https://mimo.mi.com/docs/',
  'xiaomi-coding': 'https://mimo.mi.com/docs/zh-CN/tokenplan/integration/codex-configuration',

  // 聚合 / 本地
  'openrouter': 'https://openrouter.ai/docs',
  'opencode-go': 'https://opencode.ai/docs/',
  'ollama': 'https://github.com/ollama/ollama',
  'litellm': 'https://docs.litellm.ai/',
};

export function getProviderDocsUrl(providerId: string): string | null {
  return PROVIDER_DOCS[providerId] || null;
}
