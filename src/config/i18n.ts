import { loadUserConfig, updateUserConfig } from "./user";

export type Language = "zh" | "en";

export interface Translations {
  lang: Language;
  title: string;
  selectAction: string;
  installAll: string;
  upgradeAll: string;
  selectItems: string;
  claudeMenu: string;
  claudeRun: string;
  claudeSwitch: string;
  claudeAdd: string;
  repoMenu: string;
  repoSelectAction: string;
  repoCreate: string;
  repoGitUser: string;
  repoAuth: string;
  repoSetup: string;
  repoSelectProvider: string;
  repoName: string;
  repoVisibility: string;
  repoPrivate: string;
  repoPublic: string;
  repoInitGit: string;
  repoFirstPush: string;
  repoYes: string;
  repoNo: string;
  repoGitName: string;
  repoGitEmail: string;
  repoGitScope: string;
  repoGitScopeGlobal: string;
  repoGitScopeLocal: string;
  repoGitSaved: string;
  repoSetupSaved: string;
  repoUsername: string;
  repoToken: string;
  repoAuthSaved: string;
  repoNeedAuth: string;
  repoCancelled: string;
  repoExists: string;
  repoUseExisting: string;
  exit: string;
  noSteps: string;
  selectSteps: string;
  selectOperation: string;
  install: string;
  upgrade: string;
  uninstall: string;
  skip: string;
  back: string;
  help: string;
  helpContent: string;
  needSelect: string;
  pressContinue: string;
  startOperation: string;
  pressBack: string;
  reportTitle: string;
  status: string;
  toolName: string;
  operation: string;
  duration: string;
  summary: string;
  success: string;
  failed: string;
  skipped: string;
  total: string;
  totalDuration: string;
  failedTools: string;
  retryHint: string;
  mayNeedSudo: string;
  enterPassword: string;
  alreadyExists: string;
  successMsg: string;
  failedMsg: string;
  uninstallDepsHint: string;
  planTitle: string;
  planDepMark: string;
  externalDepsTitle: string;
  externalDepsHint: string;
  missingDepsTitle: string;
  missingDepsHint: string;
  planPreparing: string;
  planPrepared: string;
  claudeSelectAction: string;
  claudeSelectProvider: string;
  claudeSelectModel: string;
  claudeName: string;
  claudeBaseUrl: string;
  claudeAuthToken: string;
  claudeModels: string;
  claudeCancel: string;
  claudeAdded: string;
  claudeExists: string;
  claudeMissingProfiles: string;
  goodbye: string;
  onlyMacOS: string;
  requiresDeps: string;
  installingDep: string;
  depInstallFailed: string;
  depsNotSatisfied: string;
  notInstalled: string;
  mainHelpHint: string;
}

const translations: Record<Language, Translations> = {
  zh: {
    lang: "zh",
    title: "🚀 OKIT v1",
    selectAction: "选择操作",
    installAll: "安装全部",
    upgradeAll: "升级全部",
    selectItems: "工具管理",
    claudeMenu: "Claude 配置",
    claudeRun: "进入 Claude",
    claudeSwitch: "切换配置",
    claudeAdd: "添加配置",
    repoMenu: "Repo 设置",
    exit: "退出",
    noSteps: "没有配置任何步骤",
    selectSteps: "选择工具（空格选择，回车确认，输入搜索，Ctrl+A 全选/取消）",
    selectOperation: "选择操作",
    install: "安装",
    upgrade: "升级",
    uninstall: "卸载",
    skip: "跳过",
    back: "返回",
    needSelect: "⚠️  请至少选择一个步骤，按回车重新选择...",
    pressContinue: "",
    startOperation: "开始",
    pressBack: "按回车返回主菜单...",
    reportTitle: "📊 下载/安装汇总报告",
    status: "状态",
    toolName: "工具名称",
    operation: "操作",
    duration: "耗时",
    summary: "📈 统计摘要:",
    success: "成功",
    failed: "失败",
    skipped: "跳过",
    total: "总计",
    totalDuration: "总耗时",
    failedTools: "⚠️  失败的工具:",
    retryHint: "提示: 失败的工具可以重新运行安装",
    mayNeedSudo: "可能需要 sudo 权限",
    enterPassword: "如果需要密码，请输入（输入时不会显示字符）",
    alreadyExists: "已存在，跳过",
    successMsg: "成功",
    failedMsg: "失败",
    uninstallDepsHint: "提示: 该工具仍被其他工具依赖，建议先卸载依赖它的工具，或使用 --ignore-dependencies 强制卸载。",
    planTitle: "📋 计划执行清单（按依赖顺序）",
    planDepMark: "[依赖]",
    externalDepsTitle: "⚠️  检测到非本次清单的依赖关系（仅提示，不自动处理）",
    externalDepsHint: "若需处理，请先卸载这些依赖项或使用 --ignore-dependencies 强制卸载。",
    missingDepsTitle: "⚠️  发现不在本次清单中的依赖（仅提示，不自动处理）",
    missingDepsHint: "如需处理，请手动选择或补充这些依赖。",
    planPreparing: "依赖检查中，生成执行清单...",
    planPrepared: "执行清单已生成",
    repoSelectAction: "Repo 操作",
    repoCreate: "新建仓库",
    repoGitUser: "设置 Git 用户名/邮箱",
    repoAuth: "设置仓库平台凭据",
    repoSetup: "一键设置（Git + GitHub）",
    repoSelectProvider: "选择平台",
    repoName: "仓库名称",
    repoVisibility: "可见性",
    repoPrivate: "私有",
    repoPublic: "公开",
    repoInitGit: "初始化 Git 仓库",
    repoFirstPush: "首次自动推送",
    repoYes: "是",
    repoNo: "否",
    repoGitName: "Git 用户名",
    repoGitEmail: "Git 邮箱",
    repoGitScope: "应用范围",
    repoGitScopeGlobal: "全局",
    repoGitScopeLocal: "当前项目",
    repoGitSaved: "已保存 Git 配置",
    repoSetupSaved: "已保存 Git & GitHub 配置",
    repoUsername: "平台用户名",
    repoToken: "平台 Token",
    repoAuthSaved: "已保存平台凭据",
    repoNeedAuth: "需要先配置平台凭据",
    repoCancelled: "已取消",
    repoExists: "检测到同名仓库",
    repoUseExisting: "是否使用已有仓库并推送？",
    claudeSelectAction: "Claude 操作",
    claudeSelectProvider: "选择 Claude 模型提供商",
    claudeSelectModel: "选择模型",
    claudeName: "配置名称（例如: Volcengine / Anthropic）",
    claudeBaseUrl: "ANTHROPIC_BASE_URL",
    claudeAuthToken: "ANTHROPIC_AUTH_TOKEN",
    claudeModels: "模型列表（用逗号分隔）",
    claudeCancel: "已取消",
    claudeAdded: "已添加配置",
    claudeExists: "已存在同名配置，请更换名称",
    claudeMissingProfiles: "未找到可用配置，请先在 ~/.okit/claude-profiles.json 中添加",
    goodbye: "再见！",
    onlyMacOS: "✗ 当前仅支持 macOS 平台",
    requiresDeps: "需要以下依赖",
    installingDep: "正在安装依赖",
    depInstallFailed: "依赖安装失败",
    depsNotSatisfied: "依赖未满足",
    notInstalled: "未安装，跳过",
    mainHelpHint: "提示: 在主菜单选择“帮助”可查看帮助",
    help: "帮助",
    helpContent:
      "快捷键说明:\n- ↑/↓: 移动\n- 空格: 选择/取消\n- 回车: 确认\n- Ctrl+A: 全选/取消全选\n",
  },
  en: {
    lang: "en",
    title: "🚀 OKIT v1",
    selectAction: "Select action",
    installAll: "Install all",
    upgradeAll: "Upgrade all",
    selectItems: "Manage tools",
    claudeMenu: "Claude Setup",
    claudeRun: "Launch Claude",
    claudeSwitch: "Switch Config",
    claudeAdd: "Add Config",
    repoMenu: "Repo Settings",
    exit: "Exit",
    noSteps: "No steps configured",
    selectSteps: "Select tools (space to toggle, enter to confirm, type to search, Ctrl+A to toggle all)",
    selectOperation: "Select operation",
    install: "Install",
    upgrade: "Upgrade",
    uninstall: "Uninstall",
    skip: "Skip",
    back: "Back",
    needSelect: "⚠️  Please select at least one step, press enter to retry...",
    pressContinue: "",
    startOperation: "Starting",
    pressBack: "Press enter to return to main menu...",
    reportTitle: "📊 Download/Install Summary",
    status: "Status",
    toolName: "Tool Name",
    operation: "Operation",
    duration: "Duration",
    summary: "📈 Summary:",
    success: "Success",
    failed: "Failed",
    skipped: "Skipped",
    total: "Total",
    totalDuration: "Total Duration",
    failedTools: "⚠️  Failed tools:",
    retryHint: "Hint: Failed tools can be reinstalled",
    mayNeedSudo: "May require sudo privileges",
    enterPassword: "Please enter password if prompted (input will be hidden)",
    alreadyExists: "Already exists, skipping",
    successMsg: "Success",
    failedMsg: "Failed",
    uninstallDepsHint: "Hint: This tool is still required by others. Uninstall dependents first, or use --ignore-dependencies to force removal.",
    planTitle: "📋 Planned execution list (dependency order)",
    planDepMark: "[dependency]",
    externalDepsTitle: "⚠️  Detected external dependents (informational only)",
    externalDepsHint: "Handle them first or use --ignore-dependencies to force removal.",
    missingDepsTitle: "⚠️  Dependencies not in this batch (informational only)",
    missingDepsHint: "If needed, select or add these dependencies manually.",
    planPreparing: "Checking dependencies and building execution plan...",
    planPrepared: "Execution plan ready",
    repoSelectAction: "Repo action",
    repoCreate: "Create repository",
    repoGitUser: "Set Git name/email",
    repoAuth: "Set provider credentials",
    repoSetup: "One-time setup (Git + GitHub)",
    repoSelectProvider: "Choose provider",
    repoName: "Repository name",
    repoVisibility: "Visibility",
    repoPrivate: "Private",
    repoPublic: "Public",
    repoInitGit: "Initialize Git repository",
    repoFirstPush: "First push automatically",
    repoYes: "Yes",
    repoNo: "No",
    repoGitName: "Git user name",
    repoGitEmail: "Git email",
    repoGitScope: "Apply scope",
    repoGitScopeGlobal: "Global",
    repoGitScopeLocal: "Current project",
    repoGitSaved: "Git config saved",
    repoSetupSaved: "Git & GitHub config saved",
    repoUsername: "Provider username",
    repoToken: "Provider token",
    repoAuthSaved: "Provider credentials saved",
    repoNeedAuth: "Configure provider credentials first",
    repoCancelled: "Cancelled",
    repoExists: "Repository already exists",
    repoUseExisting: "Use existing repository and push?",
    claudeSelectAction: "Claude action",
    claudeSelectProvider: "Choose Claude provider",
    claudeSelectModel: "Choose model",
    claudeName: "Profile name (e.g., Volcengine / Anthropic)",
    claudeBaseUrl: "ANTHROPIC_BASE_URL",
    claudeAuthToken: "ANTHROPIC_AUTH_TOKEN",
    claudeModels: "Models (comma-separated)",
    claudeCancel: "Cancelled",
    claudeAdded: "Profile added",
    claudeExists: "Profile name already exists",
    claudeMissingProfiles: "No profiles found. Add one in ~/.okit/claude-profiles.json",
    goodbye: "Goodbye!",
    onlyMacOS: "✗ Currently only supports macOS",
    requiresDeps: "requires the following dependencies",
    installingDep: "Installing dependency",
    depInstallFailed: "Dependency installation failed",
    depsNotSatisfied: "Dependencies not satisfied",
    notInstalled: "Not installed, skipped",
    mainHelpHint: "Hint: Choose “Help” in the main menu to view help",
    help: "Help",
    helpContent:
      "Shortcuts:\n- ↑/↓: Move\n- Space: Toggle\n- Enter: Confirm\n- Ctrl+A: Toggle all\n",
  },
};

let currentLang: Language = "zh";

// 加载保存的语言配置
export async function loadLanguageConfig(): Promise<Language | null> {
  const config = await loadUserConfig();
  if (config.language && (config.language === "zh" || config.language === "en")) {
    return config.language;
  }
  return null;
}

// 保存语言配置
export async function saveLanguageConfig(lang: Language): Promise<void> {
  try {
    await updateUserConfig({ language: lang });
  } catch {
    // 保存失败静默处理
  }
}

// 初始化语言（从配置文件或默认）
export async function initLanguage(): Promise<void> {
  const savedLang = await loadLanguageConfig();
  if (savedLang) {
    currentLang = savedLang;
  }
}

export function setLanguage(lang: Language) {
  currentLang = lang;
  // 异步保存，不阻塞
  saveLanguageConfig(lang).catch(() => {});
}

export function getLanguage(): Language {
  return currentLang;
}

export function t(key: keyof Translations): string {
  return translations[currentLang][key];
}
