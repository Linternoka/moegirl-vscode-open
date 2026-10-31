# 萌百 → VS Code 小工具

在萌娘百科条目页点一个悬浮球，把当前条目的 wikitext 源码写到你电脑上的指定目录，并自动用 VS Code 打开。

> **本工具由 AI 辅助生成，未经完整测试，不保证可用性。** 使用前请自行审阅代码；因使用造成的任何问题自负。

## 组成

1. `user-script.js` —— 站内用户脚本，显示悬浮球、抓取源码
2. `server.mjs` —— 本机桥，监听 `127.0.0.1:8765`，负责落盘并调用 VS Code
3. `start-server.ps1` / `stop-server.ps1` —— Windows 下启停桥

浏览器里的 JS 不能直接写磁盘，所以必须有本机这个桥。

## 安装

### 1. 本机桥

需要 Node.js 18 以上。

```bash
cp config.example.json config.json     # 然后改里面的 token 和 vault
node server.mjs
```

`config.json` 说明：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `port` | `8765` | 监听端口，改了要同步改 `user-script.js` 里的 `BRIDGE` |
| `token` | `change-me-please` | 两端共享的口令，随便换成你自己的 |
| `vault` | 空（用 `./drafts`） | 源码落盘目录 |
| `idleMinutes` | `30` | 空闲多少分钟自动退出，0 = 不退出 |
| `openInVSCode` | `true` | 写完是否调用 `code -r` 打开 |

### 2. 站内脚本

把 `user-script.js` 的内容提交到你自己的用户页（例如 `User:你的用户名/js/moegirl-vscode-open.js`），
再在你的 `common.js` 里加载：

```js
mw.loader.load("/index.php?title=User:你的用户名/js/moegirl-vscode-open.js&action=raw&ctype=text/javascript");
```

注意把 `user-script.js` 开头的 `TOKEN` 改成和 `config.json` 一致。

### 3. 使用

打开任意条目 → 点悬浮球（可拖动，默认左下角）→ 源码写入 `vault` 目录并用 VS Code 打开。

右键菜单还有：强制覆盖、打开素材目录、本机桥状态。

## 已知限制

- 只在 Windows + Node.js 上测过，其他系统未验证。
- 需要先登录萌娘百科（脚本用页面登录态调 API）。
- 部分网络环境（校园网、有 DNS 污染的网络）可能连不上萌百 API 或 CDN。
- 提交功能会覆盖整页源码，务必先确认内容完整。

## 许可

未指定，使用前请自行判断。
