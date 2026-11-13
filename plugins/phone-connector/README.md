# PawPdot 手机连接

这是从 AuDoter 手机连接插件迁入的 PawPdot 适配。PawPdot 直接复用统一 `audoter.relay.v1` 中继协议、终端身份、扫码配对、设备撤销、会话目录、流式 RPC、附件和语音桥接，手机端无需改造。

插件由 `backend/harness.cjs` 写入 PawPdot 的独立 Harness profile。服务端入口是 `/api/audoter/phone`，配置页面注册到 PawPdot 的插件详情项，不占用工作台侧栏，也不注册 `main` 页面。浏览器界面使用 PawPdot 自己的 `/pawpdot/tokens.css`。

打开 PawPdot 的“插件”页，找到“手机连接”并进入详情，即可生成连接二维码、复制连接码、重连或关闭中继、查看设备并撤销授权。

连接器会读取当前执行上下文提供的 `AUDOTER_RELAY_CONTROL_ORIGIN`、`AUDOTER_RELAY_BRIDGE_KEY` 和 `AUDOTER_RELAY_ASSIGNMENT_ID`。这些变量缺失时，页面会显示“未配置”，不会创建未授权的中继连接。PawPdot 继续继承启动进程的环境变量，账号和中继授权由上层运行时负责。

日常开发只需重启 PawPdot 开发版。验证服务是否加载：

```powershell
@'
const { startHarness } = require('./backend/harness.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pawpdot-phone-'));
const abort = new AbortController();
startHarness(root, abort.signal).then(async host => {
  const response = await fetch(host.origin + '/api/audoter/phone', {
    headers: { cookie: host.cookie, origin: host.origin },
  });
  console.log(response.status, await response.text());
  abort.abort();
  host.child.kill();
});
'@ | node --input-type=commonjs
```

没有账号空间授权时，预期返回 200 和 `status: "unconfigured"`。完成授权后，页面可生成 `audoter://relay` 连接码并查看已绑定设备。
