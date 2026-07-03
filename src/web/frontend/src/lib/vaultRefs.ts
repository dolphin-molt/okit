export interface VaultAliasOption {
  reference: string;
  key: string;
  alias: string;
  masked?: string;
  group?: string;
  updatedAt?: string;
}

export function formatVaultReference(key: string, alias = 'default') {
  const trimmedAlias = alias.trim() || 'default';
  return trimmedAlias === 'default' ? key : `${key}/${trimmedAlias}`;
}

export function flattenVaultAliasOptions(secrets: Array<{ key: string; group?: string; aliases?: Array<{ alias?: string; masked?: string; group?: string; updatedAt?: string }> }>): VaultAliasOption[] {
  return secrets.flatMap(secret => {
    const aliases = secret.aliases?.length ? secret.aliases : [{ alias: 'default' }];
    return aliases.map(alias => {
      const aliasName = alias.alias || 'default';
      return {
        reference: formatVaultReference(secret.key, aliasName),
        key: secret.key,
        alias: aliasName,
        masked: alias.masked,
        group: alias.group || secret.group,
        updatedAt: alias.updatedAt,
      };
    });
  });
}
