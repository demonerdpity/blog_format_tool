# Blog Format Tool

一个基于 `Tauri 2 + Vite + TypeScript + Rust` 的本地托盘工具，用来把普通 Markdown 和本地图片整理成可直接放进 Astro 内容仓库的文章文件。

现在它不再只是“网页端页面”，而是一个本地桌面程序：

- 主窗口用于配置、预览和执行转换
- 点击右上角“隐藏到托盘”可以收起到系统托盘
- 关闭窗口不会退出程序，会继续驻留在后台托盘
- 托盘菜单支持重新显示窗口、隐藏窗口和退出程序

## 功能

- 读取并保留 YAML frontmatter 中的已有字段
- 从正文首个 `# H1` 自动提取标题，并从正文中移除该 H1
- `pubDate` 缺失或不可解析时自动补齐
- `updatedDate` 每次转换都会刷新
- `description` 优先保留原值；也支持手动覆盖；缺失时从正文首段自动生成
- `tags` 仅在 `blog` 模式写入；`essays` 模式会自动移除
- 本地图片会复制到 `<repoRoot>/public/images/<safeTitle>/`
- Markdown 中的本地图片引用会被改写为 `/images/<safeTitle>/<file>`
- `heroImage` 支持单独选择并一并复制/改写

## 本地配置

配置文件保存在系统应用配置目录下的 `config.toml`，程序界面里会直接显示实际路径。

当前支持的配置项：

- `repoRoot`
- `blogContentDir`
- `essaysContentDir`
- `imagesDir`
- `dateFormat`
- `descriptionAutoLength`
- `fileNameStrategy`

固定策略：

- `imageSubdirStrategy = "title"`
- `copyMode = "copy"`

兼容性处理：

- 即使旧版 `config.toml` 缺少部分字段，也会自动补默认值，不会因为少字段直接报废

## 开发

```bash
npm install
npm run tauri dev
```

如果本机 `cargo` 没在 PATH 中，`scripts/tauri.mjs` 会优先尝试把默认的 Cargo 安装目录补进 PATH。

## 构建

```bash
npm run tauri build
```
