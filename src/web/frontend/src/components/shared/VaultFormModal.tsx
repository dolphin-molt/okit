import { useEffect, useState } from 'react';
import { getVaultValue, setVault, type VaultSecret } from '../../api/vault';
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

export default function VaultFormModal({ groups, initialSecret, initialAlias, onBeforeSave, onClose, onSaved }: VaultFormModalProps) {
  const { t } = useI18n();
  const isEdit = !!initialSecret;
  const activeAlias = initialAlias || initialSecret?.aliases[0]?.alias || 'default';
  const activeAliasMeta = initialSecret?.aliases.find(a => a.alias === activeAlias) || initialSecret?.aliases[0];
  const initialGroup = activeAliasMeta?.group || initialSecret?.group || '';
  const [formKey, setFormKey] = useState(initialSecret?.key || '');
  const [formAlias, setFormAlias] = useState(activeAlias);
  const [formValue, setFormValue] = useState('');
  const [formGroup, setFormGroup] = useState(initialGroup && groups.includes(initialGroup) ? initialGroup : (initialGroup ? '__custom__' : ''));
  const [formGroupCustom, setFormGroupCustom] = useState(initialGroup && groups.includes(initialGroup) ? '' : initialGroup);
  const [showValue, setShowValue] = useState(false);
  const [loadingValue, setLoadingValue] = useState(isEdit);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!initialSecret) return;

    setLoadingValue(true);
    getVaultValue(initialSecret.key, activeAlias)
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
    const alias = formAlias || 'default';
    if (onBeforeSave && !(await onBeforeSave({ key: formKey, alias, group: group || undefined }))) return;

    setSaving(true);
    try {
      await setVault({
        key: formKey,
        alias,
        value: formValue,
        group: group || undefined,
        originalKey: initialSecret?.key,
        originalAlias: isEdit ? activeAlias : undefined,
      });
      onSaved(formKey);
    } catch {
      onSaved('');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="auth-overlay" style={{ display: '' }}>
      <div className="vault-form-panel">
        <div className="progress-header">
          <span className="progress-title">{isEdit ? t('vault.editKey') : t('vault.newKey')}</span>
          <button className="progress-close" onClick={onClose}>&times;</button>
        </div>
        <div className="vault-form-body">
          <div className="vault-form-field">
            <label>Key</label>
            <input type="text" className="vault-input" placeholder={t('vault.keyExample')} value={formKey}
              onChange={e => setFormKey(e.target.value)} />
          </div>
          <div className="vault-form-row">
            <div className="vault-form-field">
              <label>{t('common.alias')}</label>
              <input type="text" className="vault-input" value={formAlias} onChange={e => setFormAlias(e.target.value)} />
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
