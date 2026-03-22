# Blog Format Tool

一个基于 `Tauri 2 + Vite + TypeScript + Rust` 的本地桌面工具，用来把普通 Markdown 和本地图片整理成可直接放进 Astro 内容仓库的文章文件。

## 当前体验

- 主窗口负责选择 Markdown、预览解析结果并执行转换
- 右上角齿轮打开本地设置弹窗；首次未配置仓库路径时会显示提示圆点
- 关闭主窗口会隐藏到系统托盘，托盘菜单支持重新显示窗口或退出程序
- 支持把外部 `.md` / `.mdx` 文件直接拖进窗口，松手后自动读取路径

## 功能说明

- 读取并保留 YAML frontmatter 中的已有字段
- 从正文首个 `# H1` 自动提取标题，并从正文中移除该 H1
- `pubDate` 缺失时自动补齐（已填写时不会覆盖）
- `updatedDate` 每次转换都会刷新
- `description` 优先保留原值，也支持手动覆盖，缺失时从正文首段自动生成
- `tags` 仅在 `blog` 模式写入，`essays` 模式会自动移除
- `tags` 支持逐个添加，界面会以 tag chip 的形式展示和删除
- `heroImage` 支持单独选择，并按同样规则复制、改写路径
- 本地图片会复制到 `<repoRoot>/public/images/<safeTitle>/`
- Markdown 内图片和 `heroImage` 会改写为相对文章文件的路径，方便多机协作和本地预览
- 如果目标输出文件已存在，会在报告中给出“本次转换会覆盖”的提示，但不会再把它视为错误并拦截转换

## 适用仓库结构

默认按下面这套 Astro 仓库结构工作：

```text
<repoRoot>/
  public/
    images/
  src/
    content/
      blog/
      essays/
```

默认配置：

- `blogContentDir = "src/content/blog"`
- `essaysContentDir = "src/content/essays"`
- `imagesDir = "public/images"`
- `imageSubdirStrategy = "title"`
- `copyMode = "copy"`

如果你的仓库目录不一样，可以在设置弹窗里修改这些值。

## 本地配置

程序配置保存在系统应用配置目录下的 `config.toml`，界面会显示当前实际路径。

Windows 上默认类似于：

```text
%APPDATA%\com.local.blog-format-tool\config.toml
```

当前支持的配置项：

- `repoRoot`
- `blogContentDir`
- `essaysContentDir`
- `imagesDir`
- `dateFormat`
- `descriptionAutoLength`
- `fileNameStrategy`

兼容性说明：

- 即使旧版 `config.toml` 缺少部分字段，也会自动补齐默认值

## 普通使用流程

1. 第一次打开程序时，先通过右上角齿轮设置博客仓库根目录
2. 选择或拖入一个 `.md` / `.mdx` 文件
3. 选择输出类型 `blog` 或 `essays`
4. 按需覆盖 `description`、添加 `tags`、指定 `heroImage`
5. 先点“解析预览”，确认标题、图片数量和输出路径
6. 再点“开始转换”，查看执行报告

## 运行成品程序需要什么环境

如果只是运行打包好的 `exe`：

- 需要 `Windows 64 位`
- 需要系统可用的 `Microsoft Edge WebView2 Runtime`
- 不需要安装 `Node.js`
- 不需要安装 `Rust`

大多数 Windows 10 / 11 机器通常已经自带或安装了 WebView2。

## 开发环境要求

如果要在本地修改代码、运行开发模式或重新打包，需要：

- `Windows 64 位`
- `Node.js`
  - 推荐 `Node 20` 或 `Node 22`
- `Rust`
- `Visual Studio 2022 Build Tools`
  - 需要勾选 `Desktop development with C++`
  - 同时安装 `Windows SDK`
- `WebView2 Runtime`

## 常用命令

安装依赖：

```bash
npm install
```

前端开发：

```bash
npm run dev
```

桌面程序开发模式：

```bash
npm run tauri dev
```

构建前端：

```bash
npm run build
```

构建桌面程序：

```bash
npm run tauri build
```

## 打包产物

当前配置下：

- 会生成可执行文件
- 不会自动生成安装包

主程序输出位置：

```text
src-tauri/target/release/blog_format_tool.exe
```

图标资源位于：

```text
src-tauri/icons/
```

当前 `tauri.conf.json` 里仍然保持：

```json
"bundle": {
  "active": false
}
```

所以目前更适合本地自用或直接分发 `exe`；如果后续需要安装包，再打开 bundle 配置即可。

## 常见问题

### 1. 为什么它看起来像网页？

因为 Tauri 的界面本质上是本地 `WebView`，但它运行在桌面程序壳里，不是浏览器网页。

### 2. 只运行成品程序也需要 Rust 吗？

不需要。

只运行已经打包好的 `exe` 不需要 Rust。

### 3. 为什么图片路径不用 `/images/...`？

因为这个工具现在会把图片改写成相对文章文件的路径，这样在多台电脑之间迁移仓库、在编辑器里直接预览 Markdown 时会更稳定。

### 4. 如果目标文章已经存在会怎样？

现在的策略是：

- 解析 / 转换报告里会提示“本次转换会覆盖”
- 转换仍然允许继续执行
- 不再把这种情况直接当成错误拦截

### 5. 为什么关闭窗口后程序没有完全退出？

因为当前设计是关闭主窗口时隐藏到系统托盘，方便反复使用；如果需要完全退出，请在托盘菜单里选择退出。

## 后续可选增强

如果以后需要，还可以继续扩展：

- 生成 Windows 安装包
- 首次启动自动检测 WebView2
- 图片路径支持“相对路径 / 站点路径”切换
- 批量导入多个 Markdown 文件
