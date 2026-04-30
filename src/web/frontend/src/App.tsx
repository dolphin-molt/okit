import { Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/Layout/Sidebar';
import { useApp } from './components/Layout/AppContext';
import ToolsPage from './components/tools/ToolsPage';
import VaultPage from './components/vault/VaultPage';
import AuthPage from './components/auth/AuthPage';
import LogsPage from './components/logs/LogsPage';
import MonitorPage from './components/monitor/MonitorPage';
import AgentPage from './components/agent/AgentPage';
import SettingsPage from './components/settings/SettingsPage';
import OnboardingPage from './components/onboarding/OnboardingPage';
import ModelsPage from './components/models/ModelsPage';
import AgentsPage from './components/agents/AgentsPage';
import LandingPage from './components/landing/LandingPage';
import HomePage from './components/home/HomePage';

export default function App() {
  const { sidebarCollapsed } = useApp();

  return (
    <Routes>
      <Route path="/landing" element={<LandingPage />} />
      <Route path="*" element={
        <div id="app">
          <Sidebar collapsed={sidebarCollapsed} />
          <main className={`main-content${sidebarCollapsed ? ' main-content--expanded' : ''}`}>
            <div className="tab-content">
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/onboarding" element={<OnboardingPage />} />
                <Route path="/tools" element={<ToolsPage />} />
                <Route path="/vault" element={<VaultPage />} />
                <Route path="/auth" element={<AuthPage />} />
                <Route path="/models" element={<ModelsPage />} />
                <Route path="/agents" element={<AgentsPage />} />
                <Route path="/logs" element={<LogsPage />} />
                <Route path="/monitor" element={<MonitorPage />} />
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
