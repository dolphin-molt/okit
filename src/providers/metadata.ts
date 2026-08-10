// Provider metadata: groups, families, and migration constants.
//
// This is the single source of truth for provider *relationships* (grouping,
// family merging) and *data migrations* (retired IDs, URL corrections).
// It complements presets.ts (which defines the providers themselves).
//
// The codegen script (scripts/gen-presets.js) reads this file (after tsc
// compilation) and emits a JSON consumed by the frontend, so the frontend
// no longer needs its own copy of these definitions.

// ── Retired presets ──────────────────────────────────────────
// These used to be bundled presets. Retire them on load so existing OKIT
// installations match the current UI.
export const RETIRED_PRESET_PROVIDER_IDS = new Set([
  "groq",
  "fireworks",
  "together",
]);

// ── URL migrations ───────────────────────────────────────────
// Apply only these exact built-in endpoint corrections. User-customized URLs
// are intentionally left untouched when presets are refreshed.
export const PRESET_BASE_URL_MIGRATIONS = new Map<string, { from: string; to: string }>([
  ["kimi-coding", { from: "https://api.kimi.com", to: "https://api.moonshot.cn/v1" }],
  ["qianfan-coding", { from: "https://qianfan.baidubce.com/v2/coding", to: "https://qianfan.baidubce.com/v2/tokenplan/personal" }],
  ["xiaomi-coding", { from: "https://token-plan-cn.xiaomimimo.com/v1", to: "https://token-plan-sgp.xiaomimimo.com/v1" }],
]);

export const PRESET_ENDPOINT_BASE_URL_MIGRATIONS = new Map<string, { from: string; to: string }>([
  ["kimi-coding-plan", { from: "https://api.kimi.com/coding/", to: "https://api.kimi.com/coding" }],
  ["xiaomi-coding", { from: "https://token-plan-cn.xiaomimimo.com/anthropic", to: "https://token-plan-sgp.xiaomimimo.com/anthropic" }],
]);

// ── Provider groups (left-nav in models page) ────────────────
export const PROVIDER_GROUPS: { key: string; labelKey: string; ids: string[] }[] = [
  { key: "official", labelKey: "models.groupOfficial", ids: ["anthropic", "openai", "openai-codex", "google", "xai", "mistral"] },
  { key: "aggregator", labelKey: "models.groupAggregator", ids: ["openrouter"] },
  { key: "china", labelKey: "models.groupChina", ids: [
    // 智谱
    "zai", "zai-global", "glm-coding",
    // MiniMax
    "minimax", "minimax-global", "minimax-coding",
    // Kimi / Moonshot
    "moonshot", "kimi-coding", "kimi-coding-plan",
    // 火山引擎
    "volcengine", "volcengine-coding",
    // 百度千帆
    "qianfan", "qianfan-coding",
    // 通义千问
    "qwen",
    // DeepSeek
    "deepseek",
    // 阶跃星辰
    "stepfun",
    // 小米
    "xiaomi", "xiaomi-coding",
    // 腾讯云
    "tencent-coding",
  ] },
  { key: "local", labelKey: "models.groupLocal", ids: ["ollama", "litellm"] },
];

// ── Provider families (merge same-site variants into one card) ─
// 国内站和国际站是不同站点、不同 key,不合并。
// 只有同一站点内的不同套餐(API 平台 / Coding Plan / Token Plan)才合并。
export type VariantOption = { label: string; providerId: string };
export type ProviderFamily = {
  family: string;
  plans?: VariantOption[];
  ids: string[];
};

export const PROVIDER_FAMILIES: ProviderFamily[] = [
  {
    family: "OpenAI",
    plans: [
      { label: "API Key", providerId: "openai" },
      { label: "OAuth", providerId: "openai-codex" },
    ],
    ids: ["openai", "openai-codex"],
  },
  {
    family: "智谱AI（国内）",
    plans: [
      { label: "API 平台", providerId: "zai" },
      { label: "Coding Plan", providerId: "glm-coding" },
    ],
    ids: ["zai", "glm-coding"],
  },
  {
    family: "MiniMax（国内）",
    plans: [
      { label: "API 平台", providerId: "minimax" },
      { label: "Token Plan", providerId: "minimax-coding" },
    ],
    ids: ["minimax", "minimax-coding"],
  },
  {
    family: "Kimi（国内）",
    plans: [
      { label: "API 平台", providerId: "kimi-coding" },
      { label: "Coding Plan", providerId: "kimi-coding-plan" },
    ],
    ids: ["kimi-coding", "kimi-coding-plan"],
  },
  {
    family: "火山引擎",
    plans: [
      { label: "API 平台", providerId: "volcengine" },
      { label: "Coding Plan", providerId: "volcengine-coding" },
    ],
    ids: ["volcengine", "volcengine-coding"],
  },
  {
    family: "百度千帆",
    plans: [
      { label: "API 平台", providerId: "qianfan" },
      { label: "Coding Plan", providerId: "qianfan-coding" },
    ],
    ids: ["qianfan", "qianfan-coding"],
  },
  {
    family: "小米 MiMo",
    plans: [
      { label: "API 平台", providerId: "xiaomi" },
      { label: "Token Plan", providerId: "xiaomi-coding" },
    ],
    ids: ["xiaomi", "xiaomi-coding"],
  },
];
