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
  claudeTeams: string;
  claudeMode: string;
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
  claudePreset: string;
  claudePresetCustom: string;
  claudeApiKeyOnly: string;
  claudeLoginRequired: string;
  claudeCancel: string;
  claudeAdded: string;
  claudeExists: string;
  claudeOverwriteConfirm: string;
  claudeMissingProfiles: string;
  claudeTeamsPrompt: string;
  claudeTeamsEnabled: string;
  claudeTeamsDisabled: string;
  claudeTeamsStatus: string;
  claudeModePrompt: string;
  claudeModeAuto: string;
  claudeModeInProcess: string;
  claudeModeTmux: string;
  claudeModeStatus: string;
  goodbye: string;
  onlyMacOS: string;
  requiresDeps: string;
  installingDep: string;
  depInstallFailed: string;
  depsNotSatisfied: string;
  notInstalled: string;
  mainHelpHint: string;
  // check 命令
  checkMenu: string;
  checkScanning: string;
  checkRunning: string;
  checkReportTitle: string;
  checkInstalled: string;
  checkNotInstalled: string;
  checkOutdated: string;
  checkAuthOk: string;
  checkAuthFailed: string;
  checkAuthIssues: string;
  checkSummary: string;
  checkHealthScore: string;
  checkHintUpgrade: string;
  checkHintAuth: string;
  checkHintInstall: string;
  // upgrade assessment
  checkUpgradeAssessment: string;
  checkPatchLevel: string;
  checkMinorLevel: string;
  checkMajorLevel: string;
  checkUnknownLevel: string;
  checkHintPatch: string;
  checkHintMajor: string;
  // profile
  profileMenu: string;
  profileName: string;
  profileNameRequired: string;
  profileDesc: string;
  profileSelectTools: string;
  profileNoTools: string;
  profileCreated: string;
  profileToolCount: string;
  profileEmpty: string;
  profileSelectApply: string;
  profileNotFound: string;
  profileApplying: string;
  profileMissingTools: string;
  profileConfirmApply: string;
  profileApplyResult: string;
  profileListTitle: string;
  profileExists: string;
  profileSelectDelete: string;
  profileConfirmDelete: string;
  profileDeleted: string;
  profileSelectExport: string;
  profileExported: string;
  profileImportPath: string;
  profileFileNotFound: string;
  profileInvalidFormat: string;
  profileImported: string;
  profileActionCreate: string;
  profileActionApply: string;
  profileActionList: string;
  profileActionDelete: string;
  profileActionExport: string;
  profileActionImport: string;
  // auth
  authChecking: string;
  authNoTools: string;
  authFixing: string;
  authFixed: string;
  authFixFailed: string;
  authNoFixCmd: string;
  authSummary: string;
  authHintFix: string;
  // vault
  vaultSaved: string;
  vaultAutoSync: string;
  vaultTargets: string;
  vaultSynced: string;
  vaultNotFound: string;
  vaultEmpty: string;
  vaultListTitle: string;
  vaultConfirmDelete: string;
  vaultDeleted: string;
  vaultNoOkitEnv: string;
  vaultNoKeys: string;
  vaultEnvWritten: string;
  vaultResolved: string;
  vaultMissing: string;
  vaultNoBindings: string;
  vaultWhereTitle: string;
  vaultSyncing: string;
  vaultSyncResult: string;
  // relay
  relayNotConfigured: string;
  relayConfigUrl: string;
  relayConfigToken: string;
  relayConfigSaved: string;
  relayNoAgents: string;
  relayAgentList: string;
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
    claudeTeams: "Agent Teams 开关",
    claudeMode: "队友显示模式",
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
    claudePreset: "选择预置厂商",
    claudePresetCustom: "自定义",
    claudeApiKeyOnly: "请输入 API Key",
    claudeLoginRequired: "Anthropic 官方无需配置 API Key，请先在 Claude 中完成登录。",
    claudeCancel: "已取消",
    claudeAdded: "已添加配置",
    claudeExists: "已存在同名配置，请更换名称",
    claudeOverwriteConfirm: "已存在同名配置，是否覆盖？",
    claudeMissingProfiles: "未找到可用配置，请先在 ~/.okit/claude-profiles.json 中添加",
    claudeTeamsPrompt: "设置 Agent Teams 实验功能",
    claudeTeamsEnabled: "启用",
    claudeTeamsDisabled: "禁用",
    claudeTeamsStatus: "Agent Teams",
    claudeModePrompt: "设置队友显示模式",
    claudeModeAuto: "auto（自动）",
    claudeModeInProcess: "in-process（主终端内）",
    claudeModeTmux: "tmux（分屏）",
    claudeModeStatus: "队友显示模式",
    goodbye: "再见！",
    onlyMacOS: "✗ 当前仅支持 macOS 平台",
    requiresDeps: "需要以下依赖",
    installingDep: "正在安装依赖",
    depInstallFailed: "依赖安装失败",
    depsNotSatisfied: "依赖未满足",
    notInstalled: "未安装，跳过",
    mainHelpHint: "提示: 在主菜单选择“帮助”可查看帮助",
    // check 命令
    checkMenu: "环境检查",
    checkScanning: "正在扫描已安装工具...",
    checkRunning: "正在检查版本和授权状态...",
    checkReportTitle: "🔍 环境健康检查报告",
    checkInstalled: "已安装",
    checkNotInstalled: "未安装",
    checkOutdated: "可升级",
    checkAuthOk: "授权正常",
    checkAuthFailed: "授权异常",
    checkAuthIssues: "授权问题",
    checkSummary: "📈 总结:",
    checkHealthScore: "健康评分",
    checkHintUpgrade: "提示: 运行 okit upgrade --tools 升级所有工具",
    checkHintAuth: "提示: 请手动修复授权问题，避免 Agent 执行中断",
    checkHintInstall: "提示: 运行 okit 进入交互菜单安装缺失工具",
    checkUpgradeAssessment: "升级评估",
    checkPatchLevel: "补丁更新",
    checkMinorLevel: "次版本更新",
    checkMajorLevel: "主版本更新",
    checkUnknownLevel: "未知级别",
    checkHintPatch: "提示: 补丁更新可安全执行 — okit upgrade --tools",
    checkHintMajor: "提示: 主版本更新可能有 breaking changes，建议逐个评估后手动升级",
    // profile
    profileMenu: "Profile 操作",
    profileName: "Profile 名称",
    profileNameRequired: "名称不能为空",
    profileDesc: "描述（可选）",
    profileSelectTools: "选择工具（空格选择，回车确认）",
    profileNoTools: "请至少选择一个工具",
    profileCreated: "已创建 Profile:",
    profileToolCount: "个工具",
    profileEmpty: "暂无 Profile，请先创建",
    profileSelectApply: "选择要应用的 Profile",
    profileNotFound: "未找到 Profile:",
    profileApplying: "正在应用 Profile:",
    profileMissingTools: "以下工具不在注册表中",
    profileConfirmApply: "确认安装以上工具？",
    profileApplyResult: "应用结果:",
    profileListTitle: "已保存的 Profile",
    profileExists: "同名 Profile 已存在，是否覆盖？",
    profileSelectDelete: "选择要删除的 Profile",
    profileConfirmDelete: "确认删除 Profile",
    profileDeleted: "已删除 Profile:",
    profileSelectExport: "选择要导出的 Profile",
    profileExported: "已导出到:",
    profileImportPath: "输入文件路径",
    profileFileNotFound: "文件不存在:",
    profileInvalidFormat: "文件格式无效",
    profileImported: "已导入 Profile:",
    profileActionCreate: "创建 Profile",
    profileActionApply: "应用 Profile（一键安装）",
    profileActionList: "查看所有 Profile",
    profileActionDelete: "删除 Profile",
    profileActionExport: "导出 Profile",
    profileActionImport: "导入 Profile",
    // auth
    authChecking: "正在检查授权状态...",
    authNoTools: "没有配置授权检查的工具",
    authFixing: "正在修复授权:",
    authFixed: "已修复",
    authFixFailed: "修复失败",
    authNoFixCmd: "无自动修复命令，请手动处理",
    authSummary: "授权状态总结:",
    authHintFix: "提示: 运行 okit auth --fix 尝试自动修复授权问题",
    // vault
    vaultSaved: "已保存:",
    vaultAutoSync: "自动同步到",
    vaultTargets: "个目标",
    vaultSynced: "已同步",
    vaultNotFound: "未找到:",
    vaultEmpty: "Vault 为空，使用 okit vault set KEY value 添加",
    vaultListTitle: "Vault 密钥列表",
    vaultConfirmDelete: "确认删除",
    vaultDeleted: "已删除:",
    vaultNoOkitEnv: "当前目录未找到 .okitenv 文件",
    vaultNoKeys: "未声明任何 key",
    vaultEnvWritten: "已写入:",
    vaultResolved: "已解析",
    vaultMissing: "缺失",
    vaultNoBindings: "未找到关联项目",
    vaultWhereTitle: "关联项目:",
    vaultSyncing: "正在同步所有关联文件...",
    vaultSyncResult: "同步结果:",
    // relay
    relayNotConfigured: "请先配置中继服务器: okit relay config",
    relayConfigUrl: "中继服务器 URL",
    relayConfigToken: "认证 Token",
    relayConfigSaved: "中继配置已保存",
    relayNoAgents: "当前没有在线 Agent",
    relayAgentList: "在线 Agent",
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
    claudeTeams: "Agent Teams Toggle",
    claudeMode: "Teammate Display Mode",
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
    claudePreset: "Choose preset provider",
    claudePresetCustom: "Custom",
    claudeApiKeyOnly: "Enter API key",
    claudeLoginRequired: "Anthropic official does not require an API key. Please sign in to Claude first.",
    claudeCancel: "Cancelled",
    claudeAdded: "Profile added",
    claudeExists: "Profile name already exists",
    claudeOverwriteConfirm: "Profile exists. Overwrite?",
    claudeMissingProfiles: "No profiles found. Add one in ~/.okit/claude-profiles.json",
    claudeTeamsPrompt: "Set Agent Teams experimental feature",
    claudeTeamsEnabled: "Enabled",
    claudeTeamsDisabled: "Disabled",
    claudeTeamsStatus: "Agent Teams",
    claudeModePrompt: "Set teammate display mode",
    claudeModeAuto: "auto",
    claudeModeInProcess: "in-process",
    claudeModeTmux: "tmux",
    claudeModeStatus: "Teammate display mode",
    goodbye: "Goodbye!",
    onlyMacOS: "✗ Currently only supports macOS",
    requiresDeps: "requires the following dependencies",
    installingDep: "Installing dependency",
    depInstallFailed: "Dependency installation failed",
    depsNotSatisfied: "Dependencies not satisfied",
    notInstalled: "Not installed, skipped",
    mainHelpHint: "Hint: Choose \u201cHelp\u201d in the main menu to view help",
    // check command
    checkMenu: "Health Check",
    checkScanning: "Scanning installed tools...",
    checkRunning: "Checking versions and auth status...",
    checkReportTitle: "🔍 Environment Health Check Report",
    checkInstalled: "Installed",
    checkNotInstalled: "Not installed",
    checkOutdated: "Upgradable",
    checkAuthOk: "Auth OK",
    checkAuthFailed: "Auth failed",
    checkAuthIssues: "Auth issues",
    checkSummary: "📈 Summary:",
    checkHealthScore: "Health score",
    checkHintUpgrade: "Hint: Run okit upgrade --tools to upgrade all tools",
    checkHintAuth: "Hint: Fix auth issues manually to avoid Agent interruptions",
    checkHintInstall: "Hint: Run okit to install missing tools interactively",
    checkUpgradeAssessment: "Upgrade Assessment",
    checkPatchLevel: "patch",
    checkMinorLevel: "minor",
    checkMajorLevel: "major",
    checkUnknownLevel: "unknown",
    checkHintPatch: "Hint: Patch updates are safe to auto-upgrade — okit upgrade --tools",
    checkHintMajor: "Hint: Major updates may have breaking changes, assess individually",
    // profile
    profileMenu: "Profile actions",
    profileName: "Profile name",
    profileNameRequired: "Name is required",
    profileDesc: "Description (optional)",
    profileSelectTools: "Select tools (space to toggle, enter to confirm)",
    profileNoTools: "Please select at least one tool",
    profileCreated: "Profile created:",
    profileToolCount: "tools",
    profileEmpty: "No profiles yet, create one first",
    profileSelectApply: "Select profile to apply",
    profileNotFound: "Profile not found:",
    profileApplying: "Applying profile:",
    profileMissingTools: "Tools not in registry",
    profileConfirmApply: "Install the above tools?",
    profileApplyResult: "Apply result:",
    profileListTitle: "Saved Profiles",
    profileExists: "Profile already exists, overwrite?",
    profileSelectDelete: "Select profile to delete",
    profileConfirmDelete: "Delete profile",
    profileDeleted: "Profile deleted:",
    profileSelectExport: "Select profile to export",
    profileExported: "Exported to:",
    profileImportPath: "Enter file path",
    profileFileNotFound: "File not found:",
    profileInvalidFormat: "Invalid file format",
    profileImported: "Profile imported:",
    profileActionCreate: "Create Profile",
    profileActionApply: "Apply Profile (one-click install)",
    profileActionList: "List Profiles",
    profileActionDelete: "Delete Profile",
    profileActionExport: "Export Profile",
    profileActionImport: "Import Profile",
    // auth
    authChecking: "Checking auth status...",
    authNoTools: "No tools with auth checks configured",
    authFixing: "Fixing auth:",
    authFixed: "Fixed",
    authFixFailed: "Fix failed",
    authNoFixCmd: "No auto-fix command, fix manually",
    authSummary: "Auth status summary:",
    authHintFix: "Hint: Run okit auth --fix to auto-fix auth issues",
    // vault
    vaultSaved: "Saved:",
    vaultAutoSync: "Auto-syncing to",
    vaultTargets: "targets",
    vaultSynced: "Synced",
    vaultNotFound: "Not found:",
    vaultEmpty: "Vault is empty, use okit vault set KEY value to add",
    vaultListTitle: "Vault Secrets",
    vaultConfirmDelete: "Delete",
    vaultDeleted: "Deleted:",
    vaultNoOkitEnv: "No .okitenv file found in current directory",
    vaultNoKeys: "No keys declared",
    vaultEnvWritten: "Written to:",
    vaultResolved: "Resolved",
    vaultMissing: "Missing",
    vaultNoBindings: "No project bindings found",
    vaultWhereTitle: "Used in:",
    vaultSyncing: "Syncing all bound files...",
    vaultSyncResult: "Sync result:",
    // relay
    relayNotConfigured: "Configure relay first: okit relay config",
    relayConfigUrl: "Relay server URL",
    relayConfigToken: "Auth Token",
    relayConfigSaved: "Relay config saved",
    relayNoAgents: "No agents online",
    relayAgentList: "Online Agents",
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
