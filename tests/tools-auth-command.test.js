import { describe, it, expect, vi } from 'vitest';
import Module from 'module';

const origRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === '../../config/registry') return { loadRegistry: vi.fn(), resolveCmd: (cmd) => cmd };
  if (id === '../../executor/runner') return { checkStep: vi.fn() };
  if (id === 'execa') return {};
  return origRequire.apply(this, arguments);
};

const { buildAuthCommand } = await import('../src/web/api/tools.js');

describe('buildAuthCommand', () => {
  it('resolves token auth methods from vault references', async () => {
    const store = {
      get: vi.fn(async (key) => `${key}:value`),
    };
    const method = {
      command: "npm config set //registry.npmjs.org/:_authToken '{token}'",
    };

    const command = await buildAuthCommand(method, { vaultKey: 'NPM_OKIT_TOKEN' }, store);

    expect(command).toBe("npm config set //registry.npmjs.org/:_authToken 'NPM_OKIT_TOKEN:value'");
    expect(store.get).toHaveBeenCalledWith('NPM_OKIT_TOKEN');
  });
});
