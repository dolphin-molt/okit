import prompts from "prompts";
import kleur from "kleur";
import { t } from "../config/i18n";
import { loadProviders, addProvider, deleteProvider, getProvider } from "../providers/store";
import { PRESET_PROVIDERS } from "../providers/presets";
import { getAdapters, getAdapter } from "../providers/registry";
import { checkAuthStatus } from "../providers/auth";
import { loadUserConfig, updateUserConfig } from "../config/user";
import { Provider, ProviderModel } from "../providers/types";
import { VaultStore } from "../vault/store";

export async function providerList(): Promise<void> {
  const providers = await loadProviders();
  if (providers.length === 0) {
    console.log(kleur.yellow(t("providerNoProviders")));
    return;
  }

  console.log(kleur.bold(`\n${t("providerListTitle")}:\n`));
  for (const p of providers) {
    const auth = await checkAuthStatus(p);
    const authIcon = auth.hasApiKey ? kleur.green("✓") : kleur.red("✗");
    const typeBadge = kleur.cyan(`[${p.type}]`);
    console.log(`  ${kleur.bold(p.name)}  ${typeBadge}  ${kleur.gray(p.baseUrl)}`);
    console.log(`    ${t("providerAuthApiKey")}: ${authIcon}  ${t("providerId")}: ${kleur.gray(p.id)}`);
    if (p.models.length > 0) {
      const models = p.models.map(m => m.name || m.id).join(", ");
      console.log(`    Models: ${kleur.gray(models)}`);
    }
    console.log();
  }
}

export async function providerCurrent(): Promise<void> {
  const providers = await loadProviders();
  const adapters = getAdapters();
  const config = await loadUserConfig();
  const providersConfig = (config as any).providers || {};

  console.log(kleur.bold(`\n${t("providerCurrentTitle")}:\n`));
  for (const adapter of adapters) {
    const sel = providersConfig[adapter.id];
    if (sel?.providerId && sel?.modelId) {
      const provider = providers.find(p => p.id === sel.providerId);
      const name = provider ? provider.name : sel.providerId;
      console.log(`  ${kleur.bold(adapter.name)}: ${kleur.green(name)} / ${kleur.cyan(sel.modelId)}`);
    } else {
      console.log(`  ${kleur.bold(adapter.name)}: ${kleur.gray(t("providerAgentNotConfigured"))}`);
    }
  }
  console.log();
}

export async function providerSwitch(agentId?: string): Promise<void> {
  const providers = await loadProviders();
  if (providers.length === 0) {
    console.log(kleur.yellow(t("providerNoProviders")));
    return;
  }

  const adapters = getAdapters();
  let adapter = agentId ? getAdapter(agentId) : undefined;

  if (!adapter) {
    const response = await prompts({
      type: "select",
      name: "agent",
      message: t("providerSelectAgent"),
      choices: adapters.map(a => ({
        title: `${a.name}  [${a.supportedTypes.join(", ")}]`,
        value: a.id,
      })),
    });
    if (!response.agent) { console.log(kleur.gray(t("providerCancel"))); return; }
    adapter = getAdapter(response.agent);
  }
  if (!adapter) return;

  const compatible = providers.filter(p => adapter!.supportedTypes.includes(p.type));
  if (compatible.length === 0) {
    console.log(kleur.yellow(`No compatible providers for ${adapter.name}`));
    return;
  }

  const current = await adapter.getCurrentConfig();

  const provResponse = await prompts({
    type: "select",
    name: "provider",
    message: t("providerSelectProvider"),
    choices: compatible.map(p => ({
      title: `${p.name}${p.id === current?.providerId ? " ✅" : ""}  |  ${p.baseUrl}`,
      value: p.id,
    })),
  });
  if (!provResponse.provider) { console.log(kleur.gray(t("providerCancel"))); return; }

  const selectedProvider = compatible.find(p => p.id === provResponse.provider)!;

  const modelResponse = await prompts({
    type: "select",
    name: "model",
    message: t("providerSelectModel"),
    choices: selectedProvider.models.map(m => ({
      title: `${m.name || m.id}${m.id === current?.modelId ? " ✅" : ""}`,
      value: m.id,
    })),
  });
  if (!modelResponse.model) { console.log(kleur.gray(t("providerCancel"))); return; }

  await adapter.applyConfig(selectedProvider, modelResponse.model);
  console.log(kleur.green(`${t("providerSwitched")}: ${selectedProvider.name} / ${modelResponse.model}`));
}

export async function providerUse(
  providerId: string,
  options?: { agent?: string; model?: string }
): Promise<void> {
  const providers = await loadProviders();
  const provider = providers.find(p => p.id === providerId || p.name === providerId);
  if (!provider) {
    console.log(kleur.red(t("providerNotFound")));
    return;
  }

  const modelId = options?.model || provider.models[0]?.id;
  if (!modelId) {
    console.log(kleur.red("No models available"));
    return;
  }

  const adapters = options?.agent
    ? [getAdapter(options.agent)].filter(Boolean)
    : getAdapters().filter(a => a.supportedTypes.includes(provider.type));

  if (adapters.length === 0) {
    console.log(kleur.red("No compatible agents"));
    return;
  }

  for (const adapter of adapters) {
    await adapter!.applyConfig(provider, modelId);
    console.log(kleur.green(`${adapter!.name}: ${t("providerSwitched")} → ${provider.name} / ${modelId}`));
  }
}

export async function providerAdd(): Promise<void> {
  const presetChoices = PRESET_PROVIDERS.map(p => ({
    title: `${p.name}  [${p.type}]  |  ${p.baseUrl}`,
    value: p.id,
  }));
  presetChoices.push({ title: t("providerPresetCustom"), value: "custom" });

  const presetResponse = await prompts({
    type: "select",
    name: "preset",
    message: t("providerPreset"),
    choices: presetChoices,
  });
  if (!presetResponse.preset) { console.log(kleur.gray(t("providerCancel"))); return; }

  let provider: Provider;

  if (presetResponse.preset !== "custom") {
    const preset = PRESET_PROVIDERS.find(p => p.id === presetResponse.preset)!;
    const apiKeyResponse = await prompts({
      type: "password",
      name: "apiKey",
      message: t("providerApiKey"),
    });
    provider = { ...preset, vaultKey: undefined };

    if (apiKeyResponse.apiKey) {
      const vaultKey = `${preset.id.toUpperCase().replace(/-/g, "_")}_API_KEY`;
      try {
        const store = new VaultStore();
        await store.set(vaultKey, String(apiKeyResponse.apiKey).trim(), "providers");
        provider.vaultKey = vaultKey;
      } catch {}
    }
  } else {
    const response = await prompts([
      { type: "text", name: "name", message: t("providerName") },
      { type: "select", name: "type", message: t("providerType"),
        choices: [
          { title: "anthropic", value: "anthropic" },
          { title: "openai", value: "openai" },
          { title: "google", value: "google" },
        ] },
      { type: "text", name: "baseUrl", message: t("providerBaseUrl") },
      { type: "password", name: "apiKey", message: t("providerApiKey") },
      { type: "text", name: "models", message: t("providerModels") },
    ]);
    if (!response.name || !response.baseUrl) { console.log(kleur.gray(t("providerCancel"))); return; }

    const models: ProviderModel[] = response.models
      ? String(response.models).split(",").map((s: string) => ({ id: s.trim() })).filter((m: ProviderModel) => m.id)
      : [];

    provider = {
      id: String(response.name).toLowerCase().replace(/\s+/g, "-"),
      name: String(response.name).trim(),
      type: response.type,
      baseUrl: String(response.baseUrl).trim(),
      authMode: "api_key",
      models,
    };

    if (response.apiKey) {
      const vaultKey = `${provider.id.toUpperCase().replace(/-/g, "_")}_API_KEY`;
      try {
        const store = new VaultStore();
        await store.set(vaultKey, String(response.apiKey).trim(), "providers");
        provider.vaultKey = vaultKey;
      } catch {}
    }
  }

  await addProvider(provider);
  console.log(kleur.green(`${t("providerAdded")}: ${provider.name}`));
}

export async function providerDeleteAction(name: string): Promise<void> {
  const providers = await loadProviders();
  const provider = providers.find(p => p.id === name || p.name === name);
  if (!provider) {
    console.log(kleur.red(t("providerNotFound")));
    return;
  }

  const confirm = await prompts({
    type: "confirm",
    name: "ok",
    message: `${t("providerConfirmDelete")} ${provider.name}?`,
    initial: false,
  });
  if (!confirm.ok) { console.log(kleur.gray(t("providerCancel"))); return; }

  await deleteProvider(provider.id);
  console.log(kleur.green(`${t("providerDeleted")}: ${provider.name}`));
}

export async function providerAuth(): Promise<void> {
  const providers = await loadProviders();
  console.log(kleur.bold(`\n${t("providerAuthTitle")}:\n`));
  for (const p of providers) {
    const status = await checkAuthStatus(p);
    const parts: string[] = [];
    if (status.hasApiKey) {
      parts.push(`${t("providerAuthApiKey")} ✓`);
    }
    if (status.oauthLoggedIn !== undefined) {
      parts.push(`${t("providerAuthOAuth")} ${status.oauthLoggedIn ? kleur.green(t("providerAuthLoggedIn")) : kleur.red(t("providerAuthNotLoggedIn"))}`);
    }
    if (parts.length === 0) {
      parts.push(kleur.red(t("providerAuthNone")));
    }
    console.log(`  ${kleur.bold(p.name)}: ${parts.join(" | ")}`);
  }
  console.log();
}
