# Blog Format Tool

把「普通 Markdown + 本地图片引用」一键转换为可直接放进你的 Astro 内容仓库的文章文件（blog / essays），并自动复制图片到 `public/images/`，同时把 Markdown 内图片引用改写为站点绝对路径 `/images/...`。

## 功能（MVP）
- YAML frontmatter：读取/生成，保留未知字段
- title：从正文首个 `# H1` 自动读取，并从正文删除该行
- pubDate：缺失/不可解析才补全；已有则保持不变
- updatedDate：每次转换都覆盖为当前日期（默认格式 `%Y-%m-%d`）
- description（必填）：优先保留；勾选覆盖则用输入；否则自动生成首段纯文本摘要（默认截断 80 字符）
- tags：仅 blog 支持写入；essays 会自动移除 `tags`
- 图片：复制到 `<repoRoot>/public/images/<safeTitle>/`，并把引用改写为 `/images/<safeTitle>/<file>`

## 使用
1. 在 UI 里选择你的博客仓库根目录（`repoRoot`）
2. 选择要转换的 Markdown 文件（单文件）
3. 选择输出类型：`blog` 或 `essays`
4. （可选）勾选覆盖 description / 写入 tags / 选择 heroImage
5. 点击「开始转换」

输出位置（默认）：
- blog：`<repoRoot>/src/content/blog/`
- essays：`<repoRoot>/src/content/essays/`
- images：`<repoRoot>/public/images/`

## 配置文件
配置存储为 `config.toml`（路径会在 UI 右侧显示）。可配置项（camelCase）：
- `repoRoot`
- `blogContentDir`（默认 `src/content/blog`）
- `essaysContentDir`（默认 `src/content/essays`）
- `imagesDir`（默认 `public/images`）
- `dateFormat`（默认 `%Y-%m-%d`）
- `descriptionAutoLength`（默认 `80`）
- `fileNameStrategy`（默认 `original`；可选 `titleSlug`）

## Dev
### Windows 依赖（必须）
- Rust（提供 `cargo`）：确认 `cargo --version` 有输出（或 `C:\Users\<you>\.cargo\bin\cargo.exe --version`）
- C++ 构建工具：安装 Visual Studio 2022 Build Tools（勾选「Desktop development with C++」+ Windows SDK）

> 如果你遇到 `cargo metadata ... program not found`，通常是 `cargo` 没在 PATH。此项目的 `npm run tauri ...` 会自动尝试把 `%USERPROFILE%\.cargo\bin` 加入 PATH。

```bash
npm install
npm run tauri dev
```

## Build
```bash
npm run tauri build
```
