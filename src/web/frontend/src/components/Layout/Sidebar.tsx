import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from './AppContext';
import { useI18n } from '../../i18n';
import { listConversations, createConversation, deleteConversation } from '../../api/agent';
import { useEffect, useState } from 'react';

interface ConvItem {
  id: string;
  title: string;
  updatedAt?: number;
}

const ic = "1.5";
const SW = { strokeWidth: ic, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

const WORKSPACE_ITEMS = [
  { path: '/', labelKey: 'nav.home', icon: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" {...SW}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
      <path d="M9.5 21v-6h5v6" />
    </svg>
  )},
  { path: '/agent', labelKey: 'nav.ai', hasConvList: true, icon: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" {...SW}>
      <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.6-.8L3 21l1.3-5.4A8.38 8.38 0 0 1 3.5 11.5a8.5 8.5 0 0 1 17 0z" />
      <circle cx="8.5" cy="11.5" r="0.6" fill="currentColor" />
      <circle cx="12" cy="11.5" r="0.6" fill="currentColor" />
      <circle cx="15.5" cy="11.5" r="0.6" fill="currentColor" />
    </svg>
  )},
];

const TOOL_ITEMS = [
  { path: '/vault', labelKey: 'nav.vault', icon: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" {...SW}>
      <path d="M12 2 4 5v6c0 5 3.5 9.5 8 11 4.5-1.5 8-6 8-11V5l-8-3z" />
      <rect x="9.5" y="10.5" width="5" height="5" rx="0.5" />
      <path d="M11 10.5V9a1 1 0 0 1 2 0v1.5" />
    </svg>
  )},
  { path: '/models', labelKey: 'nav.models', icon: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" {...SW}>
      <path d="M12 2 3 7v10l9 5 9-5V7l-9-5z" />
      <path d="M3 7l9 5 9-5" />
      <path d="M12 12v10" />
    </svg>
  )},
  { path: '/usage', labelKey: 'nav.usage', icon: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" {...SW}>
      <path d="M5 20V10M12 20V4M19 20v-7" />
    </svg>
  )},
];

const SYSTEM_ITEMS = [
  { path: '/logs', labelKey: 'nav.logs', icon: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" {...SW}>
      <path d="M4 5h16v14H4z" />
      <path d="M7 9l3 3-3 3M13 15h4" />
    </svg>
  )},
  { path: '/monitor', labelKey: 'nav.monitor', icon: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" {...SW}>
      <path d="M3 12h4l2-6 4 12 2-6h6" />
    </svg>
  )},
];

const NAV_SECTIONS = [
  { labelKey: 'nav.workspace', items: WORKSPACE_ITEMS },
  { labelKey: 'nav.toolsSection', items: TOOL_ITEMS },
  { labelKey: 'nav.system', items: SYSTEM_ITEMS },
];

export default function Sidebar({ collapsed }: { collapsed: boolean }) {
  const { toggleSidebar, currentConvId, setCurrentConvId } = useApp() as any;
  const { t, lang, setLang } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const [convList, setConvList] = useState<ConvItem[]>([]);

  const isAgentActive = location.pathname === '/agent';

  useEffect(() => {
    if (isAgentActive) loadConvList();
  }, [isAgentActive]);

  async function loadConvList() {
    try {
      const list = await listConversations();
      setConvList(list);
    } catch {}
  }

  async function handleNewConv() {
    try {
      const conv = await createConversation();
      setConvList(prev => [conv, ...prev]);
      setCurrentConvId(conv.id);
      navigate('/agent');
    } catch {}
  }

  async function handleSwitchConv(id: string) {
    setCurrentConvId(id);
    navigate('/agent');
  }

  async function handleDeleteConv(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    try {
      await deleteConversation(id);
      const newList = convList.filter(c => c.id !== id);
      setConvList(newList);
      if (currentConvId === id) {
        if (newList.length > 0) setCurrentConvId(newList[0].id);
        else {
          const conv = await createConversation();
          setConvList([conv]);
          setCurrentConvId(conv.id);
        }
      }
    } catch {}
  }

  function renderNavItem(item: typeof WORKSPACE_ITEMS[number] | typeof TOOL_ITEMS[number] | typeof SYSTEM_ITEMS[number]) {
    return (
      <div key={item.path}>
        <NavLink to={item.path} end={item.path === '/'} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          {item.icon}
          <span>{t(item.labelKey)}</span>
          {(item as any).hasConvList && !collapsed && (
            <button className="nav-new-btn" onClick={e => { e.stopPropagation(); e.preventDefault(); handleNewConv(); }} title={t('nav.newChat')}>
              <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M9 3v12M3 9h12" /></svg>
            </button>
          )}
        </NavLink>
        {(item as any).hasConvList && isAgentActive && !collapsed && (
          <div className="nav-sub-list expanded">
            {convList.length === 0 && <div style={{ padding: '6px 20px 6px 46px', color: 'var(--ink-muted)', fontSize: 11 }}>{t('nav.noChat')}</div>}
            {convList.map(c => (
              <div key={c.id} className={`nav-conv-item${c.id === currentConvId ? ' active' : ''}`} onClick={() => handleSwitchConv(c.id)}>
                <span className="conv-title">{c.title || t('nav.newChat')}</span>
                <button className="nav-conv-delete" onClick={e => handleDeleteConv(c.id, e)} title={t('common.delete')}>
                  <svg width="10" height="10" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h12M5 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6v9a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2V6" /></svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}`}>
      <div className="sidebar-cut" />
      <div className="sidebar-brand">
        <img className="sidebar-brand-logo" src="/okit-icon.png" alt="" />
        <span className="sidebar-brand-name">OKIT</span>
      </div>
      <div className="nav-scroll">
        {NAV_SECTIONS.map(section => (
          <div className="nav-section" key={section.labelKey}>
            {section.items.map(renderNavItem)}
          </div>
        ))}
      </div>
      <div className="sidebar-bottom">
        <button className="sidebar-bottom-icon" onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')} title={t('nav.language')}>
          <span style={{ fontSize: 11, fontWeight: 700 }}>{lang === 'zh' ? '中' : 'EN'}</span>
        </button>
        <NavLink to="/settings" className={({ isActive }) => `sidebar-bottom-icon${isActive ? ' active' : ''}`} title={t('nav.settings')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h7M15 18h5" />
            <circle cx="16" cy="6" r="2" />
            <circle cx="8" cy="12" r="2" />
            <circle cx="13" cy="18" r="2" />
          </svg>
        </NavLink>
      </div>
    </aside>
  );
}
