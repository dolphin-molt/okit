// Provider brand logos for display next to provider names (Models page cards,
// home dashboard, etc.). Maps provider preset ids to logo assets.
//
// All logos are 128x128 PNG for uniform sizing. Asset sources:
// - Logo.dev (official logos, https://logo.dev): openai, deepseek, zhipu,
//   moonshot, kimi, volcengine, minimax(+global), tencent, bailian,
//   siliconflow, xai, mistral, xiaomi, github, openrouter, ollama, litellm,
//   stepfun — plus agent icons in assets/agents
// - local keepers (not on Logo.dev or wrong company there): baidu-cloud
//   (百度智能云/千帆 product icon; cloud.baidu.com only returns the Baidu paw)
// - reused from assets/agents: anthropic→claude, opencode-go→opencode

import claude from '../agents/claude.png';
import opencode from '../agents/opencode.png';

import deepseek from './deepseek.png';
import openai from './openai.png';
import minimax from './minimax.png';
import minimaxGlobal from './minimax-global.png';
import kimi from './kimi.png';
import xiaomi from './xiaomi.png';
import openrouter from './openrouter.png';
import github from './github.png';
import baiduCloud from './baidu-cloud.png';
import xai from './xai.png';

import zhipu from './zhipu.png';
import moonshot from './moonshot.png';
import volcengine from './volcengine.png';
import tencent from './tencent.png';
import siliconflow from './siliconflow.png';
import mistral from './mistral.png';
import ollama from './ollama.png';
import litellm from './litellm.png';
import stepfun from './stepfun.png';
import bailian from './bailian.png';

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
  // Kimi / Moonshot — Kimi presets use the Kimi "K" mark, Moonshot presets use the company crescent
  'moonshot': moonshot,
  'moonshot-coding-plan': moonshot,
  'kimi-coding': kimi,
  'kimi-coding-plan': kimi,
  // 火山引擎 (豆包/Ark)
  'volcengine': volcengine,
  'volcengine-coding': volcengine,
  'volcengine-agent': volcengine,
  // MiniMax — 国内站 minimaxi.com / 国际站 minimax.io 各用官方 logo
  'minimax': minimax,
  'minimax-coding': minimax,
  'minimax-global': minimaxGlobal,
  'minimax-global-coding': minimaxGlobal,
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

// Transparent monochrome logos that vanish on dark cards (openai/github are
// pure black artwork, moonshot is navy after recolor); CSS inverts them in
// dark mode (see .brand-icon-invert-dark in components.css).
const DARK_INVERT_PROVIDERS = new Set([
  'openai', 'openai-codex', 'github-copilot', 'moonshot', 'moonshot-coding-plan',
]);

export function getProviderIconClass(providerId: string): string {
  return DARK_INVERT_PROVIDERS.has(providerId) ? 'brand-icon-invert-dark' : '';
}
