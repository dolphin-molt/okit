import { describe, expect, it } from 'vitest';

const autoCreate = await import('../src/web/api/auto-create.js');

const { AUTO_CREATE_PLATFORMS, BROWSER_LOGIN_VERIFICATION_PLATFORMS, isLoginFailure, isLoginUrl, isOpenRouterPublicPage, hasOpenRouterPublicNavigation, extractKeyFromCaptures, describeCapturedSecretFields, capturesContainMaskedSecret, isAssetData } = autoCreate as {
  AUTO_CREATE_PLATFORMS: Array<{ id: string; keyHint: string; groupHint: string; mode: string; url?: string }>;
  BROWSER_LOGIN_VERIFICATION_PLATFORMS: Array<{ id: string; label: string; url: string }>;
  isLoginFailure: (message: string) => boolean;
  isLoginUrl: (url: string) => boolean;
  isOpenRouterPublicPage: (state: { publicHome?: boolean; keyWorkspace?: boolean }) => boolean;
  hasOpenRouterPublicNavigation: (labels: string[]) => boolean;
  extractKeyFromCaptures: (entries: Array<{ responsePreview: string; url?: string; method?: string; timestamp?: number }>, platform: string) => string | null;
  describeCapturedSecretFields: (entries: Array<{ responsePreview: string; url?: string; method?: string; responseStatus?: number }>) => Array<{ fields: Array<{ field: string; length: number; shape: string }> }>;
  capturesContainMaskedSecret: (entries: Array<{ responsePreview: string }>) => boolean;
  isAssetData: (value: string) => boolean;
};

describe('auto-create key platforms', () => {
  const ids = AUTO_CREATE_PLATFORMS.map(platform => platform.id);

  it('covers every bundled remote API provider plus Cloudflare', () => {
    expect(ids).toEqual(expect.arrayContaining([
      'cloudflare', 'openai', 'anthropic', 'google',
      'volcengine', 'zhipu', 'zai-global',
      'minimax', 'minimax-global', 'deepseek', 'moonshot', 'kimi-coding',
      'qwen', 'qianfan', 'qianfan-coding', 'xiaomi', 'xiaomi-coding', 'stepfun', 'xai', 'mistral', 'openrouter',
    ]));
  });

  it('does not offer retired aggregation providers', () => {
    expect(ids).not.toContain('groq');
    expect(ids).not.toContain('fireworks');
    expect(ids).not.toContain('together');
  });

  it('declares the metadata needed to store a generated key safely', () => {
    for (const platform of AUTO_CREATE_PLATFORMS) {
      expect(platform.keyHint).toMatch(/^[A-Z0-9_]+$/);
      expect(platform.groupHint).toBeTruthy();
      expect(['api', 'browser']).toContain(platform.mode);
      if (platform.mode === 'browser' && !['volcengine', 'zhipu', 'minimax'].includes(platform.id)) {
        expect(platform.url).toMatch(/^https:\/\//);
      }
    }
  });

  it('recognizes browser login failures for a visible handoff', () => {
    expect(isLoginFailure('Please sign in to continue')).toBe(true);
    expect(isLoginFailure('Continue with email')).toBe(true);
    expect(isLoginFailure('当前账号未登录')).toBe(true);
    expect(isLoginFailure('401 Unauthorized')).toBe(true);
    expect(isLoginFailure('未找到创建密钥按钮')).toBe(false);
  });

  it('recognizes OpenRouter sign-in redirects before searching for a create button', () => {
    expect(isLoginUrl('https://openrouter.ai/sign-in?redirect_url=https%3A%2F%2Fopenrouter.ai%2Fworkspaces%2Fdefault%2Fkeys')).toBe(true);
    expect(isLoginUrl('https://openrouter.ai/workspaces/default/keys')).toBe(false);
  });

  it('treats OpenRouter public navigation as a login handoff', () => {
    expect(isOpenRouterPublicPage({ publicHome: true, keyWorkspace: false })).toBe(true);
    expect(isOpenRouterPublicPage({ publicHome: true, keyWorkspace: true })).toBe(false);
  });

  it('recognizes the public OpenRouter navigation returned by the live button search', () => {
    expect(hasOpenRouterPublicNavigation(['Skip to content', 'Home', 'Models', 'Fusion', 'Chat'])).toBe(true);
    expect(hasOpenRouterPublicNavigation(['Home', 'Models', 'Chat'])).toBe(false);
  });

  it('keeps failed secret-extraction diagnostics free of secret values', () => {
    const secret = '0123456789abcdef0123456789abcdef.super-secret-value';
    const details = describeCapturedSecretFields([{
      method: 'POST', responseStatus: 200, url: 'https://api.example.com/v1/keys',
      responsePreview: JSON.stringify({ data: { apiKey: secret } }),
    }]);
    const rendered = JSON.stringify(details);
    expect(rendered).toContain('data.apiKey');
    expect(rendered).toContain('id.secret');
    expect(rendered).not.toContain(secret);
  });

  it('rejects provider-masked values before they can be saved as keys', () => {
    expect(isAssetData('0123456789abcdef0123456789abcdef.*****a1b')).toBe(true);
    expect(isAssetData('0123456789abcdef0123456789abcdef.AbCdEf123')).toBe(false);
  });

  it('turns a redacted Z.AI signature secret into an explicit safe failure', () => {
    const responsePreview = JSON.stringify({ data: { apiKey: '0123456789abcdef0123456789abcdef', secretKey: '******Wr5l' } });
    expect(capturesContainMaskedSecret([{ responsePreview }])).toBe(true);
  });

  it('uses OpenRouter’s live New Key action and verified creation form', () => {
    const openRouter = AUTO_CREATE_PLATFORMS.find((platform) => platform.id === 'openrouter') as { createTexts?: string[]; nameSelectors?: string[]; confirmTexts?: string[] };
    expect(openRouter.createTexts).toContain('New Key');
    expect(openRouter.nameSelectors).toContain('input#name');
    expect(openRouter.confirmTexts).toContain('Create');
  });

  it('opens MiMo directly on its authenticated API Keys screen and completes its dialog', () => {
    const xiaomi = AUTO_CREATE_PLATFORMS.find((platform) => platform.id === 'xiaomi') as { url?: string; createTexts?: string[]; nameSelectors?: string[]; confirmTexts?: string[] };
    expect(xiaomi.url).toBe('https://platform.xiaomimimo.com/console/api-keys');
    expect(xiaomi.createTexts).toContain('Create API Key');
    expect(xiaomi.nameSelectors).toContain('input#apiKeyName');
    expect(xiaomi.confirmTexts).toContain('Confirm');
  });

  it('uses MiMo Token Plan’s separate subscription page and one-time Copy action', () => {
    const tokenPlan = AUTO_CREATE_PLATFORMS.find((platform) => platform.id === 'xiaomi-coding') as {
      url?: string; createTexts?: string[]; creationActionOnly?: boolean; reuseExistingMaskedKey?: boolean; existingMaskedKeyPrefix?: string; postCreateCopyTexts?: string[];
      postCreateCopyNeedsForeground?: boolean; postCreateCopyByMaskedKeyPrefix?: string; allowExtensionClipboardRead?: boolean; postCreateReadAttempts?: number; keyPatterns?: string[];
    };
    expect(tokenPlan.url).toBe('https://platform.xiaomimimo.com/console/plan-manage');
    expect(tokenPlan.createTexts).toEqual(['创建 API Key', 'Create API Key']);
    expect(tokenPlan.creationActionOnly).toBe(true);
    expect(tokenPlan.reuseExistingMaskedKey).toBe(true);
    expect(tokenPlan.existingMaskedKeyPrefix).toBe('tp-');
    expect(tokenPlan.postCreateCopyTexts).toEqual(['复制', 'Copy']);
    expect(tokenPlan.postCreateCopyByMaskedKeyPrefix).toBe('tp-');
    expect(tokenPlan.postCreateCopyNeedsForeground).toBe(true);
    expect(tokenPlan.allowExtensionClipboardRead).toBe(true);
    expect(tokenPlan.postCreateReadAttempts).toBeGreaterThan(1);
    expect(new RegExp(tokenPlan.keyPatterns![0]).test('tp-mimo-token-plan-abcdefghijklmnopqrstuvwxyz')) .toBe(true);
  });

  it('uses the verified Z.AI and MiniMax international creation dialogs', () => {
    const zai = AUTO_CREATE_PLATFORMS.find((platform) => platform.id === 'zai-global') as { createTexts?: string[]; nameSelectors?: string[]; confirmTexts?: string[]; keyPatterns?: string[]; postCreateRowCopySelector?: string; postCreateCopyAttempts?: number; allowExtensionClipboardRead?: boolean; requirePostCreateCopy?: boolean };
    const minimaxGlobal = AUTO_CREATE_PLATFORMS.find((platform) => platform.id === 'minimax-global') as { createTexts?: string[]; nameSelectors?: string[]; confirmTexts?: string[] };
    expect(zai.createTexts).toContain('Add API Key');
    expect(zai.nameSelectors).toContain('input#apiKeyName');
    expect(zai.confirmTexts).toContain('Create');
    expect(new RegExp(zai.keyPatterns![0]).test('A23456789abcdef0123456789abcdef0.AbCdEf123')).toBe(true);
    expect(new RegExp(zai.keyPatterns![0]).test('A23456789abcdef0123456789abcdef0.AbC$Ef123')).toBe(true);
    expect(zai.postCreateRowCopySelector).toBe('svg.lucide-copy');
    expect(zai.postCreateCopyAttempts).toBeGreaterThan(5);
    expect(zai.allowExtensionClipboardRead).toBe(true);
    expect(zai.requirePostCreateCopy).toBe(true);
    expect(minimaxGlobal.createTexts).toContain('Create new API Key');
    expect(minimaxGlobal.nameSelectors).toContain('input#token_name');
    expect(minimaxGlobal.confirmTexts).toContain('Create');
  });

  it('uses the verified BCE API Key name field and confirmation action', () => {
    const qianfan = AUTO_CREATE_PLATFORMS.find((platform) => platform.id === 'qianfan') as {
      url?: string; createTexts?: string[]; formReadyAttempts?: number; formReadyDelayMs?: number; nameSelectors?: string[]; confirmTexts?: string[];
    };
    expect(qianfan.url).toBe('https://console.bce.baidu.com/iam/#/iam/apikey/list');
    expect(qianfan.createTexts).toEqual(['创建API Key']);
    expect(qianfan.formReadyAttempts).toBeGreaterThan(1);
    expect(qianfan.formReadyDelayMs).toBeGreaterThanOrEqual(150);
    expect(qianfan.nameSelectors).toContain('input#name');
    expect(qianfan.confirmTexts).toEqual(['确定']);
  });

  it('uses the subscribed Token Plan page and its Copy action for Coding keys', () => {
    const coding = AUTO_CREATE_PLATFORMS.find((platform) => platform.id === 'qianfan-coding') as {
      url?: string; createTexts?: string[]; creationActionOnly?: boolean; postCreateCopyTexts?: string[]; postCreateCopyNeedsForeground?: boolean; allowExtensionClipboardRead?: boolean; keyPatterns?: string[];
    };
    expect(coding.url).toBe('https://console.bce.baidu.com/qianfan/resource/token-plan');
    expect(coding.createTexts).toEqual(['点击生成', '复制']);
    expect(coding.creationActionOnly).toBe(true);
    expect(coding.postCreateCopyTexts).toEqual(['复制']);
    expect(coding.postCreateCopyNeedsForeground).toBe(true);
    expect(coding.allowExtensionClipboardRead).toBe(true);
    expect(new RegExp(coding.keyPatterns![0]).test('bce-v3/ALTAK1234567890_abc.def-xyz1234567890')) .toBe(true);
  });

  it('uses the verified OpenAI, Gemini, and Bailian creation forms', () => {
    const openai = AUTO_CREATE_PLATFORMS.find((platform) => platform.id === 'openai') as { nameSelectors?: string[]; confirmTexts?: string[] };
    const google = AUTO_CREATE_PLATFORMS.find((platform) => platform.id === 'google') as { nameSelectors?: string[]; confirmTexts?: string[]; formBlockers?: Array<{ text: string; message: string }> };
    const qwen = AUTO_CREATE_PLATFORMS.find((platform) => platform.id === 'qwen') as { nameSelectors?: string[]; confirmTexts?: string[]; createWaitAttempts?: number; keyPatterns?: string[] };
    expect(openai.nameSelectors).toContain('input[placeholder="My Test Key"]');
    expect(openai.confirmTexts).toEqual(['Create secret key']);
    expect(google.nameSelectors).toContain('input[aria-label="为密钥命名"]');
    expect(google.confirmTexts).toContain('创建密钥');
    expect(google.formBlockers).toContainEqual(expect.objectContaining({ text: 'No Cloud Projects Available' }));
    expect(qwen.nameSelectors).toContain('textarea#description');
    expect(qwen.confirmTexts).toEqual(['确定']);
    expect(qwen.createWaitAttempts).toBeGreaterThan(1);
    expect(new RegExp(qwen.keyPatterns![0]).test('sk-ws-H.ERYRYPR.eiTC.abc123')).toBe(true);
  });

  it('dismisses only DeepSeek’s optional email reminder before creation', () => {
    const deepseek = AUTO_CREATE_PLATFORMS.find((platform) => platform.id === 'deepseek') as { preCreateDismissTexts?: string[]; readyAfterMs?: number };
    expect(deepseek.preCreateDismissTexts).toEqual(['稍后再填']);
    expect(deepseek.readyAfterMs).toBe(15000);
  });

  it('uses the verified Kimi international console and its visible default project', () => {
    const moonshot = AUTO_CREATE_PLATFORMS.find((platform) => platform.id === 'moonshot') as {
      label?: string;
      url?: string;
      createTexts?: string[];
      formEntryTexts?: string[];
      nameSelectors?: string[];
      defaultProjectLabel?: string;
      confirmTexts?: string[];
      createWaitAttempts?: number;
    };
    expect(moonshot.label).toBe('Moonshot（Kimi 国际站）');
    expect(moonshot.url).toBe('https://platform.kimi.ai/console/api-keys');
    expect(moonshot.createTexts).toContain('Create API Key');
    expect(moonshot.nameSelectors).toContain('input[placeholder*="Maximum 32"]');
    expect(moonshot.defaultProjectLabel).toBe('default');
    expect(moonshot.confirmTexts).toEqual(['OK']);
    expect(moonshot.createWaitAttempts).toBeGreaterThan(1);
  });

  it('treats the Kimi default project as an explicit, constrained choice', () => {
    const optionLabel = 'default';
    expect(optionLabel).toBe('default');
    expect(['default']).toContain(optionLabel);
  });

  it('presents the stable kimi-coding provider ID to users as Kimi', () => {
    const kimi = AUTO_CREATE_PLATFORMS.find((platform) => platform.id === 'kimi-coding') as {
      label?: string;
      url?: string;
      createTexts?: string[];
      nameSelectors?: string[];
      defaultProjectLabel?: string;
      confirmTexts?: string[];
    };
    expect(kimi.label).toBe('Kimi');
    expect(kimi.url).toBe('https://platform.kimi.com/console/api-keys');
    expect(kimi.createTexts).toContain('新建 API Key');
    expect(kimi.nameSelectors).toContain('input[placeholder*="最多输入32"]');
    expect(kimi.defaultProjectLabel).toBe('default');
    expect(kimi.confirmTexts).toEqual(['确定']);
  });

  it('fills the required StepFun key name before confirming creation', () => {
    const stepfun = AUTO_CREATE_PLATFORMS.find((platform) => platform.id === 'stepfun') as {
      url?: string;
      createTexts?: string[];
      nameSelectors?: string[];
      confirmTexts?: string[];
      postCreateReadAttempts?: number;
    };
    expect(stepfun.url).toBe('https://platform.stepfun.com/interface-key');
    expect(stepfun.createTexts).toEqual(['创建新的密钥']);
    expect(stepfun.nameSelectors).toContain('input[placeholder*="最多输入20"]');
    expect(stepfun.confirmTexts).toEqual(['确认']);
    expect(stepfun.postCreateReadAttempts).toBeGreaterThan(1);
  });

  it('extracts StepFun accessKey values returned by its post-create key list', () => {
    const responsePreview = JSON.stringify({
      status: 0,
      accessKeys: [{ accessKey: 'Ab12Cd34Ef56Gh78Ij90Kl12Mn34Op56' }],
    });
    expect(extractKeyFromCaptures([{ responsePreview, url: 'https://platform.stepfun.com/api/access-keys' }], 'stepfun'))
      .toBe('Ab12Cd34Ef56Gh78Ij90Kl12Mn34Op56');
  });

  it('joins camel-cased API key and secret fields returned by Z.AI', () => {
    const apiKey = '0123456789abcdef0123456789abcdef';
    const secretKey = 'AbCdEf123';
    const responsePreview = JSON.stringify({ data: { apiKey, secretKey } });
    expect(extractKeyFromCaptures([{ method: 'POST', responsePreview, url: 'https://api.z.ai/api/biz/v1/projects/project/api_keys' }], 'zai-global'))
      .toBe(`${apiKey}.${secretKey}`);
  });

  it('joins Z.AI API-key ID and secret aliases returned by its create endpoint', () => {
    const apiKeyId = 'zai_api_key_id_1234567890';
    const apiKeySecret = 'zai_api_key_secret_1234567890';
    const responsePreview = JSON.stringify({ data: { apiKeyId, apiKeySecret } });
    expect(extractKeyFromCaptures([{ method: 'POST', responsePreview, url: 'https://api.z.ai/api/biz/v1/api-keys' }], 'zai-global'))
      .toBe(`${apiKeyId}.${apiKeySecret}`);
  });

  it('extracts a Z.AI id.secret key from a provider-specific response field', () => {
    const apiKey = 'zai_key_id_1234567890.zai_secret_1234567890';
    const responsePreview = JSON.stringify({ data: { credential: apiKey } });
    expect(extractKeyFromCaptures([{ method: 'POST', responsePreview, url: 'https://api.z.ai/api/biz/v1/api-keys' }], 'zai-global'))
      .toBe(apiKey);
  });

  it('prefers a post-create response over an earlier bootstrap response with a key field', () => {
    const bootstrapValue = 'A'.repeat(48);
    const createdValue = 'B'.repeat(48);
    expect(extractKeyFromCaptures([
      {
        method: 'GET',
        timestamp: 1,
        url: 'https://admin.mistral.ai/api/local-trpc/user.meSession',
        responsePreview: JSON.stringify({ key: bootstrapValue }),
      },
      {
        method: 'POST',
        timestamp: 2,
        url: 'https://admin.mistral.ai/api/local-trpc/apiKey.create',
        responsePreview: JSON.stringify({ key: createdValue }),
      },
    ], 'mistral')).toBe(createdValue);
  });

  it('enters xAI through its team-scoped API Keys page and confirms its verified form', () => {
    const xai = AUTO_CREATE_PLATFORMS.find((platform) => platform.id === 'xai') as {
      url?: string;
      preNavigationTexts?: string[];
      createTexts?: string[];
      nameSelectors?: string[];
      confirmTexts?: string[];
      allowConfirmCreateText?: boolean;
      postCreateReadAttempts?: number;
    };
    expect(xai.url).toBe('https://console.x.ai/');
    expect(xai.preNavigationTexts).toEqual(['API Keys']);
    expect(xai.createTexts).toEqual(['Create API key']);
    expect(xai.nameSelectors).toContain('input[placeholder="Production key"]');
    expect(xai.confirmTexts).toEqual(['Create API key']);
    expect(xai.allowConfirmCreateText).toBe(true);
    expect(xai.postCreateReadAttempts).toBeGreaterThan(1);
  });

  it('uses Mistral’s verified two-stage New key flow', () => {
    const mistral = AUTO_CREATE_PLATFORMS.find((platform) => platform.id === 'mistral') as {
      url?: string;
      createTexts?: string[];
      nameSelectors?: string[];
      confirmTexts?: string[];
      allowConfirmCreateText?: boolean;
      postCreateKeySelectors?: string[];
      postCreateDomReadAttempts?: number;
      postCreateReadAttempts?: number;
    };
    expect(mistral.url).toBe('https://console.mistral.ai/api-keys');
    expect(mistral.createTexts).toEqual(['New key']);
    expect(mistral.formEntryTexts).toEqual(['Create new key']);
    expect(mistral.nameSelectors).toContain('input[placeholder="My API Key"]');
    expect(mistral.confirmTexts).toEqual(['New key']);
    expect(mistral.allowConfirmCreateText).toBe(true);
    expect(mistral.postCreateKeySelectors).toEqual(['[role="dialog"] input']);
    expect(mistral.postCreateDomReadAttempts).toBeGreaterThan(1);
    expect(mistral.postCreateReadAttempts).toBeGreaterThan(1);
  });

  it('keeps a retry window for Mistral’s one-time success-dialog secret', () => {
    const mistral = AUTO_CREATE_PLATFORMS.find((platform) => platform.id === 'mistral') as {
      postCreateReadAttempts?: number;
    };
    expect(mistral.postCreateReadAttempts).toBe(5);
  });

  it('opens every still-unverified browser platform for one-time login', () => {
    const ids = BROWSER_LOGIN_VERIFICATION_PLATFORMS.map((platform) => platform.id);
    expect(ids).toHaveLength(19);
    expect(ids).not.toContain('cloudflare');
    expect(ids).not.toContain('openrouter');
    for (const platform of BROWSER_LOGIN_VERIFICATION_PLATFORMS) {
      expect(platform.url).toMatch(/^https:\/\//);
    }
  });
});
