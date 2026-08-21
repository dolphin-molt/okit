# OKIT 2.3.0 发布收尾清单

目标：修复当前已确认的发布、CLI 与测试问题，使 npm 包、GitHub Release、安装脚本、Skill 和 CI 行为一致。只修改本地工作区；不得提交、推送、创建 tag、发布 npm/GitHub Release、执行真实云同步或输出任何密钥。

## 1. 取消 npm 安装时的隐式 Shell 修改

- 删除 `package.json` 的 `postinstall` 自动 Hook 安装。
- 删除不再使用的 `scripts/postinstall.js`，或证明它仍有非安装期调用方。
- README/手册明确：只有用户主动运行 `okit hook install` 才修改 Shell 配置。

验收：`npm pack --dry-run --json` 的脚本元数据不包含会自动执行 `hook install` 的安装钩子。

## 2. 修复 `okit upgrade`

- 将升级包名统一为 `@cing-self/okit-cli`。
- 避免通过 `shell: true` 拼接静态命令；优先使用参数数组调用 npm。
- 查询失败、安装失败必须返回非零退出码；不得自动调用 sudo。
- 为包名、查询、已是最新和失败退出码补测试，不访问真实 npm。

验收：相关单测通过，源码中不再把 `okit-cli` 当作 npm 包名。

## 3. 统一版本线为 2.3.0

- `package.json` 与根 `package-lock.json` 统一为 `2.3.0`。
- 发布工作流在 tag 触发时校验 tag 必须等于 `v${package.version}`，不一致立即失败。
- 不创建 tag、不发布。

验收：本地版本一致，工作流包含确定性的 tag/package 校验。

## 4. 修复 GitHub Release 二进制发布链路

- 自动发布流程必须生成 `install.sh` 期待的：
  - `okit-v2.3.0-macos-arm64.zip`
  - `okit-v2.3.0-macos-x64.zip`
- zip 内可执行文件名必须为 `okit`。
- Release 创建时上传两个附件；发布流程不得只创建空 Release。
- 复用或收敛 `scripts/publish-release.sh`，避免手动与 CI 两套命名漂移。
- npm 安装与二进制 Release 可分 job，但 npm 发布必须使用 `@cing-self/okit-cli` 的构建产物。

验收：静态检查工作流、脚本和 `install.sh` 的资源命名完全一致；不得真的发布。

## 5. 修复全量测试的 Server/连接泄漏

- `tests/web/grok-proxy.test.ts`：保存并关闭 proxy、主 upstream、SSE upstream；`afterAll` 不得为空。
- LAN listener 的停止逻辑必须能处理 keep-alive 连接，不能让 `server.close()` 永久等待。
- 测试需要消费/关闭 fetch 响应，且不能通过 `forceExit`、扩大超时或跳过测试掩盖泄漏。

验收：`npx vitest run tests/web/grok-proxy.test.ts tests/web/lan-sync.test.ts` 正常退出并通过；随后 `npm test` 正常退出并通过。

## 6. 完成 MIT License

- 新增标准 MIT `LICENSE`，版权主体使用 `Cing-self / OKIT contributors`，年份 2026。
- README License 段落改为 MIT 并链接文件，删除 TBD。
- npm 打包清单必须包含 `LICENSE`。

验收：`npm pack --dry-run --json` 中包含 `LICENSE`。

## 7. 前端入口分包

- 使用路由/页面级 `React.lazy` 或等价动态 import 拆分重量页面；不要改变现有 UI/UX。
- 提供一致的轻量加载占位，不能造成布局明显跳动。
- 不要仅提高 `chunkSizeWarningLimit` 隐藏警告。

验收：`npm run build` 通过，主入口 chunk 不再触发 1200 kB 警告；关键页面仍可加载。

## 8. 仓库、Skill 与文档一致性

- 保持所有公开仓库地址为 `https://github.com/Cing-self/okit`。
- 保持 npm 包名为 `@cing-self/okit-cli`。
- 保持 `skills/okit-cli/SKILL.md` 进入 npm 包。
- README 保留 `npx skills add Cing-self/okit --skill okit-cli`。
- Web 端口为 3780，LAN 同步默认端口为 3790。

验收命令：

```bash
git diff --check
npm run build
npm test
npm pack --dry-run --json --cache /tmp/okit-npm-cache
node dist/main.js skill path
node dist/main.js upgrade --help
```

最终报告必须逐项说明修改文件、验证结果和仍未解决的问题。不得宣称未执行的测试通过。

## 主验收补充项

Hy3 首轮实现完成后，主验收额外发现并修复了以下发布阻断问题：

- GitHub Release job 在全新 runner 上未安装依赖，现已在执行发布脚本前运行 `npm ci`。
- `pkg` 会因字面量 `node:sqlite` 中止，现保留 Node 22 运行时能力，同时允许 Node 18 二进制降级构建。
- `pkg` 实际默认产物名与发布脚本不一致，现明确输出 `okit-macos-arm64` / `okit-macos-x64`。
- 二进制原先未声明 Web 静态资源和 Skill 资源，现作为 `pkg.assets` 内嵌，并以真实二进制启动验证。
- 生产依赖审计原有 critical/high 公告；现升级可兼容依赖，并用原生、带签名向量测试的火山引擎请求实现替换旧 SDK。CLI 与前端 `npm audit --omit=dev` 均为 0。

开发依赖审计仍有公告（主要来自 Vite 工具链以及已停止维护的 `pkg`）；它们不进入 npm/二进制运行时，但应在后续将 Vite 升级到新主版本并迁移离开 `pkg`。
