import { AgentAdapter, ProviderType } from "./types";
import { ClaudeAdapter } from "./adapters/claude";
import { CodexAdapter } from "./adapters/codex";
import { GeminiAdapter } from "./adapters/gemini";
import { OpenCodeAdapter } from "./adapters/opencode";
import { OpenClawAdapter } from "./adapters/openclaw";

const adapters: AgentAdapter[] = [
  new ClaudeAdapter(),
  new CodexAdapter(),
  new GeminiAdapter(),
  new OpenCodeAdapter(),
  new OpenClawAdapter(),
];

export function getAdapters(): AgentAdapter[] {
  return adapters;
}

export function getAdapter(id: string): AgentAdapter | undefined {
  return adapters.find(a => a.id === id);
}

export function getAdaptersByType(type: ProviderType): AgentAdapter[] {
  return adapters.filter(a => a.supportedTypes.includes(type));
}
