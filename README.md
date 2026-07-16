# Account Quota Desktop Widget

一个本地运行的 Sub2API 账号额度面板，包含完整网页面板和 Windows 桌面挂件模式。

## 功能

- 本地网页面板：新增、编辑、删除账号并手动刷新额度。
- 桌面挂件：透明无边框窗口，固定显示账号余额和今日/本月额度。
- 自动刷新：默认每 60 秒刷新一次账号数据。
- 本地存储：账号、token、登录邮箱和密码只保存在本机 `data/accounts.json`。
- Clash 代理：后端访问远端 Sub2API 站点时默认走 `http://127.0.0.1:7890`。

## 安装

```powershell
npm.cmd install
```

## 启动网页面板

```powershell
npm.cmd start
```

然后打开：

```text
http://127.0.0.1:3847/
```

## 启动桌面挂件

```powershell
npm.cmd run desktop
```

也可以运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-desktop.ps1
```

## 环境变量

可以复制 `.env.example` 作为参考。当前代码主要读取这些环境变量：

```text
HOST=127.0.0.1
PORT=3847
CLASH_PROXY_URL=http://127.0.0.1:7890
```

如果不设置 `CLASH_PROXY_URL`，默认使用 Clash 常见 HTTP 代理端口 `http://127.0.0.1:7890`。

## 数据和隐私

- 真实账号数据会写入 `data/accounts.json`。
- `data/` 已加入 `.gitignore`，不要提交到公开仓库。
- 请不要提交迁移包、桌面设置、日志文件或 `.env`。
- 返回给前端的账号数据会隐藏 access token 和 refresh token，但本地数据文件仍包含敏感信息。

## 开发结构

```text
desktop/   Electron 桌面壳
public/    前端页面
server/    本地 HTTP 服务和 Sub2API 请求逻辑
scripts/   Windows 启动辅助脚本
assets/    图标资源
```

## License

MIT
