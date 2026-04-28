import { useState } from 'react';
import { setVault } from '../../api/vault';

interface VaultFormModalProps {
  groups: string[];
  initialKey?: string;
  onClose: () => void;
  onSaved: (key: string) => void;
}

export default function VaultFormModal({ groups, initialKey, onClose, onSaved }: VaultFormModalProps) {
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
          <span className="progress-title">{isEdit ? '编辑密钥' : '添加密钥'}</span>
          <button className="progress-close" onClick={onClose}>&times;</button>
        </div>
        <div className="vault-form-body">
          <div className="vault-form-field">
            <label>Key</label>
            <input type="text" className="vault-input" placeholder="例如 CF_API_TOKEN" value={formKey}
              onChange={e => setFormKey(e.target.value)} disabled={isEdit} />
          </div>
          <div className="vault-form-row">
            <div className="vault-form-field">
              <label>别名</label>
              <input type="text" className="vault-input" value={formAlias} onChange={e => setFormAlias(e.target.value)} disabled={isEdit} />
            </div>
            <div className="vault-form-field">
              <label>分组</label>
              <select className="vault-input settings-select" value={formGroup} onChange={e => setFormGroup(e.target.value)}>
                <option value="">无分组</option>
                {groups.map(g => <option key={g} value={g}>{g}</option>)}
                <option value="__custom__">手动输入...</option>
              </select>
              {formGroup === '__custom__' && (
                <input type="text" className="vault-input" style={{ marginTop: 4 }} placeholder="输入分组名称" value={formGroupCustom} onChange={e => setFormGroupCustom(e.target.value)} />
              )}
            </div>
          </div>
          <div className="vault-form-field vault-form-field--value">
            <label>Value</label>
            <input type={showValue ? 'text' : 'password'} className="vault-input" placeholder="密钥值" value={formValue} onChange={e => setFormValue(e.target.value)} />
            <button type="button" className="btn-toggle-vis" onClick={() => setShowValue(!showValue)}>{showValue ? '隐藏' : '显示'}</button>
          </div>
        </div>
        <div className="vault-form-actions">
          <button className="btn-cancel" onClick={onClose}>取消</button>
          <button className="btn-save" onClick={handleSave} disabled={saving || !formKey || !formValue}>{saving ? '保存中...' : '保存'}</button>
        </div>
      </div>
    </div>
  );
}
