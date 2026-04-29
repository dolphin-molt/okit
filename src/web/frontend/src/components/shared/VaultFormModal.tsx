import { useState } from 'react';
import { setVault } from '../../api/vault';
import { useI18n } from '../../i18n';
import CustomSelect from './CustomSelect';

interface VaultFormModalProps {
  groups: string[];
  initialKey?: string;
  onClose: () => void;
  onSaved: (key: string) => void;
}

export default function VaultFormModal({ groups, initialKey, onClose, onSaved }: VaultFormModalProps) {
  const { t } = useI18n();
  const isEdit = !!initialKey;
  const [formKey, setFormKey] = useState(initialKey || '');
  const [formAlias, setFormAlias] = useState('default');
  const [formValue, setFormValue] = useState('');
  const [formGroup, setFormGroup] = useState('');
  const [formGroupCustom, setFormGroupCustom] = useState('');
  const [showValue, setShowValue] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!formKey || !formValue) return;
    setSaving(true);
    const group = formGroup === '__custom__' ? formGroupCustom : formGroup;
    try {
      await setVault({ key: formKey, alias: formAlias || 'default', value: formValue, group: group || undefined });
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
              onChange={e => setFormKey(e.target.value)} disabled={isEdit} />
          </div>
          <div className="vault-form-row">
            <div className="vault-form-field">
              <label>{t('common.alias')}</label>
              <input type="text" className="vault-input" value={formAlias} onChange={e => setFormAlias(e.target.value)} disabled={isEdit} />
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
            <input type={showValue ? 'text' : 'password'} className="vault-input" placeholder={t('vault.keyValue')} value={formValue} onChange={e => setFormValue(e.target.value)} />
            <button type="button" className="btn-toggle-vis" onClick={() => setShowValue(!showValue)}>{showValue ? t('common.hide') : t('common.show')}</button>
          </div>
        </div>
        <div className="vault-form-actions">
          <button className="btn-cancel" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn-save" onClick={handleSave} disabled={saving || !formKey || !formValue}>{saving ? t('common.saving') : t('common.save')}</button>
        </div>
      </div>
    </div>
  );
}
