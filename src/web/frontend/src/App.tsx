import { Routes, Route, Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { useState, useEffect } from 'react';
import Sidebar from './components/Layout/Sidebar';
import { useApp } from './components/Layout/AppContext';
import VaultPage from './components/vault/VaultPage';
import AgentPage from './components/agent/AgentPage';
import SettingsPage from './components/settings/SettingsPage';
import OnboardingPage from './components/onboarding/OnboardingPage';
import ModelsPage from './components/models/ModelsPage';
import UsagePage from './components/usage/UsagePage';
import AgentsPage from './components/agents/AgentsPage';
import LandingPage from './components/landing/LandingPage';
import ManualPage from './components/landing/ManualPage';
import HomePage from './components/home/HomePage';
import ProviderImportModal from './components/shared/ProviderImportModal';

function DeepLinkHandler() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [importCode, setImportCode] = useState<string | null>(null);

  useEffect(() => {
    const kind = searchParams.get('import');
    const code = searchParams.get('code');
    if (kind === 'provider' && code) {
      setImportCode(code);
      // Clean URL after capturing the code
      searchParams.delete('import');
      searchParams.delete('code');
      setSearchParams(searchParams, { replace: true });
    }
  }, []);

  if (!importCode) return null;

  return (
    <ProviderImportModal
      code={importCode}
      onClose={() => setImportCode(null)}
      onImported={() => { /* provider list will refresh on next page load */ }}
    />
  );
}

/**
 * Keep the frequently revisited pages mounted after their first visit.
 * Switching between routes then changes visibility instead of throwing away
 * their fetched data, scroll position, and local UI state.
 */
function PersistentDashboardRoutes() {
  const location = useLocation();
  const pathname = location.pathname;
  const [visited, setVisited] = useState(() => new Set([pathname]));

  useEffect(() => {
    setVisited(prev => prev.has(pathname) ? prev : new Set(prev).add(pathname));
  }, [pathname]);

  const keepAlivePaths = ['/', '/usage', '/models', '/vault'];
  const isActive = (p: string) => pathname === p;
  // Mount the active page immediately on first navigation; the effect above
  // records it for future switches without introducing a blank frame.
  const wasVisited = (p: string) => visited.has(p) || isActive(p);

  const keepAliveActive = keepAlivePaths.some(isActive);

  return (
    <>
      {wasVisited('/') && (
        <div className="route-keepalive" hidden={!isActive('/')} aria-hidden={!isActive('/')}>
          <HomePage />
        </div>
      )}
      {wasVisited('/usage') && (
        <div className="route-keepalive" hidden={!isActive('/usage')} aria-hidden={!isActive('/usage')}>
          <UsagePage />
        </div>
      )}
      {wasVisited('/models') && (
        <div className="route-keepalive" hidden={!isActive('/models')} aria-hidden={!isActive('/models')}>
          <ModelsPage />
        </div>
      )}
      {wasVisited('/vault') && (
        <div className="route-keepalive" hidden={!isActive('/vault')} aria-hidden={!isActive('/vault')}>
          <VaultPage />
        </div>
      )}
      {!keepAliveActive && (
        <Routes>
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/vault" element={<VaultPage />} />
          <Route path="/models" element={<ModelsPage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/agent" element={<AgentPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      )}
    </>
  );
}

export default function App() {
  const { sidebarCollapsed } = useApp();

  return (
    <Routes>
      <Route path="/landing" element={<LandingPage />} />
      <Route path="/manual" element={<ManualPage />} />
      <Route path="*" element={
        <div id="app">
          <DeepLinkHandler />
          <Sidebar collapsed={sidebarCollapsed} />
            <main className={`main-content${sidebarCollapsed ? ' main-content--expanded' : ''}`}>
            <div className="tab-content">
              <PersistentDashboardRoutes />
            </div>
          </main>
        </div>
      } />
    </Routes>
  );
}
