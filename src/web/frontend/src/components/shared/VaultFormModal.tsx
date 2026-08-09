import { useEffect, useState } from 'react';
import { getVaultValue, setVault, type VaultSecret } from '../../api/vault';
import { api } from '../../api/client';
import { useI18n } from '../../i18n';
import CustomSelect from './CustomSelect';

interface VaultFormModalProps {
  groups: string[];
  initialSecret?: VaultSecret;
  initialAlias?: string;
  onBeforeSave?: (next: { key: string; alias: string; group?: string }) => Promise<boolean>;
  onClose: () => void;
  onSaved: (key: string) => void;
}

const AUTO_PLATFORMS = [
  { value: 'cloudflare', label: 'Cloudflare', keyHint: 'CLOUDFLARE_TOKEN', groupHint: 'Cloudflare', mode: 'api' as const },
  { value: 'volcengine', label: '火山引擎', keyHint: 'VOLCENGINE_KEY', groupHint: '火山引擎', mode: 'browser' as const },
  { value: 'zhipu', label: '智谱AI', keyHint: 'ZHIPU_KEY', groupHint: '智谱AI', mode: 'browser' as const },
  { value: 'minimax', label: 'MiniMax', keyHint: 'MINIMAX_KEY', groupHint: 'MiniMax', mode: 'browser' as const },
];

export default function VaultFormModal({ groups, initialSecret, initialAlias, onBeforeSave, onClose, onSaved }: VaultFormModalProps) {
  const { t } = useI18n();
  const isEdit = !!initialSecret;
  const activeAlias = initialAlias || initialSecret?.aliases[0]?.alias || 'default';
  const activeAliasMeta = initialSecret?.aliases.find(a => a.alias === activeAlias) || initialSecret?.aliases[0];
  const initialGroup = activeAliasMeta?.group || initialSecret?.group || '';
  const [formKey, setFormKey] = useState(initialSecret?.key || '');
  const [formValue, setFormValue] = useState('');
  const [formGroup, setFormGroup] = useState(initialGroup && groups.includes(initialGroup) ? initialGroup : (initialGroup ? '__custom__' : ''));
  const [formGroupCustom, setFormGroupCustom] = useState(initialGroup && groups.includes(initialGroup) ? '' : initialGroup);
  const [showValue, setShowValue] = useState(false);
  const [loadingValue, setLoadingValue] = useState(isEdit);
  const [saving, setSaving] = useState(false);

  // Auto-create state
  const [showAutoCreate, setShowAutoCreate] = useState(false);
  const [autoPlatform, setAutoPlatform] = useState('');
  const [autoCreating, setAutoCreating] = useState(false);
  const [autoError, setAutoError] = useState('');
  const [parentToken, setParentToken] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!initialSecret) return;

    setLoadingValue(true);
    getVaultValue(initialSecret.key)
      .then(data => {
        if (!cancelled) setFormValue(data.value);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingValue(false);
      });

    return () => { cancelled = true; };
  }, [initialSecret?.key, activeAlias]);

  async function handleSave() {
    if (!formKey || !formValue) return;
    const group = formGroup === '__custom__' ? formGroupCustom : formGroup;
    if (onBeforeSave && !(await onBeforeSave({ key: formKey, alias: 'default', group: group || undefined }))) return;

    setSaving(true);
    try {
      await setVault({
        key: formKey,
        value: formValue,
        group: group || undefined,
        originalKey: initialSecret?.key,
      });
      onSaved(formKey);
    } catch {
      onSaved('');
    } finally {
      setSaving(false);
    }
  }

  async function handleAutoCreate() {
    if (!autoPlatform) return;
    setAutoCreating(true);
    setAutoError('');
    try {
      const platform = AUTO_PLATFORMS.find(p => p.value === autoPlatform)!;
      const tokenName = formKey || platform.keyHint;

      const body: any = { platform: autoPlatform, tokenName };
      if (platform.mode === 'api') {
        if (!parentToken.trim()) {
          setAutoError(t('vault.autoCreateParentTokenRequired') || '请提供父级 API Token');
          setAutoCreating(false);
          return;
        }
        body.parentToken = parentToken.trim();
      }

      const result = await api('/api/vault/auto-create', {
        method: 'POST',
        body: JSON.stringify(body),
      }) as any;

      if (result.success) {
        // Auto-fill the form — use the name from the API response (may include
        // a uniqueness suffix like "ZHIPU_KEY-x7k2" that matches the platform)
        setFormKey(result.name || tokenName);
        setFormValue(result.value);
        if (platform.groupHint && !formGroup) {
          // Check if group already exists in groups list
          if (groups.includes(platform.groupHint)) {
            setFormGroup(platform.groupHint);
          } else {
            setFormGroup('__custom__');
            setFormGroupCustom(platform.groupHint);
          }
        }
        setShowAutoCreate(false);
        setAutoPlatform('');
        setParentToken('');
      } else {
        setAutoError(result.error || t('vault.autoCreateFailed'));
      }
    } catch (err: any) {
      setAutoError(err.message || t('vault.autoCreateFailed'));
    } finally {
      setAutoCreating(false);
    }
  }

  const selectedPlatform = AUTO_PLATFORMS.find(p => p.value === autoPlatform);

  return (
    <div className="auth-overlay" style={{ display: '' }}>
      <div className="vault-form-panel">
        <div className="progress-header">
          <span className="progress-title">{isEdit ? t('vault.editKey') : t('vault.newKey')}</span>
          <button className="progress-close" onClick={onClose}>&times;</button>
        </div>
        <div className="vault-form-body">
          {/* Auto-create section (only for new keys, not edit) */}
          {!isEdit && (
            <div className="vault-auto-create-section">
              {!showAutoCreate ? (
                <button
                  className="vault-auto-create-trigger"
                  onClick={() => setShowAutoCreate(true)}
                  type="button"
                >
                  ⚡ {t('vault.autoCreate') || '自动创建密钥'}
                </button>
              ) : (
                <div className="vault-auto-create-panel">
                  <div className="vault-auto-create-header">
                    <span>{t('vault.autoCreateTitle') || '自动创建密钥'}</span>
                    <button className="vault-auto-create-close" onClick={() => { setShowAutoCreate(false); setAutoError(''); }} type="button">&times;</button>
                  </div>
                  <div className="vault-form-field">
                    <label>{t('vault.autoCreatePlatform') || '选择平台'}</label>
                    <CustomSelect
                      value={autoPlatform}
                      onChange={v => { setAutoPlatform(v); setAutoError(''); }}
                      placeholder={t('vault.autoCreateSelectPlatform') || '选择平台...'}
                      options={AUTO_PLATFORMS.map(p => ({
                        value: p.value,
                        label: `${p.label}${p.mode === 'api' ? ' (API)' : ' (浏览器)'}`,
                      }))}
                    />
                  </div>
                  {selectedPlatform?.mode === 'api' && (
                    <div className="vault-form-field">
                      <label>{t('vault.autoCreateParentToken') || '父级 API Token'}</label>
                      <input
                        type="password"
                        className="vault-input"
                        placeholder={t('vault.autoCreateParentTokenHint') || '用于创建子 Token 的父级凭证'}
                        value={parentToken}
                        onChange={e => setParentToken(e.target.value)}
                      />
                      <p style={{ fontSize: '11px', color: 'var(--ink-muted)', marginTop: '4px' }}>
                        使用 Cloudflare Global API Key 或已有的 API Token（需含 API Tokens Write 权限）
                      </p>
                    </div>
                  )}
                  {selectedPlatform?.mode === 'browser' && (
                    <p className="vault-auto-create-hint">
                      {t('vault.autoCreateBrowserHint') || '将打开浏览器窗口自动创建密钥。请确保你已在对应平台登录。'}
                    </p>
                  )}
                  {autoError && <p className="vault-auto-create-error">{autoError}</p>}
                  <div className="vault-auto-create-actions">
                    <button className="btn-cancel" onClick={() => { setShowAutoCreate(false); setAutoError(''); }} type="button">
                      {t('common.cancel')}
                    </button>
                    <button
                      className="btn-save"
                      onClick={handleAutoCreate}
                      disabled={autoCreating || !autoPlatform}
                      type="button"
                    >
                      {autoCreating ? t('vault.autoCreating') || '创建中...' : t('vault.autoCreateStart') || '开始创建'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="vault-form-field">
            <label>Key</label>
            <input type="text" className="vault-input" placeholder={t('vault.keyExample')} value={formKey}
              onChange={e => setFormKey(e.target.value)} />
          </div>
          <div className="vault-form-field">
            <label>{t('common.group')}</label>
            <CustomSelect
              value={formGroup}
              onChange={v => setFormGroup(v)}
              placeholder={t('common.selectGroup')}
              options={[
                ...groups.map(g => ({ value: g, label: g })),
                { value: '__custom__', label: t('common.manualInput') },
              ]}
            />
            {formGroup === '__custom__' && (
              <input type="text" className="vault-input" style={{ marginTop: 4 }} placeholder={t('common.enterGroup')} value={formGroupCustom} onChange={e => setFormGroupCustom(e.target.value)} />
            )}
          </div>
          <div className="vault-form-field vault-form-field--value">
            <label>Value</label>
            <input type={showValue ? 'text' : 'password'} className="vault-input" placeholder={loadingValue ? t('common.loading') : t('vault.keyValue')} value={formValue} onChange={e => setFormValue(e.target.value)} disabled={loadingValue} />
            <button type="button" className="btn-toggle-vis" onClick={() => setShowValue(!showValue)}>{showValue ? t('common.hide') : t('common.show')}</button>
          </div>
        </div>
        <div className="vault-form-actions">
          <button className="btn-cancel" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn-save" onClick={handleSave} disabled={saving || loadingValue || !formKey || !formValue}>{saving ? t('common.saving') : t('common.save')}</button>
        </div>
      </div>
    </div>
  );
}
