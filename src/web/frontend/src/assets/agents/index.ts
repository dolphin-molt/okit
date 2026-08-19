import claude from './claude.png';
import chatgpt from './chatgpt.png';
import workbuddy from './workbuddy.png';
import zcode from './zcode.png';
import hermes from './hermes.png';
import kimiCode from './kimi-code.svg';
import opencode from './opencode.svg';
import openclaw from './openclaw.svg';
import grok from './grok.png';
import mimoCode from './mimo-code.svg';

const ICON_MAP: Record<string, string> = {
  'claude': claude,
  'codex': chatgpt,
  'workbuddy': workbuddy,
  'zcode': zcode,
  'hermes': hermes,
  'kimi-code': kimiCode,
  'opencode': opencode,
  'openclaw': openclaw,
  'grok': grok,
  'mimo-code': mimoCode,
};

export function getAgentIcon(agentId: string): string {
  return ICON_MAP[agentId] || '';
}
