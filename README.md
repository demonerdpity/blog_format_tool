# Blog Format Tool

一个基于 `Tauri 2 + Vite + TypeScript + Rust` 的本地托盘工具，用来把普通 Markdown 和本地图片整理成可直接放进 Astro 内容仓库的文章文件。

它不是浏览器网页，而是桌面程序：

- 主窗口用于配置、预览和执行转换
- 点击右上角“隐藏到托盘”可以收起到系统托盘
- 关闭窗口不会退出程序，会继续驻留在后台托盘
- 托盘支持重新显示窗口、隐藏窗口和退出程序

## 功能说明

- 读取并保留 YAML frontmatter 中的已有字段
- 从正文首个 `# H1` 自动提取标题，并从正文中移除该 H1
- `pubDate` 缺失或不可解析时自动补齐
- `updatedDate` 每次转换都会刷新
- `description` 优先保留原值，也支持手动覆盖，缺失时从正文首段自动生成
- `tags` 仅在 `blog` 模式写入，`essays` 模式会自动移除
- 本地图片会复制到 `<repoRoot>/public/images/<safeTitle>/`
- Markdown 中的图片路径会改写成相对文章文件的路径
- `heroImage` 支持单独选择并一并复制、改写
- 如果目标文章已存在，会在预览阶段给告警，在转换阶段直接拦截

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

如果你的仓库目录不一样，可以在程序里改配置。

## 图片路径策略

为了兼容多台主机开发、编辑器本地预览和仓库整体迁移，图片不会再写成 `/images/...` 这种站点根路径，而是写成相对当前文章文件的路径。

例如：

```md
![image](../../../public/images/交易管理系统测试文档/image-20260226164855105.png)
```

这样只要仓库整体目录结构不变，在不同电脑上也能正常使用。

## 普通用户如何使用

如果你只是想使用这个工具，不改代码：

1. 直接运行打包好的程序
2. 在界面中选择你的博客仓库根目录
3. 选择要转换的 Markdown 文件
4. 选择输出类型 `blog` 或 `essays`
5. 点击“开始转换”

打包后的主程序默认在：

`src-tauri/target/release/blog_format_tool.exe`

## 运行成品程序需要什么环境

如果只是运行打包好的 `exe`：

- 需要 `Windows 64 位`
- 需要系统可用的 `Microsoft Edge WebView2 Runtime`
- 不需要安装 `Node.js`
- 不需要安装 `Rust`

大多数 Windows 10 / 11 机器通常已经自带或安装了 WebView2。

## 开发者环境要求

如果你想在自己的电脑上修改代码、运行开发模式、重新打包，需要下面这些环境：

- `Windows 64 位`
- `Node.js`
  - 推荐 `Node 20` 或 `Node 22`
  - 当前项目可以使用 `Node 22`
- `Rust`
- `Visual Studio 2022 Build Tools`
  - 需要勾选 `Desktop development with C++`
  - 同时安装 `Windows SDK`
- `WebView2 Runtime`

## 开发路径建议

建议把这个项目放在一个简短、稳定、尽量英文的本地路径下，例如：

```text
C:\work\tools\blog_format_tool
```

这不是强制要求，但这样通常最稳，能减少 Windows 工具链、构建脚本和环境变量相关问题。

博客仓库可以放在别的位置，例如：

```text
C:\Users\<你的用户名>\work\blog
```

## 本地配置文件

程序配置保存在系统应用配置目录下的 `config.toml`，界面里会显示实际路径。

当前支持的配置项：

- `repoRoot`
- `blogContentDir`
- `essaysContentDir`
- `imagesDir`
- `dateFormat`
- `descriptionAutoLength`
- `fileNameStrategy`

兼容性说明：

- 即使旧版 `config.toml` 缺少部分字段，也会自动补默认值

## 常用命令

安装依赖：

```bash
npm install
```

前端单独开发：

```bash
npm run dev
```

桌面程序开发模式：

```bash
npm run tauri dev
```

说明：

- 现在的开发启动脚本已经做过处理
- 执行 `npm run tauri dev` 时，不需要你再手动打开 `http://localhost:1420`
- 脚本会先自动拉起本地前端，再启动 Tauri 桌面程序

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

原因是当前 `tauri.conf.json` 里：

```json
"bundle": {
  "active": false
}
```

如果后续需要对外分发，可以再打开 bundle 配置，生成安装包。

## 常见问题

### 1. 为什么它看起来像网页？

因为 Tauri 的界面本质上是本地 `WebView`，但它运行在桌面程序壳里，不是浏览器网页。

### 2. 我家里电脑只有 Node 22，没有 Rust，可以开发吗？

不行。

- `Node 22` 可以
- 但没有 `Rust` 就不能运行 `npm run tauri dev`
- 也不能重新打包 `npm run tauri build`

### 3. 只运行成品程序也需要 Rust 吗？

不需要。

只运行已经打包好的 `exe` 不需要 Rust。

### 4. 为什么图片路径不用 `/images/...`？

因为你可能在多台主机写作，也可能直接在编辑器里本地打开 Markdown。相对路径对这种场景更稳定。

### 5. 为什么同名文章不能重复转换？

为了避免把已有文章误覆盖。当前策略是：

- 预览阶段提示告警
- 转换阶段直接阻止写入

## 后续可选增强

如果以后需要，可以继续扩展：

- 生成 Windows 安装包
- 开机自启动并静默驻留托盘
- 图片路径支持“相对路径 / 站点路径”切换
- 首次启动自动检测 WebView2
