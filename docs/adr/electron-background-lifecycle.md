# ADR-3：Electron 后台采集生命周期

> 状态：Draft r2（2026-08-15 第四轮评审修订 + 第五轮收口；配合商业化方案 v2.1 §4）
> 现状基线：`src/electron/main.ts:138`——`window-all-closed` 时非 macOS 直接 `app.quit()`；当前无托盘驻留。
> 现状轮询基线：现有实现为常规 5 分钟轮询、额度临近重置时**加快**到 1 分钟（不是"空闲 1 分钟"）。

## 1. 决策

"关闭主窗口 = 退出应用"改为"隐藏到托盘，后台采集继续"；托盘"退出"走 **`app.quit()` + `isQuitting` 标记**（不用 `app.exit()`——它跳过 `before-quit`/`will-quit`，会绕过队列落盘等清理逻辑）。采集调度在主进程内实现，配合单实例锁、按平台能力分级调度与幂等上传。

## 2. 生命周期状态机

```text
running(前台) --关窗(close事件)--> backgrounded(托盘,采集运行)
backgrounded --托盘点击--> running
backgrounded --托盘"退出"(app.quit)--> before-quit: isQuitting=true, 落盘队列
    --> will-quit --> exited(无任何后台活动)
系统休眠 --> suspended --powerMonitor resume--> 重新调度(补采一轮)
断网 --> pending(本地队列) --online--> 重试上传(指数退避)
```

退出链路实现：

```text
before-quit → isQuitting = true
窗口 close 事件：
  isQuitting === false → preventDefault + hide()（托盘驻留）
  isQuitting === true  → 不拦截，正常关闭（走清理逻辑）
托盘"退出" → app.quit()（绝不 app.exit()）
```

**第二实例处理**：主实例监听 `second-instance` 事件——恢复（若隐藏则 show）并聚焦主窗口；第二实例 `requestSingleInstanceLock()` 失败后直接退出。不是只有"第二个退出"，主实例必须响应。

## 3. 本地事件队列（usage queue）

- **JSONL 追加写 + 启动恢复 + 原子压缩**：每行一个事件（含 `event_id`），追加即返回；后台周期性原子重写（tmp + rename）压缩已确认上传的行；
- **崩溃语义（如实）**：append 中被 `kill -9` 仍可能留下**不完整的最后一行**；未 `fsync` 时丢失范围也不受"一行"限制。恢复策略：启动时校验行完整性，**截断非法尾行**，保证**此前完整事件可恢复**；需要强持久性的场景按批 `fsync`（每 N 条或每次压缩后）；
- MVP 不引入 SQLite；容量上限（如 10k 行）+ 最旧淘汰；
- 重试重传同一 `event_id`，服务端 `(user_id, event_id)` 幂等去重（ADR-1）。

## 4. 适配器后台能力声明

并非 37 个用量 provider ID 都能静默后台跑（部分依赖浏览器会话/扩展/交互式登录；多个 ID 可能共享适配器实现，能力按实现声明、按 ID 继承）。每个适配器声明：

```ts
interface UsageAdapterCapabilities {
  backgroundSafe: boolean;          // 可在后台静默采集
  requiresInteractiveLogin: boolean; // 凭据失效时需要用户回到前台
  supportsHeadless: boolean;         // 无头环境可用
  minPollInterval: number;           // 该平台允许的最小轮询间隔(分钟)
}
```

后台规则：

- **后台任务绝不自动打开浏览器、终端或登录界面**；
- 凭据失效/需要交互 → 标记账号 `needs_user_action`，状态页与托盘 tooltip 提示，等用户回前台处理；
- `backgroundSafe=false` 的适配器只在前台窗口打开时采集；
- 调度不搞"37 平台每 15 分钟齐步走"：按 `minPollInterval` 分平台设默认间隔 + **随机抖动**（错峰）+ 失败退避（翻倍至平台上限）。

## 5. 调度策略（对齐现状）

- 常规 5 分钟轮询（延续现有实现）；额度临近重置（`reset_at` 前 2h 内）**加快**至 1 分钟（现状已有，保留并后台化）；
- 每账号独立下次采集时间（错峰）；后台模式默认降频至平台 `minPollInterval` 与用户设置（5–60min）的较大者；
- `powerMonitor`：`suspend` 暂停计时器；`resume` 重建调度并补采一轮。

## 6. 失败可见性

- 采集/上传失败**不弹窗**；状态页 + 托盘 tooltip 汇总（最近错误、`needs_user_action` 列表、队列深度、下次采集时间）；
- 首次隐藏到托盘时气泡提示一次"OKIT 仍在后台运行"（可关闭）。

## 7. 诚实边界（产品文案约束）

- "持续监控" = 窗口关闭但进程在跑；彻底退出/关机/离线 = 停止；
- 不宣传"全天候云端监控"；不与"自愿托管凭证"模式（未来可选项）混淆。

## 8. 验收清单（Windows/Linux 重点）

- [ ] 关闭主窗口 10 分钟后进程存活、采集日志持续、事件入队/上传正常；
- [ ] 托盘"退出"后进程消失、**优雅退出路径队列完整落盘**（app.quit() 触发 before-quit 清理）、无残留进程与采集活动；
- [ ] `kill -9` 模拟崩溃：**半截尾行在下次启动时被自动截断恢复**，此前**已 fsync 的完整记录**零丢失（未 fsync 的页缓存数据允许丢失，与 §3 崩溃语义一致）；
- [ ] 双击图标二次启动 → 主实例恢复并聚焦窗口，不产生第二个采集器；
- [ ] 休眠 1 小时恢复 → 自动补采一轮，无重复事件（幂等验证）；
- [ ] 断网期间事件在网络恢复后全部上传且无重复；
- [ ] `requiresInteractiveLogin` 适配器凭据失效 → 仅 `needs_user_action` 标记，无浏览器/窗口自动弹出；
- [ ] 采集失败 10 次连续 → 无任何弹窗，状态页可查；
- [ ] 开机启动开关生效（三平台）。
