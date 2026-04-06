import kleur from "kleur";
import { execSync, spawnSync } from "child_process";
import { loadRegistry, resolveCmd, Step } from "../config/registry";
import { t } from "../config/i18n";

interface AuthResult {
  name: string;
  status: "ok" | "failed" | "fixed" | "fix_failed" | "skipped";
  message?: string;
}

function checkAuth(step: Step): "ok" | "failed" | "no_check" {
  const authCmd = resolveCmd(step.authCheck);
  if (!authCmd) return "no_check";

  try {
    const output = execSync(authCmd, {
      timeout: 15000,
      stdio: ["pipe", "pipe", "pipe"],
    }).toString();

    // Common failure patterns
    const failPatterns = [
      /not logged in/i,
      /not authenticated/i,
      /no auth/i,
      /login required/i,
      /unauthorized/i,
      /expired/i,
      /invalid.*token/i,
      /could not determine/i,
      /error/i,
      /EACCES/i,
    ];

    for (const pattern of failPatterns) {
      if (pattern.test(output)) return "failed";
    }
    return "ok";
  } catch {
    return "failed";
  }
}

function isInstalled(step: Step): boolean {
  const checkCmd = resolveCmd(step.check);
  if (!checkCmd) return false;
  try {
    execSync(checkCmd, { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function tryFix(step: Step): boolean {
  const fixCmd = resolveCmd(step.authFix);
  if (!fixCmd) return false;

  console.log(kleur.gray(`  ${t("authFixing")} ${step.name}...`));

  // Use spawnSync with inherit to allow interactive auth flows
  const result = spawnSync("sh", ["-c", fixCmd], {
    stdio: "inherit",
    timeout: 120000,
  });

  return result.status === 0;
}

export async function runAuth(options?: { fix?: boolean }): Promise<void> {
  const registry = await loadRegistry();
  const results: AuthResult[] = [];

  // Find all tools with authCheck
  const authTools = registry.steps.filter(
    (s) => resolveCmd(s.authCheck) !== undefined
  );

  if (authTools.length === 0) {
    console.log(kleur.yellow(t("authNoTools")));
    return;
  }

  console.log(kleur.cyan(`\n${t("authChecking")}\n`));

  for (const step of authTools) {
    if (!isInstalled(step)) {
      results.push({ name: step.name, status: "skipped", message: t("checkNotInstalled") });
      continue;
    }

    const status = checkAuth(step);
    if (status === "no_check") continue;

    if (status === "ok") {
      results.push({ name: step.name, status: "ok" });
      console.log(`  ${kleur.green("\u2713")} ${step.name} ${kleur.gray(t("checkAuthOk"))}`);
      continue;
    }

    // Auth failed
    if (options?.fix) {
      const fixCmd = resolveCmd(step.authFix);
      if (fixCmd) {
        const fixed = tryFix(step);
        if (fixed) {
          // Verify after fix
          const recheck = checkAuth(step);
          if (recheck === "ok") {
            results.push({ name: step.name, status: "fixed" });
            console.log(`  ${kleur.green("\u2713")} ${step.name} ${kleur.green(t("authFixed"))}`);
            continue;
          }
        }
        results.push({ name: step.name, status: "fix_failed" });
        console.log(`  ${kleur.red("\u2717")} ${step.name} ${kleur.red(t("authFixFailed"))}`);
      } else {
        results.push({ name: step.name, status: "failed", message: t("authNoFixCmd") });
        console.log(`  ${kleur.red("\u2717")} ${step.name} ${kleur.yellow(t("authNoFixCmd"))}`);
      }
    } else {
      results.push({ name: step.name, status: "failed" });
      console.log(`  ${kleur.red("\u2717")} ${step.name} ${kleur.red(t("checkAuthFailed"))}`);
    }
  }

  // Summary
  const ok = results.filter((r) => r.status === "ok").length;
  const fixed = results.filter((r) => r.status === "fixed").length;
  const failed = results.filter((r) => r.status === "failed" || r.status === "fix_failed").length;
  const skipped = results.filter((r) => r.status === "skipped").length;

  console.log(kleur.cyan(`\n${t("authSummary")}`));
  console.log(kleur.green(`  ${t("checkAuthOk")}: ${ok}`));
  if (fixed > 0) console.log(kleur.green(`  ${t("authFixed")}: ${fixed}`));
  if (failed > 0) console.log(kleur.red(`  ${t("checkAuthFailed")}: ${failed}`));
  if (skipped > 0) console.log(kleur.gray(`  ${t("skipped")}: ${skipped}`));

  if (failed > 0 && !options?.fix) {
    console.log(kleur.yellow(`\n  ${t("authHintFix")}`));
  }
}
