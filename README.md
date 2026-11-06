<div align="center">

# dsh-auto-preset-guard

**让「自动审批」熬过重启 —— 退出 DSH 不再被改写成「完全权限」**

[![License](https://img.shields.io/badge/license-MIT-3E63DD?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522.19-3E63DD?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![DSH plugin](https://img.shields.io/badge/DSH-plugin-4D6BFE?style=flat-square)](https://github.com/deepseek-ai/deepseek-harness)
[![English](https://img.shields.io/badge/English-version-8B5CF6?style=flat-square)](#english-version)

</div>

---

> **状态：上游已修复，本插件不再需要。** DSH 从 `0.2.2-rc.1` 起，自动审查的退场迁移已带 `ctx.root.fiber.state === ACTIVE` 判断（上游提交 `4923f3cb`「fix(auto-review): preserve Auto during application shutdown」），退出应用不再改写会话。仓库与 npm 包保持原样，供仍在 `0.2.1-rc.*` 上的环境使用。

## 🌟 这是什么

会话里选过 **自动审批**（`auto`），关掉 DSH 再打开，它变成了 **完全权限**（`danger-full-access`，审批策略 `never`）。

不是没保存，是退出时被主动改写了，而且改成了更大的权限。

[`@deepseek-ai/dsh-experimental-auto-review`](https://github.com/deepseek-ai/deepseek-harness) 在退场（effect disposer）里会把所有当前是 `auto` 的会话迁移到完全权限：

```js
for (const session of ctx.sessions.list()) {
  if (permissionPresets.current(session) !== AUTO_PRESET) continue
  permissionPresets.set(session, 'danger-full-access')   // 写进会话日志
}
```

`set()` 不是改内存：它往会话日志追加 `permission/preset: danger-full-access` 和 `approval/policy: never`，所以这个迁移是持久的。

问题在于**这个 disposer 在「应用退出」时同样会跑**，而它本意只在「运行中把插件卸载掉」时才该跑——上游的设计笔记写得很明确：关闭应用应当保留选择，只有活体卸载才迁移。插件自己分不清这两件事，于是每次退出都执行了迁移。

上游已在 `4923f3cb`（「fix(auto-review): preserve Auto during application shutdown」）修掉，判据是 `ctx.root.fiber.state` 是否仍是 ACTIVE；该修复进入 `0.2.2-alpha.2` 及以后，`0.2.1-rc.*` 仍是裸循环。

同一个 bug 的第二个后果：存着 `auto` 的会话在集成缺席时无法重新发布，`pinInitialPermission` 抛 `permission: cannot restore preset "auto" without its active integration`，这种会话干脆打不开。

## 🧩 它做两件事

本插件是常驻的 host 行，只在运行期包裹 `permissionPresets` 服务，**不修改安装目录里的任何包**，升级 DSH 不会被覆盖。

| # | 行为 | 说明 |
|:--|:--|:--|
| 1 | 关机窗口内的 `set(session, 'danger-full-access')` 被忽略 | root fiber 不是 ACTIVE（PENDING / LOADING / FAILED / DISPOSED / UNLOADING）且会话当前是 `auto` 时不写入，会话日志零事件 |
| 2 | `pinInitialPermission` 不再为「auto 缺集成」抛错 | 会话按存储的身份正常打开，不追加降级事件 |

判据来自 cordis 自身的卸载顺序：root 先进入 `UNLOADING`(5)，**之后**才逐个跑子插件的 disposer。因此在 disposer 阶段读到的 root 状态就是「应用正在退出」。运行中把插件卸掉时 root 仍是 ACTIVE，迁移照常发生——这是上游本来就要的行为，插件不干预。

两个包裹都只在服务实例上装一次（`Symbol.for` 标记）。**dispose 时故意不解包**：本行通常先于 `auto-review` 被 dispose，在那里还原原方法等于把关机迁移还回去。

宿主无法识别时不做事：`root.fiber.state` 不是数字，一切调用保持原样。

## 🚀 安装

两个来源等价：npm 上的 `0.1.0` 就是 `main` 上的 v0.1.0 tag。

```sh
# 从 npm
dsh plugin --profile desktop add dsh-auto-preset-guard

# 从 GitHub
dsh plugin --profile desktop add "github:SternChiri/dsh-auto-preset-guard"
```

> profile 的 `.npmrc` 若指向镜像源（如 `registry.npmmirror.com`），刚发布的版本可能还没同步；先把该源的 `registry` 改回 `https://registry.npmjs.org` 再装。

装完重启 DSH。`package.json` 声明了 `dsh.bundle.patch`，reconciliation 会自动插入这一行：

```yaml
- insert:
    - id: dsh-auto-preset-guard
      name: dsh-auto-preset-guard
```

卸载：

```sh
dsh plugin --profile desktop remove dsh-auto-preset-guard
```

> 关掉或移除本插件后，若安装的 DSH 仍带裸循环，退出时就会重新迁移。要不要用它，取决于你的版本是否已含上游修复。

### 让本机 Agent 替你装

把下面这段原样丢给本机 DSH：

```text
请帮我安装 dsh-auto-preset-guard（仓库：https://github.com/SternChiri/dsh-auto-preset-guard）。先读该仓库 README 的「安装」，用 dsh plugin 把它装进 desktop profile，重启 DSH 后确认插件行为 active，并告诉我怎么验证「自动审批」在重启后被保留。
```

## ✅ 验证

`test/` 里两个脚本直接跑**安装目录里真实的 cordis 运行时**，不需要 DSH 启动：

```sh
node test/verify.mjs        # 关机保留 / 活体卸载仍迁移 / 缺集成不抛 / 无关错误照抛
node test/proxy-check.mjs   # 服务代理语义：提前捕获的引用也能派发到包裹后的方法
```

默认从 `@deepseek-ai/cordis` 解析运行时（在 profile 里安装时就是宿主那份）。DSH 装在非常规位置或运行时在归档（asar）内时，用 `DSH_CORDIS` 指向它的入口文件：

```sh
DSH_CORDIS=/path/to/node_modules/@deepseek-ai/cordis/lib/index.js node test/verify.mjs
```

`verify.mjs` 覆盖四项：运行期卸载集成仍把 `auto` 迁到完全权限；root 进入 UNLOADING 后迁移零写入且身份仍是 `auto`；缺集成的会话打开不抛错；其它发布错误照常抛出。

`proxy-check.mjs` 验证插件唯一依赖的运行时假设：`auto-review` 在 apply 时捕获的 `const permissionPresets = ctx.permissionPresets`，在包裹之后仍派发到包裹后的方法，而普通预设写入仍到达服务本体。

设 `DSH_AUTO_PRESET_GUARD_DEBUG=1` 可打印每一次被拦下的写入。

## 🗺️ 已知边界

- 只拦 `auto → danger-full-access` 这一种写入，其它预设变更一律放行。
- 只在本行处于 active 时生效。若安装的 DSH 仍带裸循环而本插件被禁用，退出照样迁移。
- 不碰沙箱值、持久终端、会话数据；无 UI、无设置项。
- 依赖 cordis 的卸载顺序，属于运行时实现细节。上游修复落地后，本插件可原样卸载，无需清理。

## 📄 License

MIT —— 详见 [LICENSE](LICENSE)。

---

<a id="english-version"></a>

# dsh-auto-preset-guard

**Keep the Auto permission preset across DSH restarts — quitting no longer rewrites it to Full access.**

> **Status: fixed upstream, no longer needed.** From DSH `0.2.2-rc.1` the auto-review disposer checks `ctx.root.fiber.state === ACTIVE` before migrating (`4923f3cb`, "fix(auto-review): preserve Auto during application shutdown"), so quitting the app no longer rewrites a session. The repository and the npm package stay as they are for environments still on `0.2.1-rc.*`.

## 🌟 What this is

Pick **Auto review** (`auto`) in a session, quit DSH, open the session again: it is now **Full access** (`danger-full-access`, approval policy `never`).

It is not a lost save. The preset is rewritten on the way out, upward.

`@deepseek-ai/dsh-experimental-auto-review` migrates every live `auto` session to Full access from its effect disposer:

```js
for (const session of ctx.sessions.list()) {
  if (permissionPresets.current(session) !== AUTO_PRESET) continue
  permissionPresets.set(session, 'danger-full-access')
}
```

`set()` persists: it appends `permission/preset: danger-full-access` and `approval/policy: never` to the session log.

The migration is meant for **removing the integration while the app runs**. It also runs during **application shutdown**, where the selection should survive. Upstream fixed that in `4923f3cb` ("fix(auto-review): preserve Auto during application shutdown") by checking `ctx.root.fiber.state`; the fix ships from `0.2.2-alpha.2`, while `0.2.1-rc.*` still carries the unconditional loop.

The same bug has a second edge: a session stored as `auto` cannot be republished without the integration — `pinInitialPermission` throws `permission: cannot restore preset "auto" without its active integration`, and the session fails to open.

## 🧩 What this plugin does

One always-on host row that wraps the live `permissionPresets` service. It patches no shipped package, so a DSH upgrade does not remove it.

| # | Behaviour | Detail |
|:--|:--|:--|
| 1 | `set(session, 'danger-full-access')` is dropped inside the shutdown window | When the root fiber is not ACTIVE and the session is currently `auto`, nothing is written — zero session events |
| 2 | `pinInitialPermission` stops throwing for "auto without its integration" | The session opens with its stored identity and no downgrade event |

The signal comes from cordis itself: the root enters `UNLOADING`(5) **before** any child disposer runs, so a disposer that reads the root state knows the app is shutting down. Removing the plugin while running keeps ACTIVE, so the stock migration still happens — that is upstream's intent and is left alone.

Both wrappers install once per service instance (`Symbol.for` marker) and are deliberately **never unwrapped on dispose**: this row usually unloads before `auto-review`, and restoring the original method there would hand the shutdown migration back.

Unknown hosts are untouched: if `root.fiber.state` is not a number, every call behaves exactly as before.

## 🚀 Install

Both sources ship the same code: `0.1.0` on npm is the v0.1.0 tag on `main`.

```sh
# from npm
dsh plugin --profile desktop add dsh-auto-preset-guard

# from GitHub
dsh plugin --profile desktop add "github:SternChiri/dsh-auto-preset-guard"
```

> If the profile's `.npmrc` points at a mirror (for example `registry.npmmirror.com`), a freshly published version may not be mirrored yet; point that registry back at `https://registry.npmjs.org` before installing.

Restart DSH afterwards. `package.json` declares `dsh.bundle.patch`, so reconciliation inserts the row automatically.

```sh
dsh plugin --profile desktop remove dsh-auto-preset-guard
```

> Disable or remove this plugin while the installed DSH still ships the unconditional disposer, and quitting migrates again.

## ✅ Verify

```sh
node test/verify.mjs        # shutdown preserves, live removal still migrates, missing integration no longer throws
node test/proxy-check.mjs   # service proxy semantics
```

Both drive the **real** cordis runtime shipped in the installation. Resolution defaults to `@deepseek-ai/cordis`; point `DSH_CORDIS` at its entry file when the runtime lives inside an asar archive or an unusual location.

Set `DSH_AUTO_PRESET_GUARD_DEBUG=1` to log every suppressed write.

## 🗺️ Known limitations

- Only the `auto → danger-full-access` write is suppressed; any other preset change goes through untouched.
- Effective only while this row is active. Disabled, and the shipped loop migrates as before.
- No sandbox, terminal, or session-data changes; no UI, no settings.
- Depends on cordis unload ordering, a runtime implementation detail. Once the upstream fix is in your build, uninstall this plugin.

## 📄 License

MIT — see [LICENSE](LICENSE).
