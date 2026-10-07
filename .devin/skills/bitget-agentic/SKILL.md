---
name: bitget-agentic
description: >
  Use for Bitget Agentic account (AI Agent OAuth path, not manual API keys).
  Invoke when the user connects an Agentic account, re-authorizes, says Connect Agent,
  reports Key invalid/expired, cannot trade, asks about MCP auth status, or trades
  inside an Agentic account via @bitget-ai/bitget-agent-mcp — even without saying
  "Bitget". Chinese triggers: 连接 Agent、重新授权、Agentic 账户、Agent 子账户、Agentic
  子账户、Agent 账户、AI 账户、智能交易账户、Key 失效、连不上、Connect Agent、帮我下单、
  查 Agentic 余额/持仓. Do NOT use for generic UTA trading
  with env API keys (@bitget-ai/bitget-agent-skill). After OAuth, use this skill for
  runtime auth and trading safety.
metadata:
  version: 1.3.0
  author: Bitget
  updated: 2026-09-17
  requires:
    bins: ["node", "npx"]
    node: ">=20"
  packages:
    mcp: "@bitget-ai/bitget-agent-mcp"
license: MIT
---

# Bitget Agentic · 本地 Skill

**Agentic 账户专用** · OAuth + `@bitget-ai/bitget-agent-mcp` · **不是** `@bitget-ai/bitget-agent-skill`

**分工：** 本 Skill 负责 OAuth 成功后的运行时授权状态、重新授权、交易确认与安全边界。

**Rule Priority：** Safety > 状态诚实 > 响应速度

---

## 产品约束（内化即可）

- 1 MCP = 1 Agentic 账户 = 1 套凭证（OAuth 落盘，**禁止** env 手填 Key）
- 多 Key 并存；再 OAuth 发新 Key、不删旧 Key；本机绑定被**覆盖**（其他 Agent/设备不受影响）
- Web 只读 Key 数 → Agent **不得**声称知道 Web 有几把 Key
- 断链 / Key 失效 → **完整 OAuth**；无一键重发、无静默重链
- Scope 外：提币、主账户、主→子划转 → Agent **不做**
- OAuth 仅 MCP/SDK 监听 callback；**禁止** LLM 拼 URL / 监听端口 / 收粘贴三件套
- 凭证落盘后可**立即**交易，**无需重启 Agent**
- 未授权时行情等无需 Key 的公开能力仍可用；交易类能力不可用

---

## 1. 授权状态

先 `get_auth_status`，再说话。

| 状态 | 交易 | 用户提示与下一步 |
|------|------|------|
| 未授权 | 否（`market` 除外） | 提示「需要先完成 Agentic 授权，我来打开浏览器」→ 调授权 tool |
| 已授权 | 是 | 确认状态与交易工具可用后再交易 |
| 凭证失效 | 否 | 提示「凭证已失效，需重新授权」→ 调授权 tool |

API 鉴权失败但 status 仍「已授权」→ 按**失效**处理。access token 24h 过期**不影响**已有交易 Key。

---

## 2. 重新授权（核心）

**触发：** 重新授权 / Connect / Key 失效 / 连不上 / 帮我连接 Bitget

```
get_auth_status → 一句告知会替换本机绑定、Web 旧 Key 仍保留
→ 立即调 MCP authorize_start → 用 Bash 打开 authorizeUrl（勿只贴文本让用户复制）
→ 调 MCP authorize_wait → App 设备鉴权 → 确认已授权
```

**打开 authorizeUrl：** 拿到 `authorize_start` 返回的 `authorizeUrl` 后，立即用 Bash 打开，不等用户手动复制粘贴：
- macOS: `open "<authorizeUrl>"`
- Linux: `xdg-open "<authorizeUrl>"`
- Windows: `start "" "<authorizeUrl>"`

若 Bash 打开失败（无 GUI/无浏览器/命令不存在），才回退成把链接文本发给用户自行打开。**URL 本身必须原样使用 MCP 返回值，禁止 LLM 自行拼接或修改。**

**成功判定：** 只有 MCP 明确返回已授权且凭证已保存，才算成功；打开浏览器 ≠ 授权成功。否则提示「授权未完成」。

**提示（二次 OAuth 前）：** 「再次授权会更新本机凭证；Web 上旧 Key 默认保留；其他 Agent/设备不受影响。」

**禁止：** 只给说明链接/文字而不真正调 MCP 授权 tool · 让用户粘贴 Key · 承诺一键重发

**后端要点：** 成功 = MCP 已授权 + 浏览器走完；仅浏览器成功 → 再调 OAuth。Web 点「绑定更多 Agent」≠ 本机已连，须本机 MCP callback。

---

## 3. 边界 Case

### 3a. 用户主动操作（用户明说即可感知，不是失败）

| 场景 | 动作 | 提示（对用户，可改写） |
|------|------|------------------------|
| H 只问行情 | `market` | 不强迫 OAuth |
| J 要断链 | 引导 Web 删 Key | 「请到 Agentic 账户 API 管理删 Key；先处理挂单/持仓。删除 Key 会取消该 Agent 的交易权限，不会自动平仓，也不会自动撤销挂单。」 |
| F 二次 OAuth | 告知 + 调 OAuth | 见 §2 |

### 3b. 失败处理（只按错误码归因，无错误码一律兜底）

**错误码 → 动作：** 调用授权/交易 tool 返回明确错误码时，按错误码处理，Agent 不需要猜背后原因：

| 错误码 | 动作 | 提示 |
|--------|------|------|
| `NOT_AUTHORIZED`（A 未授权要交易） | 调 OAuth | 「需要先完成 Agentic 授权，我来打开浏览器。」 |
| `AUTH_CANCELLED`（B 用户取消） | 再调 OAuth | 「这次没保存凭证，要我再试一次吗？」 |
| `CREDENTIALS_INVALID`（D Web 删 Key / Key 失效） | 调 OAuth | 「Key 已在服务端失效，需重新授权。」 |
| `RATE_LIMITED`（N 限流） | 退避 | 「请求过快，稍后再试。」**勿** OAuth |
| `INSUFFICIENT_BALANCE`（O 余额不足） | 引导 Web 划转 | 「请在 Web 从主账户划转到 Agentic 账户。」 |
| `MCP_CONNECTION_ERROR`（M MCP 未启动） | 排查 MCP | 「MCP 未运行，请检查 Node 20+ 与 MCP 配置。」 |
| 配额错误码（K 配额满） | Use existing | 「Agentic 账户已满，请选已有账户。」 |
| KYC 错误码（L KYC 未完成） | 完成后再 OAuth | 「请先完成 KYC。」 |
| 工具不存在 / 方法不存在（M2 MCP 未安装/未注册） | 引导安装并注册 | 「MCP 工具不存在：请运行 npm i -g @bitget-ai/bitget-agent-mcp 安装，再在客户端注册（如 Claude Code 执行 claude mcp add bitget-agentic -- npx -y @bitget-ai/bitget-agent-mcp），然后重启会话或用 /mcp 重连。」 |

**兜底（无明确错误码）：** 通用失败 / 超时 / 回调未收到 / 浏览器状态不确定时，Agent 无法知道具体原因（是取消、是没点完、是页面关了），**不猜原因**，统一：
> 「授权未完成。请确认浏览器授权步骤已完成，要我再发起一次吗？」

并重新走一遍授权流程（§2）。

**其他错误码归因：** 设备鉴权失败 → 不发 Key → 查 App 同账号 → 再 OAuth（**不是** Key 失效）；`MCP 缺失 vs 未启动`：报"工具不存在/方法不存在"是未安装或未注册（走 M2），不是未启动，两者都不是授权问题，不要引导重新授权。

### 3c. 其他状态（非错误）

| 场景 | 动作 | 说明 |
|------|------|------|
| C 浏览器成功但 MCP 未收到 | 再调 OAuth | Agent 只能看到"回调未收到"，不能确认浏览器是否真成功；无明确错误码时走兜底 |
| E Web 有 Key 本机无 | 调 OAuth | 「Web 已连上不等于本机 Agent；请重新授权，不要复制 Key。」 |
| G Key 归零 | 调 OAuth | 「Agentic 账户已断链，需完整重新授权。」 |
| P 云端 Agent | 告知用户后结束，不触发 OAuth | 「云端流程暂未开放，`[待填：resource endpoint]` 定义中；请先使用本地客户端。」 |
| Q 历史户 / V Playbook / W 手填 Key / T 多 Agent / X 0 余额 | `[待填：各场景处理规则]` | 规则待补充，运行时不要自行假设处理方式 |
| R bitget.com 网络不可达 | 排查代理后 OAuth | 「当前网络可能无法访问 bitget.com。我先检查本机 VPN/代理…」→ §5 |

---

## 4. 交易（已授权）

```
get_auth_status → discover → dryRun → 主网确认卡 → 用户确认「是/确认」→ 执行（高-risk + confirm）
```

**确认卡必含：** 交易对 · 方向 · 数量 · 价格类型 · 账户 · `[主网]` · 「确认执行？」  
「直接帮我做」≠ 预授权。用户必须明确回复确认后才执行。

**要点：** 平仓先查仓 · hedge 要 posSide · Spot 市价买 qty=USDT · 持仓须带**强平价** · risk 类错误勿加仓

**首次交易：** 用户表达交易意图时先确认 Agentic 账户资金、先查余额；资金不足引导用户手动入金后再交易；Agent 不操作主账户。

**提币（必拒）：** 「Agentic 账户不含提币；请 Web 主账户操作，Agentic 账户资金须先划转到主账户。」提币、主账户操作、主→子划转均需用户手动完成，Agent 不代办。

**错误 category：** auth→OAuth(D/E) · balance→O · rate→N · risk→停 · param→改参 · network→§5

---

## 5. 网络与代理（bitget.com）

重新授权（§2）或 OAuth 换 Key 时，MCP/SDK 需访问 **bitget.com**。部分地区无法直连，表现为授权 tool 超时、连接失败、回调未收到。

**Agent 必须主动处理：**

1. **识别网络问题：** 错误含 timeout / ECONNREFUSED / ENOTFOUND / network / fetch failed / 无法连接 bitget.com，或用户表示地区受限。
2. **主动探测本机代理：** 查 `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY`、系统代理、常见 VPN 本地端口（如 `127.0.0.1:7890`）。**有代理** → 配置 MCP/shell 走代理后**重新走 §2 授权流程**。
3. **无可用代理** → 提示用户开 VPN/代理访问 bitget.com；**等用户确认已开好**后再重新授权。
4. **禁止：** 未排查网络就反复 OAuth · 拼 URL 绕过 MCP · 让用户手填 Key。

§3 Case **R**（地区网络）→ 本节。

---

## 6. 补充组件（一并安装，可选）

除 `@bitget-ai/bitget-agent-mcp`（OAuth + 交易）外，有两个可选组件。**禁止** `upgrade-all`（会连带装上 `bitget-signal`/datahub）；行情用 **B**，终端 `bgc` 用 **A**（勿与 Agentic Skill 混为同一 Skill）。

**A · 终端交易工具链（需 API Key / 或与 MCP 并存，无 signal）**

```bash
npm i -g @bitget-ai/bitget-agent-cli
npx @bitget-ai/bitget-agent-installer upgrade @bitget-ai/bitget-agent-cli --target all
npx @bitget-ai/bitget-agent-installer upgrade @bitget-ai/bitget-agent-skill --target all
```

安装 `bgc` CLI 与 UTA 交易 Skill（`~/.claude/skills` 等）；**不含** `bitget-signal`。`--target all` 指 installer 支持的 claude / codex / openclaw；Cursor 用户已装 Agentic Skill，交易以交易 MCP 为主，A 为可选（终端跑 `bgc`）。安装后重启客户端或新开会话。

**B · 云端 Market MCP（HTTP，无需 Key）**

- **Claude Code：** `claude mcp add bitget-mcp-server --transport http https://agent.bitget.com/mcp`
- **Cursor：** MCP 设置新增 HTTP server，URL `https://agent.bitget.com/mcp`
- **其他客户端：** 按 HTTP MCP 方式注册，endpoint `https://agent.bitget.com/mcp`

与 stdio 交易 MCP **并存**，不要替换。安装后重启会话或 MCP 重连。

---

## 7. 禁止（违反即错）

静默重链 / 粘贴或 env 配 Key / 代删 Web Key / 失效仍交易 / 限流当失效 / 只给链接不调 OAuth / LLM 监听 callback / 无法确认失败原因时猜测归因 / 网络问题未排查代理就反复 OAuth
