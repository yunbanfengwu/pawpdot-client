# PawPdot 主宠物

此 DSH 插件提供宠物身份、领养与切换、图片与骨骼动作预览，以及游戏插件使用的 Cordis `pawpdotPet` 服务。

`@pawpdot/pet-home` 是第一个关联同一宠物身份的游戏插件。主宠物状态保存在 Harness profile 中，游戏存档按 `companion.id` 关联，角色模型选择与游戏玩法分开管理。

模型与动作配置沿用 AuDoter 手机端已有资源，保留 `QUATERNIUS-LICENSE.txt`、`VUENA-LICENSE.txt` 和 `THREE-LICENSE.txt`。当前目录提供小狐狸与玩具小猫，图片由真实 GLB 渲染生成，预览可切换待机、行走、奔跑、进食、休息与跳跃。

运行 `npm install --ignore-scripts` 与 `npm run build` 重建播放器。插件页的“已安装插件”分组管理本包，详情中的“打开宠物市场”可进入领养界面。
