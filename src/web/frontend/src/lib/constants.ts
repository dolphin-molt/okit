export const CATEGORY_COLORS: Record<string, { bg: string; shadow: string }> = {
  language: { bg: '#fef9ef', shadow: '#b45309' },
  runtime: { bg: '#f0fdf4', shadow: '#15803d' },
  cloud: { bg: '#eff6ff', shadow: '#1d4ed8' },
  database: { bg: '#fdf4ff', shadow: '#7e22ce' },
  devops: { bg: '#fff7ed', shadow: '#c2410c' },
  security: { bg: '#f0fdfa', shadow: '#0f766e' },
  ai: { bg: '#fdf2f8', shadow: '#be185d' },
  productivity: { bg: '#f0f9ff', shadow: '#0284c7' },
  networking: { bg: '#fefce8', shadow: '#a16207' },
  testing: { bg: '#f5f3ff', shadow: '#6d28d9' },
  system: { bg: '#f9fafb', shadow: '#4b5563' },
  media: { bg: '#fff1f2', shadow: '#e11d48' },
};

export const VAULT_COLORS = [
  { bg: '#fef9ef', shadow: '#b45309' },
  { bg: '#f0fdf4', shadow: '#15803d' },
  { bg: '#eff6ff', shadow: '#1d4ed8' },
  { bg: '#fdf4ff', shadow: '#7e22ce' },
  { bg: '#fff7ed', shadow: '#c2410c' },
  { bg: '#f0fdfa', shadow: '#0f766e' },
];

export const PROVIDER_PRESETS: Record<string, {
  name: string;
  baseUrl: string;
  apiKeyVaultKey: string;
  models: string[];
}> = {
  siliconflow: { name: 'SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1', apiKeyVaultKey: 'SILICONFLOW_API_KEY', models: ['deepseek-ai/DeepSeek-V3', 'deepseek-ai/DeepSeek-R1', 'Pro/deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct', 'Qwen/Qwen2.5-Coder-32B-Instruct', 'meta-llama/Meta-Llama-3.1-405B-Instruct'] },
  openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', apiKeyVaultKey: 'OPENAI_API_KEY', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o1-mini', 'o3-mini'] },
  anthropic: { name: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1', apiKeyVaultKey: 'ANTHROPIC_API_KEY', models: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-haiku-4-5-20251001'] },
  google: { name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', apiKeyVaultKey: 'GEMINI_API_KEY', models: ['gemini-2.5-pro-preview-05-06', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'] },
  deepseek: { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', apiKeyVaultKey: 'DEEPSEEK_API_KEY', models: ['deepseek-chat', 'deepseek-reasoner'] },
  groq: { name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', apiKeyVaultKey: 'GROQ_API_KEY', models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'] },
  openrouter: { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', apiKeyVaultKey: 'OPENROUTER_API_KEY', models: ['anthropic/claude-sonnet-4-20250514', 'openai/gpt-4o', 'google/gemini-2.5-pro-preview', 'deepseek/deepseek-chat', 'meta-llama/llama-3.3-70b-instruct'] },
  together: { name: 'Together AI', baseUrl: 'https://api.together.xyz/v1', apiKeyVaultKey: 'TOGETHER_API_KEY', models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'deepseek-ai/DEEPSEEK_R1', 'Qwen/Qwen2.5-72B-Instruct'] },
  xai: { name: 'xAI (Grok)', baseUrl: 'https://api.x.ai/v1', apiKeyVaultKey: 'XAI_API_KEY', models: ['grok-3', 'grok-3-mini', 'grok-2'] },
  zai: { name: 'Z.AI', baseUrl: 'https://api.z.ai/api/v1', apiKeyVaultKey: 'ZAI_API_KEY', models: ['glm-4.1', 'glm-4.1v', 'glm-4.1v-plus'] },
  opencode: { name: 'OpenCode Zen', baseUrl: 'https://opencode.ai/zen/v1', apiKeyVaultKey: 'OPENCODE_API_KEY', models: ['claude-sonnet-4-20250514', 'gpt-4o'] },
  minimax: { name: 'MiniMax', baseUrl: 'https://api.minimax.chat/v1', apiKeyVaultKey: 'MINIMAX_API_KEY', models: ['MiniMax-M2.1', 'MiniMax-Text-01'] },
  moonshot: { name: 'Moonshot (Kimi)', baseUrl: 'https://api.moonshot.ai/v1', apiKeyVaultKey: 'MOONSHOT_API_KEY', models: ['moonshot-v1-auto', 'moonshot-v1-8k', 'moonshot-v1-32k'] },
  qwen: { name: 'Qwen (通义)', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKeyVaultKey: 'DASHSCOPE_API_KEY', models: ['qwen-coder-plus-latest', 'qwen-max-latest', 'qwen-plus-latest', 'qwq-plus'] },
  xiaomi: { name: '小米 MiMo', baseUrl: 'https://api.xiaomimimo.com/v1', apiKeyVaultKey: 'XIAOMI_API_KEY', models: ['mimo-v2-flash'] },
  volcengine: { name: '火山引擎', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', apiKeyVaultKey: 'VOLCENGINE_API_KEY', models: ['doubao-1.5-pro-256k', 'doubao-1.5-pro-32k'] },
  qianfan: { name: '百度千帆', baseUrl: 'https://qianfan.baidubce.com/v2', apiKeyVaultKey: 'QIANFAN_API_KEY', models: ['deepseek-v3', 'ernie-4.0-8k', 'ernie-4.5-8k-preview'] },
  zhipu: { name: '智谱 AI', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', apiKeyVaultKey: 'ZHIPU_API_KEY', models: ['glm-4-plus', 'glm-4-flash', 'glm-4-long', 'glm-4v-plus'] },
  nvidia: { name: 'NVIDIA', baseUrl: 'https://integrate.api.nvidia.com/v1', apiKeyVaultKey: 'NVIDIA_API_KEY', models: ['meta/llama-3.1-405b-instruct', 'nvidia/llama-3.1-nemotron-70b-instruct'] },
  venice: { name: 'Venice AI', baseUrl: 'https://api.venice.ai/api/v1', apiKeyVaultKey: 'VENICE_API_KEY', models: ['llama-3.3-70b', 'mixtral-8x7b-32768'] },
  huggingface: { name: 'Hugging Face', baseUrl: 'https://api-inference.huggingface.co/v1', apiKeyVaultKey: 'HUGGINGFACE_API_KEY', models: ['meta-llama/Llama-3.3-70B-Instruct', 'Qwen/Qwen2.5-72B-Instruct'] },
  cerebras: { name: 'Cerebras', baseUrl: 'https://api.cerebras.ai/v1', apiKeyVaultKey: 'CEREBRAS_API_KEY', models: ['llama-3.3-70b', 'llama-3.1-8b'] },
  mistral: { name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', apiKeyVaultKey: 'MISTRAL_API_KEY', models: ['mistral-large-latest', 'mistral-medium-latest', 'codestral-latest'] },
  cohere: { name: 'Cohere', baseUrl: 'https://api.cohere.com/v2', apiKeyVaultKey: 'COHERE_API_KEY', models: ['command-r-plus', 'command-r'] },
  chutes: { name: 'Chutes', baseUrl: 'https://api.chutes.ai/v1', apiKeyVaultKey: 'CHUTES_API_KEY', models: ['claude-sonnet-4-20250514'] },
  synthetic: { name: 'Synthetic', baseUrl: 'https://api.synthetic.new/v1', apiKeyVaultKey: 'SYNTHETIC_API_KEY', models: ['MiniMax-M2.1', 'deepseek-chat'] },
  litellm: { name: 'LiteLLM', baseUrl: 'http://localhost:4000', apiKeyVaultKey: 'LITELLM_API_KEY', models: [] },
  ollama: { name: 'Ollama (本地)', baseUrl: 'http://127.0.0.1:11434/v1', apiKeyVaultKey: '', models: ['llama3', 'qwen2', 'deepseek-r1'] },
  vllm: { name: 'vLLM (本地)', baseUrl: 'http://127.0.0.1:8000/v1', apiKeyVaultKey: '', models: [] },
  custom: { name: '自定义', baseUrl: '', apiKeyVaultKey: '', models: [] },
};

export const PLATFORM_FIELDS: Record<string, string[]> = {
  cloudflare: ['apiToken', 'storeId'],
  'cloudflare-d1': ['apiToken'],
  'cloudflare-r2': ['accountId', 'r2AccessKeyId', 'r2SecretAccessKey'],
  volcengine: ['accessKey', 'secretKey'],
  supabase: ['projectId', 'apiKey'],
  'cloudflare-kv': ['apiToken'],
};

export const PLATFORM_IDS: Record<string, string> = {
  cloudflare: 'Cloudflare Secrets Store',
  'cloudflare-d1': 'Cloudflare D1',
  'cloudflare-r2': 'Cloudflare R2',
  volcengine: '火山引擎 KMS',
  supabase: 'Supabase',
  'cloudflare-kv': 'Cloudflare KV',
};

export const PLATFORM_DOCS: Record<string, { fields: Record<string, { label: string; hint: string }>; steps: { text: string; links?: Record<string, string> }[]; code?: { title: string; sql: string } }> = {
  cloudflare: {
    fields: {
      apiToken: { label: 'API Token', hint: '需要 Secrets Store 读写权限' },
      storeId: { label: 'Store ID', hint: '在 Secrets Store 页面创建 Store 后获取' },
    },
    steps: [
      { text: '登录 Cloudflare Dashboard → Storage & databases → Secrets Store', links: { 'Cloudflare Dashboard': 'https://dash.cloudflare.com' } },
      { text: '点击 "Create store" 创建一个 Store' },
      { text: '复制 Store ID 到配置中' },
      { text: '前往 Dashboard → Manage account → Account API Tokens，创建 Token 并勾选 Secrets Store 的编辑权限' },
    ],
  },
  'cloudflare-d1': {
    fields: {
      apiToken: { label: 'API Token', hint: '需要 D1 编辑权限，数据库和表会自动创建' },
    },
    steps: [
      { text: '前往 Dashboard → Manage account → Account API Tokens，创建 Token 并勾选 D1 的编辑权限', links: { 'Dashboard': 'https://dash.cloudflare.com' } },
      { text: '将 Token 填入配置中，测试连接后会自动创建 okit-sync 数据库' },
    ],
  },
  'cloudflare-r2': {
    fields: {
      accountId: { label: 'Account ID', hint: '在 R2 概述页面右侧 "S3 API" 处可看到' },
      r2AccessKeyId: { label: 'R2 Access Key ID', hint: '必须从 R2 专用页面创建 S3 Token 才会获得' },
      r2SecretAccessKey: { label: 'R2 Secret Access Key', hint: '创建 Token 后确认页面一次性显示，关闭后无法再查看' },
    },
    steps: [
      { text: '⚠️ 重要：打开 R2 API Tokens 页面 创建 Token，不要从通用的 Account API Tokens 页面创建！通用的 Token 不会产生 S3 凭据', links: { '打开 R2 API Tokens 页面': 'https://dash.cloudflare.com/?to=/:account/r2/api-tokens' } },
      { text: '在 R2 概述页面右侧可看到 Account ID，复制后填入下方字段', links: { 'R2 概述页面': 'https://dash.cloudflare.com/?to=/:account/r2' } },
      { text: '点击 "Create API token" 按钮（注意：必须是 R2 页面里的这个按钮）' },
      { text: '权限选择 "Object Read & Write"，指定 Bucket 或选 "Apply to all"，然后点击 Create' },
      { text: '✅ 创建成功后的确认页面会同时显示 Access Key ID 和 Secret Access Key，立刻复制保存（Secret 关闭页面后无法再查看！）' },
    ],
  },
  volcengine: {
    fields: {
      accessKey: { label: 'AccessKey', hint: '在访问控制中创建' },
      secretKey: { label: 'SecretKey', hint: '创建时一次性显示' },
    },
    steps: [
      { text: '先开通密钥管理服务：搜索 "密钥管理系统" 或访问产品页，点击 "立即开通"', links: { '密钥管理系统': 'https://console.volcengine.com/kms' } },
      { text: '前往 火山引擎控制台 → 右上角头像 → 密钥管理，创建 IAM 子用户的 AccessKey', links: { '密钥管理': 'https://console.volcengine.com/iam/keymanage/' } },
      { text: '在访问控制 → 策略中搜索并授权 KMSFullAccess 策略（只读同步选 KMSReadOnly）' },
      { text: '创建密钥后复制 AccessKey 和 SecretKey' },
    ],
  },
  supabase: {
    fields: {
      projectId: { label: '项目 ID', hint: '浏览器地址栏 /project/ 后面的那段字符' },
      apiKey: { label: 'Secret Key', hint: 'Settings → API 中的 secret_key' },
    },
    steps: [
      { text: '前往 Supabase 控制台创建一个免费项目', links: { 'Supabase': 'https://supabase.com/dashboard' } },
      { text: '从浏览器地址栏复制项目 ID：dashboard/project/xxxxx 中的 xxxxx' },
      { text: '进入 Settings → API，复制 secret_key 填入 Secret Key 字段' },
      { text: '进入 SQL Editor，执行下方的建表 SQL（点击复制按钮）' },
    ],
    code: {
      title: '建表 SQL（在 SQL Editor 中执行）',
      sql: `CREATE TABLE okit_sync (\n  id BIGSERIAL PRIMARY KEY,\n  key TEXT UNIQUE,\n  value JSONB,\n  updated_at TIMESTAMPTZ DEFAULT now()\n);\n\nALTER TABLE okit_sync ENABLE ROW LEVEL SECURITY;\nCREATE POLICY "Allow service_role" ON okit_sync FOR ALL USING (true) WITH CHECK (true);`,
    },
  },
  'cloudflare-kv': {
    fields: {
      apiToken: { label: 'API Token', hint: '需要 Workers KV Storage 编辑权限' },
    },
    steps: [
      { text: '前往 API Tokens 页面 → Manage account → Account API Tokens，点击 "Create Token"', links: { 'API Tokens 页面': 'https://dash.cloudflare.com/profile/api-tokens' } },
      { text: '创建 Token，权限选择 Account → Workers KV Storage → Edit' },
      { text: '将 Token 填入配置中，测试连接后会自动创建 okit-sync 命名空间' },
    ],
  },
};
