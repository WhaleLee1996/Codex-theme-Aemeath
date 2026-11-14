# 维护说明

## 文件职责

- `src/core.mjs`：设置迁移、独立主题参数、项目排序。
- `src/native.mjs` 与 `adapters/`：原生节点、导航和当前应用版本的接口适配。
- `src/native-loader.mjs`：从原生已初始化的模块缓存取得服务；不执行原生模块工厂。
- `src/ui.mjs`、`src/ui-template.html`、样式文件：设置与首页布局。
- `src/ui-base.css`、`src/reference.json`：从已确认设计整理出的公共样式与初始参数，构建无需私人预览文件。
- `src/motion.mjs`：输入框装饰的局部呼吸动画；多个输入框共享时钟，各自更新装饰层，禁止改为逐帧写全局继承变量。
- `src/host-backgrounds.cjs`、`src/wallpaper-player.mjs`：按需读图、主题独立目录、有限 Blob URL 生命周期。
- `src/host-storage.cjs`、`src/host-main.cjs`：项目内配置存储及受主窗口校验的 IPC。
- `scripts/setup.py`：发现本机官方应用、选择资料模式、生成副本和快捷方式。
- `scripts/stage_runtime.py`、`scripts/packaging_integrity.py`：只在项目内复制和打包；保留源文件哈希与完整性检查。

## 更新适配

先核对真实安装版本，再新增适配表；不要只改版本号绕过检查。至少回归首页／聊天、侧栏开关、聊天／工作切换、菜单定位、长输入、代码与写作卡片、小爱入口点击、背景轮播、退出主题及设置迁移。还要检查主对话与选中文字后的侧边聊天同时存在、隐藏／恢复／关闭侧栏、Chat 和 Work 的项目选择各自同步，以及 Work 欢迎卡在四列和两列布局中的位置。

默认构建目标来自 `package.json` 的 `codexCompatibility`。维护旧适配时可用 `npm run build -- --app-version <已存在的适配版本>`，打包仍会核对目标版本、适配版本和原生文件哈希。请勿通过手改这些字段跳过适配核验。

背景 schema 3 中 `identityFolder` 只是稳定图片 ID 的盐值，不是文件读取路径。项目内目录通过 `relativeTo: workspace` 跟随移动，外部目录保持绝对路径。

通用测试使用合成 DOM 和桥接夹具，不分发 Codex 原生 JavaScript。安装与打包核验从使用者自己的受支持安装读取原生文件，拒绝不匹配的版本。

## 报告问题

请提供 Windows、主题与 Codex 版本、复现步骤，以及经过检查的局部截图。不要上传原资料目录、登录信息或完整诊断备份。优先在独立资料下复现；不自动上传日志或遥测。
