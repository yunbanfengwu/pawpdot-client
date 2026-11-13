# 宠物家园与旅行

独立的 DSH 组合包 `@pawpdot/pet-home`，关联主宠物插件 `@pawpdot/client-pet` 提供的持久宠物身份。

首页使用 Three.js 渲染可交互房间和院子。支持宠物自主散步、休息、点击互动，家具添置、收纳、旋转、摆放，森林、海岸和山丘旅行，纪念品与旅途币，日光、暮色和雨夜氛围。

## 安装与使用

在 PawPdot 使用的 Harness profile 中安装两个目录。

```powershell
$env:DSH_HOME = Join-Path $env:APPDATA 'Pawpdot Client/harness'
node --expose-internals node_modules/@deepseek-ai/dsh/lib/bin.js plugin --profile web add ./frontend/pet ./plugins/pet-home
```

启动客户端，在首页的“宠物”入口领养伙伴。插件页的“已安装插件”分组可分别管理这两个包。主宠物是家园的运行依赖，主宠物停用时，家园会等待它恢复。

家具添置后进入仓库，选择家具，再点击地面摆放。家具位置自动保存。旋转会重新检查碰撞，收纳保留家具所有权。新家提供六件家具和 120 旅途币。三条演示旅行分别持续 60、90、120 秒，完成后带回纪念品与旅途币，提前回家结束当次旅行。旅行时间按宿主时间结算，切换到工作页、关闭首页和重启均可继续结算。

## 插件协作

- 主宠物通过 Cordis `pawpdotPet` 服务提供 `getSnapshot()`、`adopt(species)`、`subscribe(listener)`、`registerGame({ id, title, href })`、`openGameStore(gameId, initial)`。
- 家园按持久的 `companion.id` 存档。切换回来时恢复同一只宠物的家具、旅行和收藏。
- 主宠物身份保存在 profile 的 `pawpdot-pet.json`，家园存档为 `pawpdot-pet-game-home.json`。
- 浏览器通过 `/api/pawpdot/pet` 与 `/api/pawpdot/pet-home` 访问认证后的状态。
- 首页通过现有 `pawpdot.home.pet` 插槽挂载。家园以更高优先级呈现完整场景，停用后恢复宠物插件自身的展示。
- 宿主页测量 `[data-composer-seat]` 和 `[data-scene-obstacle]`，以归一化矩形通过 `pawpdot:scene-obstacles` 消息传给场景。场景投影地面坐标检查禁行区，并为角色保留身体边距。
- `pawpdot:scene-ready` 请求宿主重发障碍物。消息同时校验同源和发送窗口。输入区尺寸变化自动更新。
- 去工作使用宿主传入的 `onWork`，家具、旅行状态独立持久化。

## 构建与验证

```sh
npm install --ignore-scripts
npm run build
npm test
```

构建时复用主宠物的 `src/actor.mjs`，发布后的 `public/game.js` 已包含渲染代码。角色使用 GLB 自带的骨骼和蒙皮、AnimationMixer 动作混合，步行动作按实际移动速度调节播放速度。寻路绕开家具与宿主界面。

测试覆盖旧宠物数据迁移、持久身份、并发重试购买、摆放冲突、过期编辑、离线旅行单次结算和跨宠物迟到请求。

## 美术与资源

家具、树木、草丛、花和岩石来自 Kenney 的 Furniture Kit 和 Nature Kit，授权 CC0。模型及预览从 Hidencod/tge-assets 的 GLB 转换分发版获取，来源对应原始 Kenney 资源。保留 `ASSETS.md` 与 `KENNEY-LICENSE.txt`。

渲染使用 ACES 色调映射、PBR 木纹与织物、真实阴影、IBL 环境光、SSAO、轻量 Bloom。参考 AuDoter `demos/machikado-3d` 的冷暖光对比、生活细节和天气氛围。场景使用独立实现。

当前模型为开源风格化资产。3A 级美术是后续验收目标，当前资产密度、角色精细度、动作质量仍需要专项迭代。语音、AI 对话派活与动态装扮未在此游戏插件中实现。
