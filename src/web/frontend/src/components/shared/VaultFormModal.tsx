import { useEffect, useState } from 'react';
import { getVaultValue, listAutoCreatePlatforms, setVault, type AutoCreatePlatform, type VaultSecret } from '../../api/vault';
import { apiRaw } from '../../api/client';
import { useI18n } from '../../i18n';
import CustomSelect from './CustomSelect';
import { PREDEFINED_GROUPS } from '../../data/vault-groups';

interface VaultFormModalProps {
  groups: string[];
  initialSecret?: VaultSecret;
  initialAlias?: string;
  onBeforeSave?: (next: { key: string; alias: string; group?: string }) => Promise<boolean>;
  onClose: () => void;
  onSaved: (key: string) => void;
}

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
  const [autoNotice, setAutoNotice] = useState('');
  const [loginHandoff, setLoginHandoff] = useState<{ platformLabel: string; browserFocused: boolean; loginUrl?: string } | null>(null);
  const [parentToken, setParentToken] = useState('');
  const [autoPlatforms, setAutoPlatforms] = useState<AutoCreatePlatform[]>([]);
  const [loadingPlatforms, setLoadingPlatforms] = useState(false);

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

  useEffect(() => {
    if (!showAutoCreate || isEdit || autoPlatforms.length) return;
    let cancelled = false;
    setLoadingPlatforms(true);
    listAutoCreatePlatforms()
      .then(({ platforms }) => { if (!cancelled) setAutoPlatforms(platforms); })
      .catch((err: Error) => { if (!cancelled) setAutoError(err.message || t('vault.autoCreateFailed')); })
      .finally(() => { if (!cancelled) setLoadingPlatforms(false); });
    return () => { cancelled = true; };
  }, [showAutoCreate, isEdit, autoPlatforms.length, t]);

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
    setAutoNotice('');
    setLoginHandoff(null);
    try {
      const platform = autoPlatforms.find(p => p.id === autoPlatform)!;
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

      const response = await apiRaw('/api/vault/auto-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await response.json() as any;

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
        if (Number(result.readyAfterMs) > 0) {
          setAutoNotice(`密钥已创建。该平台正在生效，请等待约 ${Math.ceil(Number(result.readyAfterMs) / 1000)} 秒后再测试连接。`);
        }
      } else if (result.loginRequired) {
        setLoginHandoff({
          platformLabel: platform.label,
          browserFocused: Boolean(result.browserFocused),
          loginUrl: result.loginUrl,
        });
      } else {
        setAutoError(result.error || t('vault.autoCreateFailed'));
      }
    } catch (err: any) {
      setAutoError(err.message || t('vault.autoCreateFailed'));
    } finally {
      setAutoCreating(false);
    }
  }

  const selectedPlatform = autoPlatforms.find(p => p.id === autoPlatform);

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
                    <button className="vault-auto-create-close" onClick={() => { setShowAutoCreate(false); setAutoError(''); setLoginHandoff(null); }} type="button">&times;</button>
                  </div>
                  <div className="vault-form-field">
                    <label>{t('vault.autoCreatePlatform') || '选择平台'}</label>
                    <CustomSelect
                      value={autoPlatform}
                      onChange={v => { setAutoPlatform(v); setAutoError(''); setLoginHandoff(null); }}
                      placeholder={t('vault.autoCreateSelectPlatform') || '选择平台...'}
                      options={autoPlatforms.map(p => ({
                        value: p.id,
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
                  {loginHandoff && (
                    <div className="vault-auto-create-login" role="alert">
                      <strong>{t('vault.autoCreateLoginRequired') || '需要登录此平台'}: {loginHandoff.platformLabel}</strong>
                      <p>
                        {loginHandoff.browserFocused
                          ? (t('vault.autoCreateLoginFocused') || '已将自动化浏览器窗口置前。请完成登录后回到这里重试。')
                          : (t('vault.autoCreateLoginOpenBrowser') || '请切换到 Chrome 的 OKIT 自动化窗口完成登录，然后回到这里重试。')}
                      </p>
                      {loginHandoff.loginUrl && <span className="vault-auto-create-login-url">{loginHandoff.loginUrl}</span>}
                      <button className="btn-save" onClick={handleAutoCreate} disabled={autoCreating} type="button">
                        {t('vault.autoCreateRetry') || '登录完成，重试创建'}
                      </button>
                    </div>
                  )}
                  {autoError && <p className="vault-auto-create-error">{autoError}</p>}
                  <div className="vault-auto-create-actions">
                    <button className="btn-cancel" onClick={() => { setShowAutoCreate(false); setAutoError(''); setLoginHandoff(null); }} type="button">
                      {t('common.cancel')}
                    </button>
                    <button
                      className="btn-save"
                      onClick={handleAutoCreate}
                      disabled={autoCreating || loadingPlatforms || !autoPlatform}
                      type="button"
                    >
                      {autoCreating ? t('vault.autoCreating') || '创建中...' : t('vault.autoCreateStart') || '开始创建'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          {autoNotice && <p className="vault-auto-create-notice" role="status">{autoNotice}</p>}

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
                ...PREDEFINED_GROUPS.map(g => ({ value: g, label: g })),
                ...groups.filter(g => !PREDEFINED_GROUPS.includes(g)).map(g => ({ value: g, label: g })),
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
