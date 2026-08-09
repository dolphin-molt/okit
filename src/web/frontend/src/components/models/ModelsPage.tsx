import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { listProviders, deleteProvider, createProvider, updateProvider, getAuthStatus, triggerOAuthLogin, fetchModels, Provider, ProviderModel, ProviderEndpoint } from '../../api/providers';
import { useApp } from '../Layout/AppContext';
import { useI18n } from '../../i18n';
import VaultPickerModal from '../shared/VaultPickerModal';
import CustomSelect from '../shared/CustomSelect';
import crossDataRaw from '../../data/cross_platform_models.json';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const crossData: Record<string, any[]> = crossDataRaw as any;

const SHOW_MODELS = 4;
const TYPE_OPTIONS = [
  { value: 'anthropic', label: 'anthropic' },
  { value: 'openai', label: 'openai' },
  { value: 'google', label: 'google' },
];
const OPENAI_PROTOCOL_OPTIONS = [
  { value: 'chat', label: 'chat' },
  { value: 'responses', label: 'responses' },
];
const AUTH_MODE_OPTIONS: { value: 'api_key' | 'oauth' | 'both' | 'none'; labelKey: string }[] = [
  { value: 'api_key', labelKey: 'models.authModeApiKey' },
  { value: 'oauth', labelKey: 'models.authModeOAuth' },
  { value: 'both', labelKey: 'models.authModeBoth' },
  { value: 'none', labelKey: 'models.authModeNone' },
];

// 平台分组：用于左侧分组导航
const PROVIDER_GROUPS: { key: string; labelKey: string; ids: string[] }[] = [
  { key: 'official', labelKey: 'models.groupOfficial', ids: ['anthropic', 'openai', 'openai-codex', 'google', 'xai', 'mistral'] },
  { key: 'aggregator', labelKey: 'models.groupAggregator', ids: ['openrouter', 'groq', 'fireworks', 'together'] },
  { key: 'china', labelKey: 'models.groupChina', ids: ['volcengine', 'zai', 'zai-global', 'minimax', 'minimax-global', 'deepseek', 'moonshot', 'kimi-coding', 'qwen', 'qianfan', 'stepfun', 'xiaomi'] },
  { key: 'local', labelKey: 'models.groupLocal', ids: ['ollama', 'litellm'] },
];

// 协议视角：支持的协议类型
const PROTOCOLS: { key: string; labelKey: string }[] = [
  { key: 'openai-chat', labelKey: 'models.protocolOpenaiChat' },
  { key: 'openai-responses', labelKey: 'models.protocolOpenaiResponses' },
  { key: 'anthropic', labelKey: 'models.protocolAnthropic' },
  { key: 'google', labelKey: 'models.protocolGoogle' },
];

// 模态视角：模型能力分组
const MODES: { key: string; labelKey: string; match: (caps: string[]) => boolean }[] = [
  { key: 'multimodal', labelKey: 'models.modeMultimodal', match: caps => caps.some(c => ['image', 'video', 'audio'].includes(c)) },
  { key: 'audio', labelKey: 'models.modeAudio', match: caps => caps.includes('audio') },
  { key: 'text', labelKey: 'models.modeText', match: caps => caps.length === 0 || caps.every(c => c === 'text') },
];

// 根据模型 id/名称启发式推断能力（数据未标注时兜底）
function inferCaps(id: string, name?: string): string[] {
  const hay = `${id} ${name || ''}`.toLowerCase();
  const caps: string[] = ['text'];
  if (/(vision|image|img-|-vlm|omni|multimodal|vl$|vl-|ocr|video|veo|gemini)/.test(hay)) caps.push('image');
  if (/(audio|voice|speech|tts|asr|realtime|song)/.test(hay)) caps.push('audio');
  return caps;
}

function modelCaps(m: ProviderModel): string[] {
  if (Array.isArray(m.capabilities) && m.capabilities.length) return m.capabilities;
  return inferCaps(m.id, m.name);
}

function providerProtocols(p: Provider): string[] {
  const eps = p.endpoints || [{ type: p.type, baseUrl: p.baseUrl }];
  const keys = new Set<string>();
  for (const ep of eps) {
    if (ep.type === 'openai') keys.add(ep.protocol === 'responses' ? 'openai-responses' : 'openai-chat');
    else if (ep.type === 'anthropic') keys.add('anthropic');
    else if (ep.type === 'google') keys.add('google');
  }
  return Array.from(keys);
}

function providerModes(p: Provider): string[] {
  const modes = new Set<string>();
  const allCaps = p.models.flatMap(modelCaps);
  if (!allCaps.length) return ['text'];
  for (const m of MODES) if (m.match(allCaps)) modes.add(m.key);
  return Array.from(modes);
}

type ViewKey = 'platform' | 'model';

function groupOf(providerId: string): { key: string; labelKey: string } {
  for (const g of PROVIDER_GROUPS) {
    if (g.ids.includes(providerId)) return { key: g.key, labelKey: g.labelKey };
  }
  return { key: 'other', labelKey: 'models.groupOther' };
}

function endpointProtocol(ep: ProviderEndpoint) {
  return ep.type === 'openai' ? (ep.protocol || 'chat') : undefined;
}

function normalizeEndpoint(ep: ProviderEndpoint): ProviderEndpoint {
  if (ep.type === 'openai') return { ...ep, protocol: ep.protocol || 'chat' };
  const { protocol, ...rest } = ep;
  return rest;
}

function createOpenAIEndpoint(): ProviderEndpoint {
  return { type: 'openai', protocol: 'chat', baseUrl: '' };
}

interface AuthState {
  hasApiKey: boolean;
  oauthLoggedIn: boolean | null;
  authMode: string;
}

type StatusFilter = 'all' | 'authed' | 'unauthed' | 'used';

export default function ModelsPage() {
  const { showToast: toast, confirm } = useApp() as any;
  const { t, providerName } = useI18n();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [authMap, setAuthMap] = useState<Record<string, AuthState>>({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editProvider, setEditProvider] = useState<Provider | null>(null);
  const [view, setView] = useState<ViewKey>('platform');
  const [activeProvider, setActiveProvider] = useState<string | null>(null);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [activeProtocol, setActiveProtocol] = useState<string | null>(null);
  const [activeMode, setActiveMode] = useState<string | null>(null);
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [activeModelProvider, setActiveModelProvider] = useState<string | null>(null);
  const [activeModality, setActiveModality] = useState<string | null>(null);
  const [hideLegacy, setHideLegacy] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [expandedModels, setExpandedModels] = useState<Set<string>>(new Set());
  // 平台视角：当前查看详情的平台（点击平台卡片进入）
  const [activePlatform, setActivePlatform] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState<string | null>(null);
  const [testingConn, setTestingConn] = useState<string | null>(null);
  const [endpointResults, setEndpointResults] = useState<Record<string, { success: boolean; message: string }[]>>({});
  const [syncingModels, setSyncingModels] = useState<string | null>(null);
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);
  // 模型视角：选中的模型（纳入管理），前端 state
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const toggleModelSelected = useCallback((k: string) => {
    setSelectedModels((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k); else n.add(k);
      return n;
    });
  }, []);

  const load = useCallback(async () => {
    try {
      const [data, authData] = await Promise.all([listProviders(), getAuthStatus()]);
      setProviders(data.providers || []);
      const map: Record<string, AuthState> = {};
      for (const s of authData.statuses || []) {
        map[s.id] = { hasApiKey: s.hasApiKey, oauthLoggedIn: s.oauthLoggedIn, authMode: s.authMode };
      }
      setAuthMap(map);
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(p: Provider) {
    setActionMenuId(null);
    const ok = await confirm(t('models.confirmDelete', { name: p.name }));
    if (!ok) return;
    try {
      await deleteProvider(p.id);
      toast(t('models.deleted', { name: p.name }), 'success');
      load();
    } catch (err: any) {
      toast(err.message, 'error');
    }
  }

  async function handleOAuthLogin(providerId: string) {
    setLoggingIn(providerId);
    try {
      const res = await triggerOAuthLogin(providerId);
      toast(res.message, 'success');
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setLoggingIn(null);
    }
  }

  async function handleTestConnection(p: Provider) {
    setActionMenuId(null);
    const eps = (p.endpoints || [{ type: p.type, baseUrl: p.baseUrl }]).map(normalizeEndpoint);
    setTestingConn(p.id);
    setEndpointResults(prev => {
      const next = { ...prev };
      delete next[p.id];
      return next;
    });
    const results: { success: boolean; message: string }[] = [];
    const { api } = await import('../../api/client');
    for (const ep of eps) {
      try {
        const res = await api('/api/vault/test-key', {
          method: 'POST',
          body: JSON.stringify({ baseUrl: ep.baseUrl, type: ep.type, protocol: ep.protocol, vaultKey: p.vaultKey }),
        }) as any;
        results.push({ success: res.success, message: res.message });
      } catch (err: any) {
        results.push({ success: false, message: err.message || t('models.testFailed') });
      }
      setEndpointResults(prev => ({ ...prev, [p.id]: [...results] }));
    }
    const allOk = results.every(r => r.success);
    toast(
      allOk ? t('models.allEndpointsOk') : t('models.endpointsFailed', { n: results.filter(r => !r.success).length }),
      allOk ? 'success' : 'error'
    );
    setTestingConn(null);
  }

  async function handleSyncModels(p: Provider) {
    setActionMenuId(null);
    setSyncingModels(p.id);
    try {
      const res = await fetchModels(p.id);
      if (res.success) {
        toast(t('models.synced', { n: res.models.length }), 'success');
        load();
      } else if (res.kept) {
        toast(t('models.syncKept', { n: res.kept.length }), 'info');
      } else {
        toast(t('models.syncFailed'), 'error');
      }
    } catch (err: any) {
      toast(err.message || t('models.syncFailed'), 'error');
    } finally {
      setSyncingModels(null);
    }
  }

  function handleEdit(p: Provider) {
    setActionMenuId(null);
    setEditProvider(p);
    setShowForm(true);
  }

  function handleAdd() {
    setEditProvider(null);
    setShowForm(true);
  }

  function switchView(v: ViewKey) {
    setView(v);
    setActiveProvider(null);
    setActiveGroup(null);
    setActiveProtocol(null);
    setActiveMode(null);
    setActivePlatform(null);
  }

  async function handleFormSave(data: any) {
    try {
      if (editProvider) {
        await updateProvider(editProvider.id, data);
        toast(t('models.updated', { name: data.name }), 'success');
      } else {
        await createProvider(data);
        toast(t('models.added', { name: data.name }), 'success');
      }
      setShowForm(false);
      setEditProvider(null);
      load();
    } catch (err: any) {
      toast(err.message, 'error');
    }
  }

  function toggleExpand(id: string) {
    setExpandedModels(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // 计算每个 provider 是否"已被使用"
  function isUsedBy(p: Provider): boolean {
    return Boolean(p.usedBy && p.usedBy.length > 0);
  }

  function isAuthed(p: Provider): boolean {
    const auth = authMap[p.id];
    return Boolean((p.vaultKey && auth?.hasApiKey) || auth?.oauthLoggedIn === true);
  }

  function matchesQuery(p: Provider): boolean {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    if (p.name?.toLowerCase().includes(q)) return true;
    if (p.id.toLowerCase().includes(q)) return true;
    if (p.models?.some(m => m.id.toLowerCase().includes(q) || (m.name || '').toLowerCase().includes(q))) return true;
    return false;
  }

  // 过滤 + 分组
  const filteredProviders = useMemo(() => {
    return providers.filter(p => {
      // 平台视角：按分组或具体平台过滤
      if (activeProvider && p.id !== activeProvider) return false;
      if (activeGroup && groupOf(p.id).key !== activeGroup) return false;
      // 协议筛选：平台必须提供该协议端点
      if (activeProtocol && !providerProtocols(p).includes(activeProtocol)) return false;
      // 模态筛选：平台模型必须支持该能力
      if (activeMode && !providerModes(p).includes(activeMode)) return false;
      if (!matchesQuery(p)) return false;
      if (statusFilter === 'authed' && !isAuthed(p)) return false;
      if (statusFilter === 'unauthed' && isAuthed(p)) return false;
      if (statusFilter === 'used' && !isUsedBy(p)) return false;
      return true;
    });
  }, [providers, authMap, activeProvider, activeGroup, view, activeProtocol, activeMode, searchQuery, statusFilter]);

  const sortedProviders = useMemo(
    () => [...filteredProviders].sort((a, b) => a.id.localeCompare(b.id)),
    [filteredProviders]
  );

  // 统计
  const modelStats = useMemo(() => {
    const endpoints = providers.reduce((sum, p) => sum + (p.endpoints?.length || 1), 0);
    const models = providers.reduce((sum, p) => sum + (p.models?.length || 0), 0);
    const authed = providers.filter(p => isAuthed(p)).length;
    const used = providers.filter(p => isUsedBy(p)).length;
    return { endpoints, models, authed, used, total: providers.length };
  }, [providers, authMap]);

  // 分组 chips：跟随视角动态生成（分段结构，每段独立一行）
  // 返回: [{ label, chips: [...] }, ...]
  const groupChips = useMemo(() => {
    if (view === 'model') {
      // 模型视角：厂商 + 模态 + 协议（chip 区不再罗列具体模型本体，因为 ModelGrid 内部已按厂商分组）
      // 厂商 chip 计数：应用除「厂商自身」外的所有过滤（含模态），保证数量=点进去实际渲染数
      const filteredForProvider = filterModelEntries(
        Object.entries(crossData).filter(([, e]) => Array.isArray(e) && e.length > 0),
        { hideLegacy, activeProtocol, activeMode, activeModality, searchQuery, providers }
      );
      // 模态 chip 计数：应用除「模态自身」外的所有过滤（含厂商）
      const filteredForMod = filterModelEntries(
        Object.entries(crossData).filter(([, e]) => Array.isArray(e) && e.length > 0),
        { hideLegacy, activeProtocol, activeMode, searchQuery, providers, activeProvider: activeModelProvider }
      );
      const ppCounts: Record<string, number> = {};
      for (const [, e] of filteredForProvider) {
        const pp = e[0]?.primary_provider || 'unknown';
        ppCounts[pp] = (ppCounts[pp] || 0) + 1;
      }
      const providerChips = [
        { key: '__all_pp__', label: t('models.filterAll'), active: !activeModelProvider, onClick: () => setActiveModelProvider(null) },
        ...Object.entries(ppCounts)
          .sort((a, b) => b[1] - a[1])
          .map(([pp, n]) => ({
            key: pp,
            label: PROVIDER_LABELS[pp] || pp,
            extra: `${n}`,
            active: activeModelProvider === pp,
            onClick: () => setActiveModelProvider(activeModelProvider === pp ? null : pp),
          })),
      ];
      const protocolChips = [
        { key: '__all_proto__', label: t('models.filterAll'), active: !activeProtocol, onClick: () => setActiveProtocol(null) },
        ...PROTOCOLS.filter(pc => providers.some(p => providerProtocols(p).includes(pc.key))).map(pc => ({
          key: pc.key,
          label: t(pc.labelKey),
          active: activeProtocol === pc.key,
          onClick: () => setActiveProtocol(activeProtocol === pc.key ? null : pc.key),
        })),
      ];
      // 模态 chips（text/image/video/audio/3d/omni）——数量统计基于 filteredForMod
      const modCounts: Record<string, number> = {};
      for (const [, e] of filteredForMod) {
        const m = e[0]?.modality || 'text';
        modCounts[m] = (modCounts[m] || 0) + 1;
      }
      const MODALITIES: { key: string; label: string }[] = [
        { key: 'text', label: t('models.modText') },
        { key: 'image', label: t('models.modImage') },
        { key: 'video', label: t('models.modVideo') },
        { key: 'audio', label: t('models.modAudio') },
        { key: '3d', label: t('models.mod3d') },
        { key: 'omni', label: t('models.modOmni') },
      ];
      const modalityChips = [
        { key: '__all_mod__', label: t('models.filterAll'), active: !activeModality, onClick: () => setActiveModality(null) },
        ...MODALITIES.map(md => ({
          key: md.key,
          label: md.label,
          extra: `${modCounts[md.key] || 0}`,
          active: activeModality === md.key,
          onClick: () => setActiveModality(activeModality === md.key ? null : md.key),
        })),
      ];
      return [
        { label: t('models.dimModelProvider'), chips: providerChips },
        { label: t('models.dimModality'), chips: modalityChips },
        { label: t('models.dimProtocol'), chips: protocolChips },
      ];
    }

    // 平台视角：分组 + 协议 + 模态 + 状态（4 行）
    const groupChipsArr = [
      { key: '__all__', label: t('models.filterAll'), active: !activeGroup && !activeProvider, onClick: () => { setActiveGroup(null); setActiveProvider(null); } },
      ...PROVIDER_GROUPS.filter(g => providers.some(p => g.ids.includes(p.id))).map(g => ({
        key: g.key,
        label: t(g.labelKey),
        active: activeGroup === g.key && !activeProvider,
        onClick: () => { setActiveGroup(activeGroup === g.key ? null : g.key); setActiveProvider(null); },
      })),
    ];
    const protocolChipsArr = [
      { key: '__all_proto__', label: t('models.filterAll'), active: !activeProtocol, onClick: () => setActiveProtocol(null) },
      ...PROTOCOLS.filter(pc => providers.some(p => providerProtocols(p).includes(pc.key))).map(pc => ({
        key: pc.key,
        label: t(pc.labelKey),
        active: activeProtocol === pc.key,
        onClick: () => setActiveProtocol(activeProtocol === pc.key ? null : pc.key),
      })),
    ];
    const modeChipsArr = [
      { key: '__all_mode__', label: t('models.filterAll'), active: !activeMode, onClick: () => setActiveMode(null) },
      ...MODES.filter(md => providers.some(p => providerModes(p).includes(md.key))).map(md => ({
        key: md.key,
        label: t(md.labelKey),
        active: activeMode === md.key,
        onClick: () => setActiveMode(activeMode === md.key ? null : md.key),
      })),
    ];

    return [
      { label: t('models.dimPlatform'), chips: groupChipsArr },
      { label: t('models.dimProtocol'), chips: protocolChipsArr },
      { label: t('models.dimMode'), chips: modeChipsArr },
    ];
  }, [view, providers, activeProtocol, activeMode, activeGroup, activeProvider, activeModel, activeModelProvider, activeModality, t]);

  if (loading) return <div className="page-loading">{t('common.loading')}</div>;

  return (
    <>
    <div className="access-workspace models-workspace models-page-full">
        <header className="models-header">
          <div className="models-header-title">
            <div className="models-title-row">
              <h2>{t('models.title')}</h2>
              <div className="view-switcher" role="tablist" aria-label={t('models.viewSwitch')}>
                {([
                  ['platform', t('models.viewPlatform')],
                  ['model', t('models.viewModel')],
                ] as [ViewKey, string][]).map(([key, label]) => (
                  <button
                    key={key}
                    role="tab"
                    aria-selected={view === key}
                    className={`view-switcher-btn${view === key ? ' view-switcher-btn--active' : ''}`}
                    onClick={() => switchView(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <p>{t('models.lede')}</p>
          </div>
          <div className="models-header-stats">
            <StatChip label={t('models.totalPlatforms')} value={modelStats.total} />
            <StatChip label={t('models.totalModels')} value={modelStats.models} tone="muted" />
            <StatChip label={t('models.totalEndpoints')} value={modelStats.endpoints} tone="muted" />
            <StatChip label={t('models.authReady')} value={`${modelStats.authed} / ${modelStats.total}`} tone={modelStats.authed === modelStats.total ? 'success' : 'warn'} />
          </div>
        </header>

        {/* 搜索栏（独立行） + 添加按钮（右上） */}
        <div className="models-search-row">
          <input
            className="vault-input models-search"
            type="search"
            placeholder={t('models.searchPlaceholder')}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          <button className="vault-toolbar-btn" onClick={handleAdd}>{t('models.addPlatform')}</button>
        </div>

        {/* chips 工具栏（按行：每个筛选维度独立一行） */}
        <div className="models-toolbar">
          {groupChips.map((section, i) => (
            <div key={i} className="models-filter-section">
              <span className="models-filter-section-label">{section.label}</span>
              <div className="models-filter-section-chips">
                {section.chips.map(c => (
                  <button
                    key={c.key}
                    className={`models-filter-chip${c.active ? ' models-filter-chip--active' : ''}`}
                    onClick={c.onClick}
                  >
                    {c.label}
                    {(c as any).extra && <span className="models-chip-extra">{(c as any).extra}</span>}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {view !== 'model' && (
            <div className="models-filter-section">
              <span className="models-filter-section-label">{t('models.dimStatus')}</span>
              <div className="models-filter-section-chips">
                {([
                  ['all', t('models.filterAll')],
                  ['authed', t('models.filterAuthed')],
                  ['unauthed', t('models.filterUnauthed')],
                  ['used', t('models.filterUsed')],
                ] as [StatusFilter, string][]).map(([key, label]) => (
                  <button
                    key={key}
                    className={`models-filter-chip${statusFilter === key ? ' models-filter-chip--active' : ''}`}
                    onClick={() => setStatusFilter(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {view === 'model' && (
            <div className="models-filter-section">
              <span className="models-filter-section-label">选项</span>
              <div className="models-filter-section-chips">
                <button
                  className={`models-filter-chip models-filter-chip--toggle${hideLegacy ? ' models-filter-chip--active' : ''}`}
                  onClick={() => setHideLegacy(!hideLegacy)}
                  type="button"
                >
                  {hideLegacy ? `✓ ${t('models.onlyLatest')}` : t('models.showLegacy')}
                </button>
              </div>
            </div>
          )}
        </div>

        {view === 'model' && activeModel && crossData[activeModel] && (
          <ModelDetailPanel modelKey={activeModel} entries={crossData[activeModel]} providers={providers} t={t} onBack={() => setActiveModel(null)} />
        )}
        {view === 'model' && !activeModel && (
          <ModelGrid
            models={Object.entries(crossData).filter(([, e]) => Array.isArray(e) && e.length > 0)}
            providers={providers}
            activeModel={activeModel}
            searchQuery={searchQuery}
            onSelect={(k) => setActiveModel(k)}
            t={t}
            activeProvider={activeModelProvider}
            hideLegacy={hideLegacy}
            activeProtocol={activeProtocol}
            activeMode={activeMode}
            activeModality={activeModality}
            selected={selectedModels}
            onToggle={toggleModelSelected}
          />
        )}
        {view === 'model' && !activeModel && selectedModels.size > 0 && (
          <div className="model-bulk-bar">
            <span className="model-bulk-count">{t('models.selectedCount', { n: selectedModels.size })}</span>
            <button
              className="btn-primary"
              onClick={() => {
                try { localStorage.setItem('okit.managedModels', JSON.stringify([...selectedModels])); } catch { /* ignore */ }
                toast(t('models.bulkEnabled', { n: selectedModels.size }));
              }}
            >
              {t('models.bulkEnable')}
            </button>
            <button className="btn-ghost" onClick={() => setSelectedModels(new Set())}>
              {t('models.clearSelection')}
            </button>
          </div>
        )}
        {view === 'platform' && !activePlatform && (
          <div>
            {sortedProviders.length === 0 && (
              <div className="empty-state"><p>{t('models.noMatch')}</p></div>
            )}

            <div className="provider-list">
          {sortedProviders.map(p => {
            const eps = (p.endpoints || [{ type: p.type, baseUrl: p.baseUrl }]).map(normalizeEndpoint);
            const showAll = expandedModels.has(p.id);
            const visibleModels = showAll ? p.models : p.models.slice(0, SHOW_MODELS);
            const hasMore = p.models.length > SHOW_MODELS;
            const auth = authMap[p.id];
            const authed = isAuthed(p);
            const used = isUsedBy(p);
            const group = groupOf(p.id);

            return (
              <article key={p.id} className={`provider-card provider-card--clickable${authed ? ' provider-card--authed' : ''}${used ? ' provider-card--used' : ''}`} onClick={() => setActivePlatform(p.id)}>
                <div className="provider-card-header">
                  <div className="provider-card-title">
                    <span className={`type-badge type-badge--${p.type}`}>{p.type}</span>
                    <h3>{providerName(p.id, p.name)}</h3>
                    <span className="provider-card-group">{t(group.labelKey)}</span>
                  </div>
                  <div className="provider-card-status">
                    <span className={`provider-status provider-status--${authed ? 'authed' : 'unauthed'}`}>
                      {authed ? t('models.statusAuthed') : t('models.statusUnauthed')}
                    </span>
                    {used && (
                      <span className="provider-status provider-status--used">
                        {t('models.inUseBy', { n: p.usedBy?.length || 0 })}
                      </span>
                    )}
                  </div>
                  <div className="provider-card-actions">
                    <button
                      className="btn-icon"
                      onClick={e => { e.stopPropagation(); setActionMenuId(actionMenuId === p.id ? null : p.id); }}
                      title={t('models.moreActions')}
                      aria-haspopup="menu"
                      aria-expanded={actionMenuId === p.id}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
                    </button>
                    {actionMenuId === p.id && (
                      <ActionMenu
                        onClose={() => setActionMenuId(null)}
                        actions={[
                          { label: t('models.menuTest'), onClick: () => handleTestConnection(p), disabled: testingConn === p.id },
                          { label: t('models.menuSync'), onClick: () => handleSyncModels(p), disabled: syncingModels === p.id },
                          { label: t('models.menuEdit'), onClick: () => handleEdit(p) },
                          { label: t('models.menuDelete'), onClick: () => handleDelete(p), danger: true },
                        ]}
                      />
                    )}
                  </div>
                </div>

                <div className="provider-card-body">
                  <div className="provider-card-endpoints">
                    {eps.map((ep, i) => {
                      const epResult = endpointResults[p.id]?.[i];
                      return (
                        <div key={i} className="provider-endpoint-row">
                          <span className={`type-badge type-badge--${ep.type}`}>{ep.type}</span>
                          {endpointProtocol(ep) && <span className="endpoint-protocol-badge">{endpointProtocol(ep)}</span>}
                          <span className="provider-endpoint-url">{ep.baseUrl}</span>
                          {testingConn === p.id && !epResult && i === (endpointResults[p.id]?.length || 0) && (
                            <span className="ep-test-spinner">...</span>
                          )}
                          {epResult && (
                            <span className={`ep-test-result${epResult.success ? ' ep-test-ok' : ' ep-test-fail'}`}>
                              {epResult.success ? '✓' : '✗'}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="provider-card-auth">
                    {p.vaultKey && (
                      <span className={`auth-indicator${auth?.hasApiKey ? ' auth-indicator--key' : ' auth-indicator--none'}`}>
                        <span className="auth-dot" /> {p.vaultKey}
                      </span>
                    )}
                    {(p.authMode === 'oauth' || p.authMode === 'both') && (
                      <span className={`auth-indicator${auth?.oauthLoggedIn ? ' auth-indicator--oauth' : ' auth-indicator--none'}`}>
                        <span className="auth-dot" /> OAuth {auth?.oauthLoggedIn ? t('models.loggedIn') : t('models.notLoggedIn')}
                        {!auth?.oauthLoggedIn && (
                          <button
                            className="auth-login-btn"
                            disabled={loggingIn === p.id}
                            onClick={e => { e.stopPropagation(); handleOAuthLogin(p.id); }}
                          >
                            {loggingIn === p.id ? '...' : t('models.login')}
                          </button>
                        )}
                      </span>
                    )}
                    {!p.vaultKey && p.authMode !== 'oauth' && p.authMode !== 'both' && (
                      <span className="auth-indicator auth-indicator--none">
                        <span className="auth-dot" /> {t('common.notConfigured')}
                      </span>
                    )}
                  </div>
                </div>

                {p.models.length > 0 && (
                  <div className="provider-card-models">
                    <div className="provider-models-label">
                      {t('models.modelsCount', { n: p.models.length })}
                    </div>
                    <div className="provider-models-list">
                      {visibleModels.map(m => {
                        const caps = modelCaps(m);
                        const isMulti = caps.some(c => c !== 'text');
                        return (
                          <span key={m.id} className={`model-chip${isMulti ? ' model-chip--multi' : ''}`} title={m.id}>
                            {isMulti && (
                              <span className="model-chip-caps">
                                {caps.includes('image') ? 'img' : caps.includes('audio') ? 'aud' : 'mm'}
                              </span>
                            )}
                            <span className="model-chip-name">{m.name || m.id}</span>
                          </span>
                        );
                      })}
                      {hasMore && (
                        <button className="models-expand-btn" onClick={e => { e.stopPropagation(); toggleExpand(p.id); }}>
                          {showAll ? t('models.collapse') : `+${p.models.length - SHOW_MODELS}`}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
          </div>
        )}

        {view === 'platform' && activePlatform && (
          (() => {
            const p = providers.find(pp => pp.id === activePlatform);
            if (!p) return <div className="empty-state"><p>{t('models.noMatch')}</p></div>;
            return (
              <PlatformDetailPanel
                provider={p}
                providers={providers}
                crossData={crossData}
                authed={isAuthed(p)}
                onBack={() => setActivePlatform(null)}
              />
            );
          })()
        )}

      {showForm && (
        <ProviderForm
          provider={editProvider}
          onSave={handleFormSave}
          onClose={() => { setShowForm(false); setEditProvider(null); }}
        />
      )}
      </div>
    </>
  );
}
function StatChip({ label, value, tone }: { label: string; value: number | string; tone?: 'muted' | 'success' | 'warn' }) {
  return (
    <div className={`stat-chip stat-chip--${tone || 'default'}`}>
      <span className="stat-chip-value">{value}</span>
      <span className="stat-chip-label">{label}</span>
    </div>
  );
}

function ModelDetailPanel({ modelKey, entries, providers, t, onBack }: { modelKey: string; entries: any[]; providers: Provider[]; t: (k: string, ...args: any[]) => string; onBack: () => void }) {
  const platforms = [...new Set(entries.map((e: any) => e.platform))];
  const fmtPrice = (raw: string | undefined): number => {
    if (!raw || raw === '0') return 0;
    const n = parseFloat(raw);
    return isNaN(n) ? 0 : n * 1e6;
  };
  const allPrices = entries.flatMap(e => [fmtPrice(e.pricing?.prompt), fmtPrice(e.pricing?.completion)]);
  const maxPrice = Math.max(...allPrices, 0.01);

  // 模型基本信息聚合（取有数据的第一个）
  const sample = entries.find((e: any) => e.context || e.architecture) || entries[0];
  const arch = sample?.architecture || {};
  const inputModes: string[] = arch.input_modalities || arch.inputModes || [];
  const outputModes: string[] = arch.output_modalities || arch.outputModes || [];
  const ctx = sample?.context || sample?.context_length;
  const sampleEntry = entries.find((e: any) => e.context) || entries[0];
  const allPlatformsWithCtx = entries.filter((e: any) => e.context).map((e: any) => e.context);
  const minInputPrice = Math.min(...entries.map((e: any) => fmtPrice(e.pricing?.prompt)).filter(n => n > 0), Infinity);
  const minOutputPrice = Math.min(...entries.map((e: any) => fmtPrice(e.pricing?.completion)).filter(n => n > 0), Infinity);

  return (
    <div className="model-cross-view">
      <div className="model-detail-header">
        <button className="model-detail-back" onClick={onBack}>← {t('models.back')}</button>
        <div className="model-detail-title">
          <h3>{modelKey}</h3>
          <p>{t('models.modelAvailableIn', { n: platforms.length })}</p>
        </div>
      </div>

      {/* 模型基本信息 */}
      <div className="model-info-grid">
        <div className="model-info-card">
          <div className="model-info-label">{t('models.infoContext')}</div>
          <div className="model-info-value">
            {ctx ? `${Math.round(ctx / 1024)}K` : '—'}
            {allPlatformsWithCtx.length > 1 && (
              <span className="model-info-hint"> · {t('models.infoContextHint', { n: allPlatformsWithCtx.length })}</span>
            )}
          </div>
        </div>
        <div className="model-info-card">
          <div className="model-info-label">{t('models.infoInputModes')}</div>
          <div className="model-info-value">
            {inputModes.length ? inputModes.map((m: string) => (
              <span key={m} className="model-info-mode">{m}</span>
            )) : <span className="model-info-muted">—</span>}
          </div>
        </div>
        <div className="model-info-card">
          <div className="model-info-label">{t('models.infoOutputModes')}</div>
          <div className="model-info-value">
            {outputModes.length ? outputModes.map((m: string) => (
              <span key={m} className="model-info-mode">{m}</span>
            )) : <span className="model-info-muted">—</span>}
          </div>
        </div>
        <div className="model-info-card">
          <div className="model-info-label">{t('models.infoMinPrice')}</div>
          <div className="model-info-value">
            {isFinite(minInputPrice) ? <span className="model-info-price">${minInputPrice.toFixed(2)}<span className="model-info-unit">/M in</span></span> : '—'}
            {isFinite(minOutputPrice) && <span className="model-info-price"> · ${minOutputPrice.toFixed(2)}<span className="model-info-unit">/M out</span></span>}
          </div>
        </div>
        <div className="model-info-card">
          <div className="model-info-label">{t('models.infoAuthed')}</div>
          <div className="model-info-value">
            {(() => {
              const authedCount = platforms.filter((pid: any) => providers.find(p => p.id === pid)?.vaultKey).length;
              return <span className={authedCount === platforms.length ? 'model-info-ok' : authedCount > 0 ? 'model-info-warn' : 'model-info-muted'}>{authedCount}/{platforms.length}</span>;
            })()}
          </div>
        </div>
      </div>

      {/* 跨平台对照表 */}
      <div className="model-cross-table-wrap">
        <table className="model-cross-table">
          <thead>
            <tr>
              <th>{t('models.platform')}</th>
              <th>{t('models.modelId')}</th>
              <th>{t('models.contextLabel')}</th>
              <th>{t('models.inputPrice')}</th>
              <th>{t('models.outputPrice')}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e: any, i: number) => {
              const pr = providers.find(p => p.id === e.platform);
              const ec = e.context ? `${Math.round(e.context / 1024)}K` : '?';
              const pi = fmtPrice(e.pricing?.prompt);
              const po = fmtPrice(e.pricing?.completion);
              const piPct = maxPrice > 0 ? (pi / maxPrice) * 100 : 0;
              const poPct = maxPrice > 0 ? (po / maxPrice) * 100 : 0;
              return (
                <tr key={i} className={pr?.vaultKey ? 'model-cross-row--authed' : ''}>
                  <td className="model-cross-platform">
                    {pr ? (
                      <span className="platform-chip">
                        <span className={`type-badge type-badge--${pr.type}`}>{pr.type}</span>
                        {pr.name}
                      </span>
                    ) : e.platform}
                  </td>
                  <td className="model-cross-id"><code>{e.model_id}</code></td>
                  <td className="model-cross-ctx">{ec}</td>
                  <td className="model-cross-price">
                    <span className="price-bar-wrap">
                      <span className="price-bar" style={{ width: `${Math.max(piPct, 3)}%` }} />
                      <span className="price-bar-label">{pi > 0 ? `$${pi.toFixed(2)}/M` : t('common.free')}</span>
                    </span>
                  </td>
                  <td className="model-cross-price">
                    <span className="price-bar-wrap">
                      <span className="price-bar price-bar--output" style={{ width: `${Math.max(poPct, 3)}%` }} />
                      <span className="price-bar-label">{po > 0 ? `$${po.toFixed(2)}/M` : t('common.free')}</span>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ============ 平台详情视图：完整模型列表 + 可展开模型参数 ============ */
function PlatformDetailPanel({ provider, providers, crossData, authed, onBack }: {
  provider: Provider;
  providers: Provider[];
  crossData: Record<string, any[]>;
  authed: boolean;
  onBack: () => void;
}) {
  const { t, providerName } = useI18n();
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const fmtPrice = (raw: string | undefined): number => {
    if (!raw || raw === '0') return 0;
    const n = parseFloat(raw);
    return isNaN(n) ? 0 : n * 1e6;
  };
  const MOD_LABEL: Record<string, string> = {
    text: t('models.modText'), image: t('models.modImage'), video: t('models.modVideo'),
    audio: t('models.modAudio'), '3d': t('models.mod3d'), omni: t('models.modOmni'),
  };

  // 为每个实际配置的模型匹配参数清单（大小写/前缀归一化后查找）
  const rows = useMemo(() => {
    const lowerMap: Record<string, string> = {};
    for (const k of Object.keys(crossData)) lowerMap[k.toLowerCase()] = k;
    return (provider.models || [])
      .filter(m => m.id && m.id.trim())
      .map(m => {
        const id = m.id.trim();
        const norm = id.split('/').pop()?.toLowerCase() || '';
        const key = crossData[id] ? id : (lowerMap[norm] || lowerMap[id.toLowerCase()] || '');
        const entries = key ? (crossData[key] || []) : [];
        const entry = entries.find((e: any) => e.platform === provider.id) || entries[0];
        return {
          m,
          id,
          key,
          entries,
          entry,
          ctx: entry?.context || entries.find((e: any) => e.context)?.context || null,
          pricing: entry?.pricing || {},
          modality: entry?.modality || 'text',
          vendorFamily: entry?.vendor_family || '',
          isFlagship: Boolean(entry?.is_flagship),
          created: entry?.created || entries[0]?.created || 0,
          legacy: Boolean(entry?.legacy),
          otherPlatforms: key ? [...new Set((entries || []).map((e: any) => e.platform))].filter((pl: string) => pl !== provider.id) : [],
        };
      });
  }, [provider, crossData]);

  const filtered = useMemo(() => {
    if (!q.trim()) return rows;
    const s = q.toLowerCase();
    return rows.filter(r =>
      r.id.toLowerCase().includes(s) ||
      (r.m.name || '').toLowerCase().includes(s) ||
      r.vendorFamily.toLowerCase().includes(s)
    );
  }, [rows, q]);

  const withParams = rows.filter(r => r.key).length;
  const usedCount = provider.usedBy?.length || 0;
  const eps = (provider.endpoints || [{ type: provider.type, baseUrl: provider.baseUrl }]).map(normalizeEndpoint);

  return (
    <div className="model-cross-view platform-detail-view">
      <div className="model-detail-header">
        <button className="model-detail-back" onClick={onBack}>← {t('models.back')}</button>
        <div className="model-detail-title">
          <h3>
            <span className={`type-badge type-badge--${provider.type}`}>{provider.type}</span>{' '}
            {providerName(provider.id, provider.name)}
          </h3>
          <p>{t('models.platformModelsCount', { n: provider.models.length })}</p>
        </div>
      </div>

      {/* 平台概览信息卡 */}
      <div className="model-info-grid">
        <div className="model-info-card">
          <div className="model-info-label">{t('models.totalModels')}</div>
          <div className="model-info-value">{provider.models.length}</div>
        </div>
        <div className="model-info-card">
          <div className="model-info-label">{t('models.withParams')}</div>
          <div className="model-info-value">{withParams}<span className="model-info-muted"> / {provider.models.length}</span></div>
        </div>
        <div className="model-info-card">
          <div className="model-info-label">{t('models.infoAuthed')}</div>
          <div className="model-info-value">
            {authed ? <span className="model-info-ok">✓</span> : <span className="model-info-muted">—</span>}
          </div>
        </div>
        <div className="model-info-card">
          <div className="model-info-label">{t('models.usedCount')}</div>
          <div className="model-info-value">{usedCount}</div>
        </div>
        <div className="model-info-card platform-detail-endpoint-card">
          <div className="model-info-label">{t('models.endpoint')}</div>
          <div className="model-info-value platform-detail-endpoints">
            {eps.map((ep, i) => (
              <span key={i} className="model-info-mode">
                {ep.type}{ep.type === 'openai' ? `/${ep.protocol || 'chat'}` : ''} · {ep.baseUrl}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* 模型搜索 */}
      <input
        className="vault-input platform-detail-search"
        type="search"
        placeholder={t('models.searchModels')}
        value={q}
        onChange={e => setQ(e.target.value)}
      />

      {/* 完整模型列表（不做截断） */}
      <div className="platform-model-list">
        {filtered.length === 0 && (
          <div className="empty-state"><p>{t('models.noMatch')}</p></div>
        )}
        {filtered.map(r => {
          const pi = fmtPrice(r.pricing?.prompt);
          const po = fmtPrice(r.pricing?.completion);
          const isOpen = expanded.has(r.id);
          return (
            <div
              key={r.id}
              className={`platform-model-row${isOpen ? ' platform-model-row--open' : ''}`}
              onClick={() => setExpanded(prev => {
                const n = new Set(prev);
                n.has(r.id) ? n.delete(r.id) : n.add(r.id);
                return n;
              })}
            >
              <div className="platform-model-row-head">
                <span className={`model-card-mod model-card-mod--${r.modality}`}>{MOD_LABEL[r.modality] || r.modality}</span>
                <span className="platform-model-id"><code>{r.id}</code></span>
                {r.isFlagship && <span className="platform-model-flag">{t('models.isFlagship')}</span>}
                {r.ctx && <span className="platform-model-ctx">{Math.round(r.ctx / 1024)}K</span>}
                <span className="platform-model-price">
                  {pi > 0 ? `$${pi.toFixed(2)}/M in` : ''}
                  {po > 0 ? ` · $${po.toFixed(2)}/M out` : ''}
                </span>
                {!r.key && <span className="platform-model-nodata-tag">{t('models.noParamData')}</span>}
                <span className="platform-model-chevron">▾</span>
              </div>
              {isOpen && (
                <div className="platform-model-detail">
                  <div className="model-info-grid platform-model-params">
                    <div className="model-info-card">
                      <div className="model-info-label">{t('models.infoContext')}</div>
                      <div className="model-info-value">{r.ctx ? `${Math.round(r.ctx / 1024)}K` : '—'}</div>
                    </div>
                    <div className="model-info-card">
                      <div className="model-info-label">{t('models.inputPrice')}</div>
                      <div className="model-info-value">{pi > 0 ? <span className="model-info-price">${pi.toFixed(2)}<span className="model-info-unit">/M</span></span> : (r.key ? t('common.free') : '—')}</div>
                    </div>
                    <div className="model-info-card">
                      <div className="model-info-label">{t('models.outputPrice')}</div>
                      <div className="model-info-value">{po > 0 ? <span className="model-info-price">${po.toFixed(2)}<span className="model-info-unit">/M</span></span> : (r.key ? t('common.free') : '—')}</div>
                    </div>
                    <div className="model-info-card">
                      <div className="model-info-label">{t('models.modality')}</div>
                      <div className="model-info-value">{MOD_LABEL[r.modality] || r.modality}</div>
                    </div>
                    <div className="model-info-card">
                      <div className="model-info-label">{t('models.vendorFamily')}</div>
                      <div className="model-info-value">{r.vendorFamily || '—'}</div>
                    </div>
                    <div className="model-info-card">
                      <div className="model-info-label">{t('models.isFlagship')}</div>
                      <div className="model-info-value">{r.isFlagship ? '✓' : '—'}</div>
                    </div>
                    <div className="model-info-card">
                      <div className="model-info-label">{t('models.released')}</div>
                      <div className="model-info-value">{r.created ? fmtTimeAgo(r.created) : '—'}</div>
                    </div>
                    <div className="model-info-card">
                      <div className="model-info-label">{t('models.otherPlatforms')}</div>
                      <div className="model-info-value">{r.otherPlatforms.length ? r.otherPlatforms.join(' · ') : '—'}</div>
                    </div>
                  </div>
                  {!r.key && (
                    <div className="platform-model-nodata">
                      {t('models.noParamDataHint')}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// 模型本体卡片网格（模型视角默认）：按主厂商分组 + 按发布时间倒序 + 隐藏老旧
const PROVIDER_LABELS: Record<string, string> = {
  'openai': 'OpenAI',
  'anthropic': 'Anthropic',
  'google': 'Google',
  'x-ai': 'xAI',
  'mistralai': 'Mistral',
  'meta-llama': 'Meta',
  'qwen': 'Qwen · 阿里',
  'deepseek': 'DeepSeek',
  'moonshotai': 'Moonshot · 月之暗面',
  'minimax': 'MiniMax · 稀宇科技',
  'z-ai': '智谱 Z.AI',
  'stepfun': '阶跃星辰',
  'tencent': '腾讯混元',
  'baidu': '百度文心',
  'siliconflow': '硅基流动',
  'xiaomi': '小米 MiMo',
  'meituan': '美团 LongCat',
  'inclusionai': '阿里云',
  'nex-agi': 'Nex AGI',
  'cohere': 'Cohere',
  'perplexity': 'Perplexity',
  'amazon': 'Amazon',
  'microsoft': 'Microsoft',
  'nvidia': 'NVIDIA',
  'kwaipilot': '快手 Kwai',
  'bytedance': '字节 Seed',
  'sao10k': 'Sao10K',
  'unknown': '其他',
};

// 模型视角共享过滤：groupChips 的数量统计与 ModelGrid 渲染必须用同一套条件，否则 chip 数量与实际渲染对不上
function filterModelEntries(
  entries: [string, any[]][],
  opts: {
    hideLegacy: boolean;
    activeProtocol: string | null;
    activeMode: string | null;
    activeModality?: string | null;
    searchQuery: string;
    providers: Provider[];
    activeProvider?: string | null;
  }
): [string, any[]][] {
  let res = entries;
  if (opts.hideLegacy) {
    res = res.filter(([, e]) => !e.some((x: any) => x.legacy));
  }
  if (opts.activeModality) {
    res = res.filter(([, e]) => e.some((x: any) => (x.modality || 'text') === opts.activeModality));
  }
  if (opts.activeProtocol) {
    res = res.filter(([, e]) => e.some((x: any) => {
      const pr = opts.providers.find((p) => p.id === x.platform);
      return pr && providerProtocols(pr).includes(opts.activeProtocol as string);
    }));
  }
  if (opts.activeMode) {
    res = res.filter(([, e]) => e.some((x: any) => {
      const pr = opts.providers.find((p) => p.id === x.platform);
      return pr && providerModes(pr).includes(opts.activeMode as string);
    }));
  }
  if (opts.searchQuery.trim()) {
    const q = opts.searchQuery.toLowerCase();
    res = res.filter(([k]) => k.toLowerCase().includes(q));
  }
  if (opts.activeProvider) {
    res = res.filter(([, e]) => (e[0]?.primary_provider || 'unknown') === opts.activeProvider);
  }
  return res;
}

function fmtTimeAgo(ts: number): string {
  if (!ts) return '';
  const now = Date.now() / 1000;
  const diff = now - ts;
  if (diff < 0) return 'future';
  if (diff < 60 * 60 * 24 * 30) return `${Math.floor(diff / 86400)}d`;
  if (diff < 60 * 60 * 24 * 365) return `${Math.floor(diff / 2592000)}mo`;
  return `${Math.floor(diff / 31536000)}y`;
}

function ModelGrid({ models, providers, activeModel: _activeModel, searchQuery: _sq, onSelect, t, activeProvider, hideLegacy, activeProtocol, activeMode, activeModality, selected, onToggle }: {
  models: [string, any[]][];
  providers: Provider[];
  activeModel: string | null;
  searchQuery: string;
  onSelect: (k: string) => void;
  t: (k: string, ...args: any[]) => string;
  activeProvider: string | null;
  hideLegacy: boolean;
  activeProtocol: string | null;
  activeMode: string | null;
  activeModality: string | null;
  selected: Set<string>;
  onToggle: (k: string) => void;
}) {
  // 与厂商 chip 数量统计用同一套过滤条件，保证数量一致
  const filtered = filterModelEntries(models, { hideLegacy, activeProtocol, activeMode, activeModality, searchQuery: _sq, providers, activeProvider });
  if (filtered.length === 0) {
    return <div className="empty-state"><p>{t('models.noMatch')}</p></div>;
  }
  const fmtPrice = (raw: string | undefined): number => {
    if (!raw || raw === '0') return 0;
    const n = parseFloat(raw);
    return isNaN(n) ? 0 : n * 1e6;
  };

  // 按厂商分组
  const grouped: Record<string, [string, any[]][]> = {};
  for (const [key, entries] of filtered) {
    const pp = entries[0]?.primary_provider || 'unknown';
    if (!grouped[pp]) grouped[pp] = [];
    grouped[pp].push([key, entries]);
  }

  // 每组内按 created 倒序
  for (const pp of Object.keys(grouped)) {
    grouped[pp].sort((a, b) => (b[1][0]?.created || 0) - (a[1][0]?.created || 0));
  }

  // 厂商排序（按模型数量）
  const sortedGroups = Object.entries(grouped).sort((a, b) => b[1].length - a[1].length);

  const visibleKeys = filtered.map(([k]) => k);
  const allSelected = visibleKeys.length > 0 && visibleKeys.every((k) => selected.has(k));
  const toggleSelectAll = () => {
    if (allSelected) visibleKeys.forEach((k) => onToggle(k));
    else visibleKeys.forEach((k) => { if (!selected.has(k)) onToggle(k); });
  };

  return (
    <div className="model-grid-wrap">
      <div className="model-grid-toolbar">
        <label className="model-select-all">
          <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
          {t('models.selectAllCurrent')} ({visibleKeys.length})
        </label>
      </div>
      {sortedGroups.map(([pp, items]) => (
        <section key={pp} className="model-grid-section">
          <h3 className="model-grid-section-title">
            <span className="model-grid-section-name">{PROVIDER_LABELS[pp] || pp}</span>
            <span className="model-grid-section-count">{items.length}</span>
          </h3>
          <div className="model-grid">
            {items.map(([key, entries]) => {
              const platforms = [...new Set(entries.map((e: any) => e.platform))];
              const ctxEntry = entries.find((e: any) => e.context);
              const ctx = ctxEntry?.context;
              const minIn = Math.min(...entries.map((e: any) => fmtPrice(e.pricing?.prompt)).filter(n => n > 0), Infinity);
              const minOut = Math.min(...entries.map((e: any) => fmtPrice(e.pricing?.completion)).filter(n => n > 0), Infinity);
              const authedCount = platforms.filter((pid: any) => providers.find(p => p.id === pid)?.vaultKey).length;
              const sample = entries.find((e: any) => e.architecture) || entries[0];
              const inputModes: string[] = sample?.architecture?.input_modalities || [];
              const isMulti = (inputModes.length || 0) > 1;
              const created = entries[0]?.created || 0;
              const isLegacy = entries.some((e: any) => e.legacy);
              const isSel = selected.has(key);
              const mod = entries[0]?.modality || 'text';
              const MOD_LABEL: Record<string, string> = {
                text: t('models.modText'), image: t('models.modImage'), video: t('models.modVideo'),
                audio: t('models.modAudio'), '3d': t('models.mod3d'), omni: t('models.modOmni'),
              };
              return (
                <article
                  key={key}
                  className={`model-card${isLegacy ? ' model-card--legacy' : ''}${isSel ? ' model-card--selected' : ''}`}
                  onClick={() => onSelect(key)}
                >
                  <input
                    type="checkbox"
                    className="model-card-check"
                    checked={isSel}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => onToggle(key)}
                  />
                  <div className="model-card-title">
                    <span className={`model-card-mod model-card-mod--${mod}`}>{MOD_LABEL[mod] || mod}</span>
                    <h3>{key}</h3>
                    {created > 0 && (
                      <span className={`model-card-age ${isLegacy ? 'model-card-age--legacy' : 'model-card-age--fresh'}`}>
                        {fmtTimeAgo(created)}
                      </span>
                    )}
                  </div>
                  <div className="model-card-meta">
                    <span className="model-card-platforms">{platforms.length} {t('models.platforms')}</span>
                    {ctx && <span className="model-card-ctx">{Math.round(ctx / 1024)}K ctx</span>}
                    {inputModes.length > 0 && (
                      <span className={`model-card-modes ${isMulti ? 'model-card-modes--multi' : ''}`}>
                        {inputModes.slice(0, 3).join(' + ')}
                      </span>
                    )}
                  </div>
                  <div className="model-card-price">
                    {isFinite(minIn) && <span className="model-card-price-in">${minIn.toFixed(2)}<span className="model-card-unit">/M in</span></span>}
                    {isFinite(minOut) && <span className="model-card-price-out">${minOut.toFixed(2)}<span className="model-card-unit">/M out</span></span>}
                  </div>
                  <div className="model-card-footer">
                    <span className={`model-card-authed ${authedCount === platforms.length ? 'model-card-authed--all' : authedCount > 0 ? 'model-card-authed--part' : 'model-card-authed--none'}`}>
                      {authedCount}/{platforms.length} {t('models.authReady')}
                    </span>
                    <span className="model-card-cta">{t('models.viewDetail')} →</span>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function ActionMenu({ actions, onClose }: { actions: { label: string; onClick: () => void; danger?: boolean; disabled?: boolean }[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [onClose]);
  return (
    <div ref={ref} className="action-menu" role="menu" onClick={e => e.stopPropagation()}>
      {actions.map((a, i) => (
        <button
          key={i}
          className={`action-menu-item${a.danger ? ' action-menu-item--danger' : ''}`}
          onClick={a.onClick}
          disabled={a.disabled}
          role="menuitem"
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}

/* --- Provider Form Modal --- */
function ProviderForm({ provider, onSave, onClose }: {
  provider: Provider | null;
  onSave: (data: any) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { showToast: toast } = useApp() as any;
  const [name, setName] = useState(provider?.name || '');
  const [endpoints, setEndpoints] = useState<ProviderEndpoint[]>(
    (provider?.endpoints || (provider ? [{ type: provider.type, baseUrl: provider.baseUrl }] : [createOpenAIEndpoint()])).map(normalizeEndpoint)
  );
  const [models, setModels] = useState<ProviderModel[]>(
    provider?.models?.map(m => ({ ...m })) || []
  );
  const [vaultKey, setVaultKey] = useState(provider?.vaultKey || '');
  const [authMode, setAuthMode] = useState<'api_key' | 'oauth' | 'both' | 'none'>(
    (provider?.authMode as any) || 'api_key'
  );
  const [showVaultPicker, setShowVaultPicker] = useState(false);
  const [pulling, setPulling] = useState(false);

  function addEndpoint() {
    setEndpoints([...endpoints, createOpenAIEndpoint()]);
  }

  function removeEndpoint(i: number) {
    if (endpoints.length <= 1) return;
    setEndpoints(endpoints.filter((_, idx) => idx !== i));
  }

  function updateEndpoint(i: number, field: keyof ProviderEndpoint, value: string) {
    const next = [...endpoints];
    const updated = { ...next[i], [field]: value };
    if (field === 'type') {
      if (value === 'openai') updated.protocol = updated.protocol || 'chat';
      else delete updated.protocol;
    }
    next[i] = normalizeEndpoint(updated as ProviderEndpoint);
    setEndpoints(next);
  }

  function addModel() {
    setModels([...models, { id: '', name: '' }]);
  }

  function removeModel(i: number) {
    setModels(models.filter((_, idx) => idx !== i));
  }

  function updateModel(i: number, field: keyof ProviderModel, value: string) {
    const next = [...models];
    next[i] = { ...next[i], [field]: value || undefined };
    setModels(next);
  }

  async function handlePullModels() {
    const validEndpoints = endpoints.map(normalizeEndpoint).filter(ep => ep.baseUrl.trim());
    if (validEndpoints.length === 0 || (authMode !== 'oauth' && !vaultKey)) {
      toast(t('models.fetchFirst'), 'error');
      return;
    }
    setPulling(true);
    try {
      // 先临时保存（如果是新平台）以获取 ID 用于 fetchModels
      let targetId = provider?.id;
      if (!targetId) {
        targetId = name.toLowerCase().replace(/\s+/g, '-');
        await createProvider({
          id: targetId,
          name: name || targetId,
          type: validEndpoints[0].type,
          baseUrl: validEndpoints[0].baseUrl,
          endpoints: validEndpoints,
          vaultKey: vaultKey || undefined,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          authMode: authMode as any,
          models: [],
        });
      }
      const res = await fetchModels(targetId);
      if (res.success && res.models) {
        setModels(res.models.map(m => ({ id: m.id, name: m.name || m.id })));
        toast(t('models.synced', { n: res.models.length }), 'success');
      } else if (res.kept) {
        setModels(res.kept.map(m => ({ id: m.id, name: m.name || m.id })));
        toast(t('models.syncKept', { n: res.kept.length }), 'info');
      } else {
        toast(t('models.syncFailed'), 'error');
      }
    } catch (err: any) {
      toast(err.message || t('models.syncFailed'), 'error');
    } finally {
      setPulling(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validModels = models.filter(m => m.id.trim());
    const validEndpoints = endpoints.map(normalizeEndpoint).filter(ep => ep.baseUrl.trim());
    const primary = validEndpoints[0] || normalizeEndpoint(endpoints[0]);

    onSave({
      id: provider?.id || name.toLowerCase().replace(/\s+/g, '-'),
      name,
      type: primary.type,
      baseUrl: primary.baseUrl,
      endpoints: validEndpoints,
      models: validModels,
      vaultKey: vaultKey.trim() || undefined,
      authMode,
    });
  }

  return (
    <>
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel modal-panel--wide provider-form-panel" onClick={e => e.stopPropagation()}>
        <div className="modal-panel-header">
          <h2>{provider ? t('models.editPlatform') : t('models.newPlatform')}</h2>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-panel-body provider-form-body">
            <section className="form-section">
              <h4>{t('models.basicSection')}</h4>
              <div className="form-group">
                <label>{t('common.name')}</label>
                <input className="vault-input" value={name} onChange={e => setName(e.target.value)} required disabled={!!provider} />
              </div>
              <div className="form-group">
                <label>{t('models.authMode')}</label>
                <div className="auth-mode-options">
                  {AUTH_MODE_OPTIONS.map(opt => (
                    <label key={opt.value} className={`auth-mode-option${authMode === opt.value ? ' auth-mode-option--active' : ''}`}>
                      <input
                        type="radio"
                        name="authMode"
                        value={opt.value}
                        checked={authMode === opt.value}
                        onChange={() => setAuthMode(opt.value)}
                      />
                      <span>{t(opt.labelKey)}</span>
                    </label>
                  ))}
                </div>
              </div>
            </section>

            <section className="form-section">
              <h4>{t('models.endpointsSection')}</h4>
              <div className="endpoint-list">
                {endpoints.map((ep, i) => (
                  <div key={i} className="endpoint-row">
                    <CustomSelect
                      className="endpoint-type-select"
                      value={ep.type}
                      onChange={v => updateEndpoint(i, 'type', v)}
                      options={TYPE_OPTIONS}
                    />
                    {ep.type === 'openai' && (
                      <CustomSelect
                        className="endpoint-protocol-select"
                        value={ep.protocol || 'chat'}
                        onChange={v => updateEndpoint(i, 'protocol', v)}
                        options={OPENAI_PROTOCOL_OPTIONS}
                      />
                    )}
                    <input className="vault-input endpoint-url-input" value={ep.baseUrl} onChange={e => updateEndpoint(i, 'baseUrl', e.target.value)} placeholder="https://api.example.com" required />
                    {endpoints.length > 1 && (
                      <button type="button" className="endpoint-remove-btn" onClick={() => removeEndpoint(i)}>×</button>
                    )}
                  </div>
                ))}
                <button type="button" className="model-add-btn" onClick={addEndpoint}>{t('models.addEndpoint')}</button>
              </div>
            </section>

            {(authMode === 'api_key' || authMode === 'both') && (
              <section className="form-section">
                <h4>{t('models.authSection')}</h4>
                <div className="form-group provider-secret-field settings-workspace settings-workspace--light">
                  <div className="settings-field--secret">
                    <label>API Key</label>
                    <div className="vault-ref-field">
                      {vaultKey ? (
                        <div className="vault-ref-selected">
                          <span className="vault-ref-key">{vaultKey}</span>
                          <button type="button" className="vault-ref-clear" onClick={() => setVaultKey('')}>×</button>
                          <button type="button" className="vault-ref-change" onClick={() => setShowVaultPicker(true)}>{t('common.replace')}</button>
                        </div>
                      ) : (
                        <button type="button" className="vault-ref-trigger" onClick={() => setShowVaultPicker(true)}>{t('models.selectFromVault')}</button>
                      )}
                    </div>
                  </div>
                </div>
              </section>
            )}

            <section className="form-section">
              <h4>{t('models.modelsSection')}</h4>
              <button type="button" className="vault-toolbar-btn models-pull-btn" onClick={handlePullModels} disabled={pulling}>
                {pulling ? t('models.pulling') : t('models.pullAndFill')}
              </button>
              <div className="model-form-list">
                {models.length === 0 ? (
                  <div className="model-form-empty">{t('common.notConfigured')}</div>
                ) : (
                  models.map((m, i) => (
                    <div key={i} className="model-form-row">
                      <input className="vault-input model-form-id" value={m.id} onChange={e => updateModel(i, 'id', e.target.value)} placeholder={t('models.modelId')} />
                      <input className="vault-input model-form-name" value={m.name || ''} onChange={e => updateModel(i, 'name', e.target.value)} placeholder={t('models.displayName')} />
                      <button type="button" className="endpoint-remove-btn" onClick={() => removeModel(i)}>×</button>
                    </div>
                  ))
                )}
                <button type="button" className="model-add-btn" onClick={addModel}>{t('models.addModel')}</button>
              </div>
            </section>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn-cancel" onClick={onClose}>{t('common.cancel')}</button>
            <button type="submit" className="btn-save">{t('common.save')}</button>
          </div>
        </form>
      </div>
    </div>

    {showVaultPicker && (
      <div className="settings-workspace settings-workspace--light">
      <VaultPickerModal
        selected={vaultKey}
        onSelect={key => { setVaultKey(key); setShowVaultPicker(false); }}
        onClose={() => setShowVaultPicker(false)}
        testEndpoint={endpoints[0]?.baseUrl ? { baseUrl: endpoints[0].baseUrl, type: endpoints[0].type, protocol: endpointProtocol(endpoints[0]) } : undefined}
      />
      </div>
    )}
    </>
  );
}