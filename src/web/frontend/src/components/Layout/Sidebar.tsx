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

const WORKSPACE_ITEMS = [
  { path: '/', labelKey: 'nav.home', icon: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <rect x="2" y="2" width="14" height="14" rx="2" />
      <path d="M5 6h3M10 6h3M5 10h8M5 13h5" />
    </svg>
  )},
  { path: '/agent', labelKey: 'nav.ai', hasConvList: true, icon: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M14 9c0 3.3-2.5 6-5.5 6-.9 0-1.7-.2-2.5-.5L3 16l1-3C3.4 11.7 3 10.4 3 9c0-3.3 2.5-6 5.5-6S14 5.7 14 9z" fill="currentColor" fillOpacity="0.15" />
      <circle cx="6.5" cy="8.5" r="0.8" fill="currentColor"/>
      <circle cx="9" cy="8.5" r="0.8" fill="currentColor"/>
      <circle cx="11.5" cy="8.5" r="0.8" fill="currentColor"/>
    </svg>
  )},
];

const TOOL_ITEMS = [
  { path: '/tools', labelKey: 'nav.tools', icon: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <rect x="2" y="2" width="14" height="14" rx="2" />
      <path d="M6 6h6M6 9h4M6 12h5" />
    </svg>
  )},
  { path: '/vault', labelKey: 'nav.vault', icon: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <rect x="3" y="8" width="12" height="8" rx="1.5" />
      <path d="M6 8V5.5a3 3 0 016 0V8" />
    </svg>
  )},
  { path: '/models', labelKey: 'nav.models', icon: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M9 2l7 4v6l-7 4-7-4V6z" />
      <path d="M9 8l7-4M9 8v8M9 8L2 4" />
    </svg>
  )},
  { path: '/agents', labelKey: 'nav.agents', icon: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <rect x="2" y="2" width="6" height="6" rx="1" />
      <rect x="10" y="2" width="6" height="6" rx="1" />
      <rect x="2" y="10" width="6" height="6" rx="1" />
      <rect x="10" y="10" width="6" height="6" rx="1" />
    </svg>
  )},
  { path: '/auth', labelKey: 'nav.auth', icon: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M9 2v3M9 13v3M3 9h3M12 9h3M4.5 4.5l2 2M11.5 11.5l2 2M13.5 4.5l-2 2M6.5 11.5l-2 2" />
      <circle cx="9" cy="9" r="2" />
    </svg>
  )},
];

const SYSTEM_ITEMS = [
  { path: '/logs', labelKey: 'nav.logs', icon: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <rect x="3" y="2" width="12" height="14" rx="1.5" />
      <path d="M6 5h6M6 8h6M6 11h3" />
    </svg>
  )},
  { path: '/monitor', labelKey: 'nav.monitor', icon: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M2 12l4-4 3 3 3-5 4 6" />
      <rect x="1" y="1" width="16" height="16" rx="2" />
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
      <div className="sidebar-brand" onClick={toggleSidebar} style={{ cursor: 'pointer' }}>
        <div className="brand-shape" />
        <span className="brand-text">OKIT</span>
        <span className="brand-hand">Access Layer</span>
      </div>
      <div className="sidebar-cut" />
      <div className="nav-scroll">
        {NAV_SECTIONS.map(section => (
          <div className="nav-section" key={section.labelKey}>
            {!collapsed && <div className="nav-section-label">{t(section.labelKey)}</div>}
            {section.items.map(renderNavItem)}
          </div>
        ))}
      </div>
      <div className="sidebar-bottom">
        <button className="sidebar-bottom-icon" onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')} title={t('nav.language')}>
          <span style={{ fontSize: 11, fontWeight: 700 }}>{lang === 'zh' ? '中' : 'EN'}</span>
        </button>
        <NavLink to="/settings" className={({ isActive }) => `sidebar-bottom-icon${isActive ? ' active' : ''}`} title={t('nav.settings')}>
          <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="9" cy="9" r="2.5" />
            <path d="M9 1.5v2M9 14.5v2M1.5 9h2M14.5 9h2M3.7 3.7l1.4 1.4M12.9 12.9l1.4 1.4M14.3 3.7l-1.4 1.4M5.1 12.9l-1.4 1.4" />
          </svg>
        </NavLink>
      </div>
    </aside>
  );
}
