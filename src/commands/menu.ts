import prompts from "prompts";
import kleur from "kleur";
import { loadRegistry, Step, Registry } from "../config/registry";
import { executeSteps, printResults } from "../executor/runner";
import { runClaudeCommand, addClaudeProfile } from "./claude";
import { t } from "../config/i18n";

export async function showMainMenu(): Promise<void> {
  console.log(kleur.cyan("\n" + t("title") + "\n"));

  const registry = await loadRegistry();

  while (true) {
    const response = await prompts({
      type: "select",
      name: "action",
      message: t("selectAction"),
      choices: [
        { title: t("installAll"), value: "install-all" },
        { title: t("upgradeAll"), value: "upgrade-all" },
        { title: t("selectItems"), value: "select" },
        { title: t("claudeMenu"), value: "claude" },
        { title: t("help"), value: "help" },
        { title: t("exit"), value: "exit" },
      ],
    });

    switch (response.action) {
      case "install-all":
        await handleInstallAll(registry);
        break;
      case "upgrade-all":
        await handleUpgradeAll(registry);
        break;
      case "select":
        const shouldContinue = await handleSelectItems(registry);
        if (!shouldContinue) continue;
        break;
      case "claude":
        await handleClaudeMenu();
        continue;
      case "help":
        console.log(kleur.cyan("\n" + t("helpContent")));
        await prompts({ type: "invisible", name: "continue", message: "" });
        continue;
      case "exit":
      default:
        console.log(kleur.gray("\n" + t("goodbye")));
        process.exit(0);
    }
  }
}

async function handleInstallAll(registry: Registry): Promise<void> {
  const steps = registry.steps;
  if (steps.length === 0) {
    console.log(kleur.yellow(t("noSteps")));
    return;
  }

  console.log(kleur.cyan(`\n🔨 ${t("startOperation")} ${t("install")} (${steps.length})\n`));
  const results = await executeSteps(steps, "install", registry);
  printResults(results);
}

async function handleUpgradeAll(registry: Registry): Promise<void> {
  const upgradableSteps = registry.steps.filter((s) => s.upgrade);

  if (upgradableSteps.length === 0) {
    console.log(kleur.yellow("No tools to upgrade"));
    return;
  }

  console.log(
    kleur.cyan(`\n⬆️  ${t("startOperation")} ${t("upgrade")} (${upgradableSteps.length})\n`)
  );
  const results = await executeSteps(upgradableSteps, "upgrade", registry);
  printResults(results);
}

async function handleSelectItems(registry: Registry): Promise<boolean> {
  const steps = registry.steps;
  if (steps.length === 0) {
    console.log(kleur.yellow(t("noSteps")));
    return true;
  }

  while (true) {
    // 步骤选择界面
    const choices = steps.map((step, index) => ({
      title: step.name,
      value: index,
    }));

    const response = await prompts({
      type: "autocompleteMultiselect",
      name: "selected",
      message: t("selectSteps"),
      choices,
      suggest: (input: string, choices: any[]) => {
        return Promise.resolve(
          choices.filter((choice) =>
            choice.title.toLowerCase().includes(input.toLowerCase())
          )
        );
      },
    });

    // 用户取消（返回上一级）
    if (!response.selected) {
      return false;
    }

    if (response.selected.length === 0) {
      console.log(kleur.yellow("\n" + t("needSelect")));
      await prompts({ type: "invisible", name: "continue", message: "" });
      continue;
    }

    const selectedSteps = response.selected.map((i: number) => steps[i]);

    // 统一选择操作
    const actionResponse = await prompts({
      type: "select",
      name: "action",
      message: `${t("selectOperation")} (${selectedSteps.length})`,
      choices: [
        { title: t("install"), value: "install" },
        { title: t("upgrade"), value: "upgrade" },
        { title: t("uninstall"), value: "uninstall" },
        { title: t("back"), value: "back" },
      ],
    });

    if (actionResponse.action === "back") {
      continue;
    }

    // 批量执行
    console.log(kleur.cyan(`\n🚀 ${t("startOperation")} ${actionResponse.action} (${selectedSteps.length})\n`));
    const results = await executeSteps(selectedSteps, actionResponse.action as "install" | "upgrade" | "uninstall", registry);
    printResults(results);

    console.log(kleur.gray("\n" + t("pressBack")));
    await prompts({ type: "invisible", name: "continue", message: "" });
    return true;
  }
}

async function handleClaudeMenu(): Promise<void> {
  const response = await prompts({
    type: "select",
    name: "action",
    message: t("claudeSelectAction"),
    choices: [
      { title: t("claudeRun"), value: "run" },
      { title: t("claudeSwitch"), value: "switch" },
      { title: t("claudeAdd"), value: "add" },
      { title: t("back"), value: "back" },
    ],
  });

  if (response.action === "run") {
    await runClaudeCommand("run");
  } else if (response.action === "switch") {
    await runClaudeCommand("switch");
  } else if (response.action === "add") {
    await addClaudeProfile();
  }
}
