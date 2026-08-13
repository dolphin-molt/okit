import { Routes, Route, Navigate, useSearchParams } from 'react-router-dom';
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

export default function App() {
  const { sidebarCollapsed } = useApp();

  return (
    <Routes>
      <Route path="/landing" element={<LandingPage />} />
      <Route path="*" element={
        <div id="app">
          <DeepLinkHandler />
          <Sidebar collapsed={sidebarCollapsed} />
          <main className={`main-content${sidebarCollapsed ? ' main-content--expanded' : ''}`}>
            <div className="tab-content">
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/onboarding" element={<OnboardingPage />} />
                <Route path="/vault" element={<VaultPage />} />
                <Route path="/models" element={<ModelsPage />} />
                <Route path="/usage" element={<UsagePage />} />
                <Route path="/agents" element={<AgentsPage />} />
                <Route path="/agent" element={<AgentPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </div>
          </main>
        </div>
      } />
    </Routes>
  );
}
