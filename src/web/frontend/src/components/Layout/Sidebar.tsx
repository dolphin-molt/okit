import { NavLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { KeyRound, Boxes, ChartColumn, Settings, ArrowLeft, Rocket } from 'lucide-react';

const ic = 1.5;

const WORKSPACE_ITEMS = [
  { path: '/', labelKey: 'nav.home', icon: <Rocket size={18} strokeWidth={ic} /> },
];

const TOOL_ITEMS = [
  { path: '/vault', labelKey: 'nav.vault', icon: <KeyRound size={18} strokeWidth={ic} /> },
  { path: '/models', labelKey: 'nav.models', icon: <Boxes size={18} strokeWidth={ic} /> },
  { path: '/usage', labelKey: 'nav.usage', icon: <ChartColumn size={18} strokeWidth={ic} /> },
];

const NAV_SECTIONS = [
  { labelKey: 'nav.workspace', items: WORKSPACE_ITEMS },
  { labelKey: 'nav.toolsSection', items: TOOL_ITEMS },
];

/* 设置页侧边栏锚点，与 SettingsPage 各区块 id 一一对应 */
const SETTINGS_SECTIONS = [
  { id: 'appearance', labelKey: 'settings.appearance' },
  { id: 'sync', labelKey: 'settings.sync2.title' },
  { id: 'snapshots', labelKey: 'settings.snapshots.title' },
  { id: 'diagnostics', labelKey: 'settings.diagnostics' },
];

export default function Sidebar() {
  const location = useLocation();
  const isSettings = location.pathname.startsWith('/settings');
  return isSettings ? <SettingsSidebar /> : <MainSidebar />;
}

/* ─── 主界面：永久收缩的图标栏 ─── */
function MainSidebar() {
  const { t } = useI18n();

  function renderNavItem(item: typeof WORKSPACE_ITEMS[number] | typeof TOOL_ITEMS[number]) {
    return (
      <div key={item.path}>
        <NavLink
          to={item.path}
          end={item.path === '/'}
          data-tip={t(item.labelKey)}
          title={t(item.labelKey)}
          aria-label={t(item.labelKey)}
          className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
        >
          {item.icon}
          <span>{t(item.labelKey)}</span>
        </NavLink>
      </div>
    );
  }

  return (
    <aside className="sidebar sidebar--collapsed">
      <div className="sidebar-brand">
        <img className="sidebar-brand-logo" src="/okit-icon.png" alt="OKIT" />
      </div>
      <div className="nav-scroll">
        {NAV_SECTIONS.map(section => (
          <div className="nav-section" key={section.labelKey}>
            {section.items.map(renderNavItem)}
          </div>
        ))}
      </div>
      <div className="sidebar-bottom">
        <NavLink
          to="/settings"
          data-tip={t('nav.settings')}
          title={t('nav.settings')}
          aria-label={t('nav.settings')}
          className={({ isActive }) => `sidebar-bottom-icon${isActive ? ' active' : ''}`}
        >
          <Settings size={18} strokeWidth={1.5} />
        </NavLink>
      </div>
    </aside>
  );
}

/* ─── 设置界面：区块导航侧边栏 + 左下角返回 ─── */
function SettingsSidebar() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const raw = searchParams.get('section') || 'appearance';
  const current = SETTINGS_SECTIONS.some(s => s.id === raw) ? raw : 'appearance';

  return (
    <aside className="sidebar sidebar--settings">
      <div className="sidebar-settings-nav">
        {SETTINGS_SECTIONS.map(s => (
          <button
            key={s.id}
            type="button"
            className={`sidebar-settings-item${current === s.id ? ' active' : ''}`}
            onClick={() => navigate(`/settings?section=${s.id}`)}
          >
            <span>{t(s.labelKey)}</span>
          </button>
        ))}
      </div>
      <div className="sidebar-settings-bottom">
        <button type="button" className="sidebar-back" onClick={() => navigate('/')}>
          <ArrowLeft size={14} strokeWidth={2} />
          <span>{t('nav.backHome')}</span>
        </button>
      </div>
    </aside>
  );
}