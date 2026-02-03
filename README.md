# OKIT v1

macOS 开发工具管理器（安装 / 升级 / 卸载 / 依赖排序 / Claude 配置切换）。

## 快速开始

```bash
npm run build
npm run pkg
./bin/okit-arm64
```

## 安装脚本

```bash
curl -fsSL https://raw.githubusercontent.com/dolphin-molt/okit/refs/heads/main/install.sh | bash
```

说明：
- 脚本会检测架构并安装到 `/usr/local/bin/okit`
- 首次使用会在 `~/.okit` 下生成配置

## 常用命令

```bash
okit
okit upgrade
okit uninstall
```

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

命令：

```bash
okit claude
okit claude switch
okit claude add
```

## 用户配置

`~/.okit/user.json`

示例：

```json
{
  "language": "zh",
  "claude": {
    "name": "Volcengine",
    "model": "model-a"
  }
}
```

## 开发

```bash
npm run dev
```

## 许可证

MIT
