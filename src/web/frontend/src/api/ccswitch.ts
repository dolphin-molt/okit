import { api } from './client';

export interface CCSwitchItem {
  source: 'claude' | 'codex';
  name: string;
  baseUrl: string;
  apiKey: string | null;
  protocol: 'chat' | 'responses' | null;
  current: boolean;
}

export interface CCSwitchSkipped {
  source: string;
  name: string;
  reason: 'no_base_url' | 'subscription_only' | 'unparsed';
  current: boolean;
}

export interface CCSwitchScan {
  found: boolean;
  source?: 'sqlite' | 'json';
  reason?: 'not_installed' | 'sqlite_cli_missing';
  providers: CCSwitchItem[];
  skipped: CCSwitchSkipped[];
}

export async function scanCCSwitch(): Promise<CCSwitchScan> {
  return api('/api/migrate/ccswitch');
}
