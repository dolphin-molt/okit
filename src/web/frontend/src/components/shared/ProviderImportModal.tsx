import { useState, useEffect } from 'react';
import { importProviderCode } from '../../api/providers';
import { useApp } from '../Layout/AppContext';

interface Props {
  code: string;
  onClose: () => void;
  onImported?: () => void;
}

export default function ProviderImportModal({ code, onClose, onImported }: Props) {
  const { showToast } = useApp();
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleImport() {
    setLoading(true);
    try {
      const result = await importProviderCode(code, password || undefined);
      showToast(
        result.created
          ? `已导入 Provider: ${result.provider.name}`
          : `已更新 Provider: ${result.provider.name}`,
        'success',
      );
      onImported?.();
      onClose();
    } catch (err: any) {
      showToast(err.message || '导入失败', 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-overlay" style={{ display: '' }}>
      <div className="preset-panel" style={{ maxWidth: 480 }}>
        <div className="progress-header">
          <span className="progress-title">导入 Provider</span>
          <button className="progress-close" onClick={onClose}>&times;</button>
        </div>
        <div className="preset-body">
          <p style={{ fontSize: 13, color: 'var(--ink-muted)', marginBottom: 16 }}>
            通过 Deep Link 导入 Provider 配置。如果对方设置了密码保护，请输入密码。
          </p>
          <div className="settings-field" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <label style={{ minWidth: 'auto', fontSize: 13, fontWeight: 600 }}>密码（可选）</label>
            <input
              type="password"
              className="settings-input"
              style={{ width: '100%' }}
              placeholder="如果是加密的 Provider 码请输入密码"
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button className="btn-outline" onClick={onClose} style={{ flex: 1 }}>取消</button>
            <button className="btn-primary" onClick={handleImport} disabled={loading} style={{ flex: 1 }}>
              {loading ? '导入中...' : '导入'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
