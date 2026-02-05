# OKIT

macOS 开发工具管理器，提供一站式的安装、升级、卸载、依赖排序与常用配置能力。

适合场景：
- 新机器快速初始化开发环境
- 团队统一工具安装方式
- 需要在命令行完成常规维护

---

## 快速安装（推荐）

```bash
curl -fsSL https://raw.githubusercontent.com/dolphin-molt/okit/refs/heads/main/install.sh | bash
```

安装完成后即可使用：

```bash
okit
```

---

## 重要说明

- 仅支持 macOS。
- 会安装到 `/usr/local/bin/okit`（必要时会提示 sudo）。
- 配置文件目录为 `~/.okit`。
- 默认使用 HTTPS 下载 Release 二进制。

---

## 常用命令

```bash
okit                # 进入交互式菜单
okit upgrade        # 升级 OKIT 或工具
okit uninstall      # 卸载 OKIT
okit repo           # Repo 设置与创建
okit claude         # Claude 配置与运行
```

查看版本：

```bash
okit -V
```

---

## 交互式菜单使用

进入 `okit` 后你可以进行：

- 安装工具
- 升级工具
- 卸载工具
- Claude 配置管理
- Repo 设置与创建

菜单内支持的快捷键会在界面提示中显示。

---

## Repo 功能（GitHub）

目前仅支持 GitHub。

功能包括：
- 一键设置 Git + GitHub 凭据
- 创建远程仓库
- 自动绑定 `origin`（HTTPS）
- 可选首次推送

推荐流程：

1. 运行 `okit repo`
2. 选择 “一键设置（Git + GitHub）”
3. 回到菜单选择 “新建仓库”

注意：
- GitHub Token 会保存在 `~/.okit/user.json`。
- 同时会写入系统 Keychain，以便 HTTPS 推送免输入。

---

## Claude 配置

配置文件：`~/.okit/claude-profiles.json`

示例：

```json
[
  {
    "name": "Volcengine",
    "baseUrl": "https://ark.cn-beijing.volces.com/api/coding",
    "authToken": "YOUR_TOKEN",
    "models": ["model-a", "model-b"]
  }
]
```

常用命令：

```bash
okit claude
okit claude switch
okit claude add
```

---

## 配置文件说明

`~/.okit/user.json` 保存用户偏好与凭据（示例）：

```json
{
  "language": "zh",
  "git": {
    "name": "Your Name",
    "email": "you@example.com"
  },
  "repo": {
    "github": {
      "username": "your-github",
      "token": "ghp_xxx"
    }
  }
}
```

`~/.okit/registry.json` 保存可安装工具清单，可自定义：
- 同名工具会覆盖默认配置
- 新增工具会被追加
- 默认新增工具不会丢失

---

## 安装脚本高级用法

指定版本安装：

```bash
OKIT_VERSION=v0.0.1 curl -fsSL https://raw.githubusercontent.com/dolphin-molt/okit/refs/heads/main/install.sh | bash
```

设置下载超时（秒）：

```bash
OKIT_DOWNLOAD_TIMEOUT=1200 curl -fsSL https://raw.githubusercontent.com/dolphin-molt/okit/refs/heads/main/install.sh | bash
```

---

## 卸载说明

执行：

```bash
okit uninstall
```

卸载时会：
- 自动查找并删除多个可能的 `okit` 路径
- 如需 sudo 会询问是否执行
- 可选删除 `~/.okit` 配置目录

---

## 常见问题

Q: 下载 Release 二进制失败怎么办？

- 可重试执行安装脚本（默认带重试与超时）
- 手动指定版本号再安装

Q: 为什么我卸载后 `okit` 还能用？

- 可能存在多个安装路径
- 重新执行 `okit uninstall` 并允许 sudo 删除即可

Q: token 是否会写到环境变量？

- 不会
- 仅保存在 `~/.okit/user.json` 与系统 Keychain

---

## 开发者说明

本地开发：

```bash
npm run dev
```

本地构建：

```bash
npm run build
npm run pkg
```

发布 Release（自动打包）：

```bash
scripts/publish-release.sh v0.0.1 --auto-notes
```

---

## 许可证

MIT
