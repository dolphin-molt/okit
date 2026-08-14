// Provider brand logos for display next to provider names (Models page cards,
// home dashboard, etc.). Maps provider preset ids to logo assets.
//
// Asset sources:
// - simple-icons (SVG, single-color path): deepseek, openai, minimax, qwen,
//   xiaomi, openrouter, github, baidu, xai
// - official favicons (PNG, multi-color): zhipu, moonshot, volcengine, tencent,
//   siliconflow, mistral
// - reused from assets/agents: anthropic→claude
//
// Providers without a logo here render with no icon (the caller falls back to a
// text-only title). Add new entries as assets become available.

import claude from '../agents/claude.png';
import opencode from '../agents/opencode.svg';

import deepseek from './deepseek.svg';
import openai from './openai.svg';
import minimax from './minimax.svg';
import qwen from './qwen.svg';
import xiaomi from './xiaomi.svg';
import openrouter from './openrouter.svg';
import github from './github.svg';
import baidu from './baidu.svg';
import baiduCloud from './baidu-cloud.png';
import xai from './xai.svg';

import zhipu from './zhipu.png';
import moonshot from './moonshot.png';
import volcengine from './volcengine.png';
import tencent from './tencent.png';
import siliconflow from './siliconflow.png';
import mistral from './mistral.png';
import ollama from './ollama.svg';
import litellm from './litellm.png';
import stepfun from './stepfun.png';
import bailian from './bailian.svg';

const PROVIDER_ICON: Record<string, string> = {
  // Anthropic — reuse Claude logo
  'anthropic': claude,
  'anthropic-agent': claude,
  // OpenAI
  'openai': openai,
  'openai-codex': openai,
  // DeepSeek
  'deepseek': deepseek,
  // 智谱 GLM / Z.AI (zhipu favicon covers all GLM-family presets)
  'zai': zhipu,
  'zai-global': zhipu,
  'glm-coding': zhipu,
  'zai-global-coding': zhipu,
  // Kimi / Moonshot
  'moonshot': moonshot,
  'moonshot-coding-plan': moonshot,
  'kimi-coding': moonshot,
  'kimi-coding-plan': moonshot,
  // 火山引擎 (豆包/Ark)
  'volcengine': volcengine,
  'volcengine-coding': volcengine,
  'volcengine-agent': volcengine,
  // MiniMax
  'minimax': minimax,
  'minimax-coding': minimax,
  'minimax-global': minimax,
  'minimax-global-coding': minimax,
  // 百度千帆（百度智能云产品图标）
  'qianfan': baiduCloud,
  'qianfan-coding': baiduCloud,
  // 腾讯云
  'tencent': tencent,
  'tencent-token-plan': tencent,
  // 阿里云百炼（通义千问）— 百炼平台图标
  'qwen': bailian,
  'qwen-coding': bailian,
  'qwen-token-plan': bailian,
  // 硅基流动
  'siliconflow': siliconflow,
  // xAI (Grok)
  'xai': xai,
  'xai-grok-build': xai,
  // Mistral
  'mistral': mistral,
  // 小米 MiMo
  'xiaomi': xiaomi,
  'xiaomi-coding': xiaomi,
  // GitHub Copilot
  'github-copilot': github,
  // OpenRouter
  'openrouter': openrouter,
  // OpenCode Go — reuse OpenCode logo
  'opencode-go': opencode,
  // Ollama (local models)
  'ollama': ollama,
  // LiteLLM (local proxy)
  'litellm': litellm,
  // 阶跃星辰 StepFun (国内 + 国际站共用 logo)
  'stepfun': stepfun,
  'stepfun-global': stepfun,
};

export function getProviderIcon(providerId: string): string {
  return PROVIDER_ICON[providerId] || '';
}
