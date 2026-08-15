import type { AutoCreatePlatform } from '../../api/vault';

export interface AutoCreatePlatformFields {
  key: string;
  group: string;
  groupCustom: string;
}

/** Return the complete form baseline for one selected provider. */
export function getAutoCreatePlatformFields(platform: AutoCreatePlatform, groups: string[]): AutoCreatePlatformFields {
  const groupHint = platform.groupHint || '';
  if (!groupHint) return { key: '', group: '', groupCustom: '' };
  if (groups.includes(groupHint)) return { key: '', group: groupHint, groupCustom: '' };
  return { key: '', group: '__custom__', groupCustom: groupHint };
}
