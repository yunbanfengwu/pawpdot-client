# PawPdot Client

PawPdot Client 是一个基于 Electron 的桌面容器，用来承载 DeepSeek Harness、PawPdot 首页、宠物家园、手机连接器和其他可插拔功能。

## 主要能力

- 使用 Electron 提供 Windows 桌面窗口、无边框标题栏和主题切换。
- 启动并托管 DeepSeek Harness，统一加载 PawPdot 工作台。
- 支持宠物身份、宠物家园、旅行与家具等插件化体验。
- 提供手机连接器、二维码配对、消息中继和语音通话等扩展点。
- 通过隔离的 preload、context isolation 和权限拦截，限制桌面窗口与插件页面的访问边界。

## 环境要求

- Windows 10/11（当前启动器针对 Windows 做了 Electron 运行时缓存处理）
- Node.js `>= 24.9.0`
- npm

## 安装与启动

```powershell
npm install
npm start
```

`npm start` 会启动 `backend/launch.cjs`，由它准备 Electron 运行时并打开 PawPdot 桌面窗口。

首次启动如需安装 Harness 插件，可在 Harness profile 中执行类似命令：

```powershell
$env:DSH_HOME = Join-Path $env:APPDATA 'Pawpdot Client/harness'
node --expose-internals node_modules/@deepseek-ai/dsh/lib/bin.js plugin --profile web add ./frontend/pet ./plugins/pet-home
```

## 目录结构

```text
backend/    Electron 主进程、窗口、安全边界和 Harness 启动逻辑
frontend/   PawPdot 工作台、品牌界面和宠物页面
plugins/    宠物家园、手机连接器、动态岛、语音等插件
shared/     终端 UI、消息中继和通用协议模块
doc/        架构说明与验证记录
assets/     客户端运行所需的品牌资源
```

## 开发说明

```powershell
npm install --ignore-scripts
npm start
```

项目目前以源码运行方式为主。插件各自的 README 和 `doc/` 中包含更细的安装、协议及验证说明。

## 安全提示

- 不要把 API key、访问令牌、个人配置或运行时数据提交到仓库。
- 语音能力通过 `DASHSCOPE_API_KEY` 等环境变量读取密钥。
- 运行时数据默认保存在用户目录下的 `PawPdot Client`，不属于源码仓库。

## 开源许可

本仓库采用 MIT License，见 [LICENSE](LICENSE)。第三方资源和插件可能有各自的授权条款，请同时阅读对应目录中的许可证和声明文件。
