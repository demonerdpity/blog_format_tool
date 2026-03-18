import "./style.css";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";

type OutputType = "blog" | "essays";
type StatusKind = "idle" | "ok" | "warn" | "error";
type ActionPhase = "idle" | "loading" | "success" | "error";

type AppConfig = {
  repoRoot: string;
  blogContentDir: string;
  essaysContentDir: string;
  imagesDir: string;
  imageSubdirStrategy: "title";
  copyMode: "copy";
  dateFormat: string;
  descriptionAutoLength: number;
  fileNameStrategy: "original" | "titleSlug";
};

type ConfigEnvelope = {
  configPath: string;
  config: AppConfig;
};

type AnalyzeResult = {
  title: string | null;
  safeTitle: string | null;
  imageCounts: {
    total: number;
    local: number;
    remote: number;
    site: number;
  };
  outputMarkdownPath: string | null;
  warnings: string[];
};

type ConvertReport = {
  outputMarkdownPath: string;
  images: Array<{
    sourcePath: string;
    finalPath: string;
    finalSitePath: string;
    action: "copied" | "skippedSame" | "renamedCopied";
  }>;
  warnings: string[];
};

const DEFAULT_CONFIG: AppConfig = {
  repoRoot: "",
  blogContentDir: "src/content/blog",
  essaysContentDir: "src/content/essays",
  imagesDir: "public/images",
  imageSubdirStrategy: "title",
  copyMode: "copy",
  dateFormat: "%Y-%m-%d",
  descriptionAutoLength: 80,
  fileNameStrategy: "original",
};

const state = {
  lastAnalyze: null as AnalyzeResult | null,
  convertResetTimer: null as number | null,
  tags: [] as string[],
  needsSetup: false,
};

function getEl<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing element: ${selector}`);
  }
  return element;
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function render(app: HTMLElement) {
  app.innerHTML = `
    <div class="shell">
      <div class="shell-content" id="shellContent">
        <header class="topbar">
          <div class="brand">
            <div class="brand-mark" aria-hidden="true">
              <span class="brand-shadow"></span>
              <span class="brand-core"></span>
              <span class="brand-ribbon ribbon-one"></span>
              <span class="brand-ribbon ribbon-two"></span>
              <span class="brand-ribbon ribbon-three"></span>
            </div>
            <div class="brand-copy">
              <div class="brand-row">
                <h1>Blog Format Tool</h1>
                <div class="eyebrow">Markdown Workflow</div>
              </div>
              <p class="brand-subtitle">把普通 Markdown 和本地图片快速整理成 Astro 可直接使用的内容文件。</p>
            </div>
          </div>
          <button id="openSettings" class="ghost-button square-button" type="button" aria-label="打开设置" title="设置">
            <span class="settings-dot hidden" id="settingsDot" aria-hidden="true"></span>
            <span class="gear-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                <path d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.2 7.2 0 0 0-1.62-.94l-.36-2.54a.5.5 0 0 0-.49-.42h-3.84a.5.5 0 0 0-.49.42l-.36 2.54a7.2 7.2 0 0 0-1.62.94l-2.39-.96a.5.5 0 0 0-.6.22L2.7 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.82 14.52a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.39.31.6.22l2.39-.96c.5.39 1.04.7 1.62.94l.36 2.54c.04.24.25.42.49.42h3.84c.24 0 .45-.18.49-.42l.36-2.54c.58-.24 1.12-.55 1.62-.94l2.39.96c.22.09.47 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z"></path>
              </svg>
            </span>
          </button>
        </header>

        <section class="setup-banner hidden" id="setupBanner">
          <div class="setup-copy">
            <div class="setup-title">首次使用请先设置博客仓库根目录</div>
            <p>这个路径只需要在当前设备配置一次，保存后后续会自动沿用。</p>
          </div>
          <button id="setupCta" class="setup-button" type="button">去设置</button>
        </section>

        <section class="hero panel">
          <div class="hero-main">
            <h2>Markdown 与图片一键整理</h2>
            <p class="hero-copy">
              把普通 Markdown 整理成可直接放进 Astro 的 blog / essays 内容文件，省去 frontmatter、图片搬运和路径改写的重复操作。
            </p>
          </div>
          <div class="hero-note">
            <div class="hero-note-title">默认处理规则</div>
            <p>
              自动读取首个 H1 作为标题并从正文移除；缺失的 <code>pubDate</code> 会补全，<code>updatedDate</code>
              每次都会更新；本地图片会复制到 <code>public/images/&lt;title&gt;/</code>，并改写为
              <code>/images/...</code>。
            </p>
          </div>
        </section>

        <div class="workspace-grid">
          <section class="panel content-panel">
            <div class="panel-head">
              <div>
                <h2>转换内容</h2>
                <p>选择 Markdown 文件，决定输出到 blog 或 essays，并按需补充 description、tags 和 heroImage。</p>
              </div>
            </div>

            <div class="form-grid">
              <label for="mdPath">Markdown 文件</label>
              <div class="field-with-button">
                <input id="mdPath" type="text" placeholder="选择单个 .md / .mdx 文件" />
                <button id="pickMd" type="button">选择</button>
              </div>

              <label for="outputType">输出类型</label>
              <select id="outputType">
                <option value="blog">博文（blog）</option>
                <option value="essays">随笔（essays）</option>
              </select>

              <label for="descInput">覆盖 description</label>
              <div class="stack-field">
                <label class="checkbox-line">
                  <input id="descOverride" type="checkbox" />
                  <span>勾选后使用手动输入；不勾选时优先保留原 description，缺失时自动生成。</span>
                </label>
                <textarea id="descInput" placeholder="留空时会尝试从正文首段自动生成摘要" disabled></textarea>
              </div>

              <label id="tagsLabel" for="tagInput">写入 tags</label>
              <div class="stack-field" id="tagsRow">
                <label class="checkbox-line">
                  <input id="tagsOverride" type="checkbox" />
                  <span>仅 blog 模式可用。输入单个 tag 后点击加号或回车，下方会保留当前所有标签。</span>
                </label>
                <div class="tag-editor" id="tagEditor">
                  <div class="tag-input-row">
                    <input id="tagInput" type="text" placeholder="输入 tag 后点击加号" disabled />
                    <button id="addTag" class="icon-action" type="button" disabled aria-label="添加 tag">+</button>
                  </div>
                  <div class="tag-list" id="tagList"></div>
                </div>
              </div>

              <label for="heroPath">heroImage</label>
              <div class="stack-field">
                <label class="checkbox-line">
                  <input id="heroOverride" type="checkbox" />
                  <span>勾选后选择 heroImage，并按同样规则复制和改写路径。</span>
                </label>
                <div class="field-with-button">
                  <input id="heroPath" type="text" placeholder="可留空" disabled />
                  <button id="pickHero" type="button" disabled>选择</button>
                </div>
              </div>
            </div>

            <div class="toolbar">
              <button id="analyzeBtn" type="button">解析预览</button>
              <button class="primary action-button" id="convertBtn" type="button" data-phase="idle">开始转换</button>
              <button id="copyReport" type="button">复制报告</button>
            </div>
          </section>

          <section class="panel side-panel">
            <div class="panel-head compact">
              <div>
                <h2>状态与输出</h2>
                <p>这里会展示解析结果、目标路径和转换过程中的警告信息。</p>
              </div>
            </div>

            <div class="status-row">
              <span class="pill" id="statusPill">等待操作</span>
              <span class="pill" id="imgPill">图片：0</span>
            </div>

            <div class="preview-card">
              <div class="preview-label">标题</div>
              <div class="preview-value" id="titlePreview">尚未解析</div>
            </div>

            <div class="preview-card">
              <div class="preview-label">输出文件</div>
              <div class="preview-value" id="outputPreview">尚未生成</div>
            </div>

            <div class="preview-card info-card">
              <div class="preview-label">当前会自动处理</div>
              <ul class="rule-list">
                <li>首个 H1 自动写入 title，并从正文中移除</li>
                <li>缺失 pubDate 自动补全，updatedDate 每次覆盖</li>
                <li>本地图片复制到图片目录，引用统一改成 <code>/images/...</code></li>
              </ul>
            </div>
          </section>
        </div>

        <section class="panel report-panel">
          <div class="panel-head compact">
            <div>
              <h2>执行报告</h2>
              <p>显示解析警告、图片复制结果和最终输出路径，便于你直接检查这次转换。</p>
            </div>
          </div>
          <pre id="report">等待操作...</pre>
        </section>

        <div class="modal-backdrop hidden" id="settingsModal" aria-hidden="true">
          <section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="settingsTitle">
            <div class="modal-head">
              <div>
                <div class="eyebrow">Local Config</div>
                <h2 id="settingsTitle">设置</h2>
                <p>这里保存本地仓库路径和转换策略。保存后会写入系统配置目录，下次打开依然沿用。</p>
              </div>
              <button id="closeSettings" class="close-button" type="button" aria-label="关闭设置">
                <span aria-hidden="true">×</span>
              </button>
            </div>

            <div class="config-grid">
              <label for="repoRoot">博客仓库根目录</label>
              <div class="field-with-button">
                <input id="repoRoot" type="text" placeholder="例如：C:\\Users\\admin\\work\\blog" />
                <button id="pickRepoRoot" type="button">选择</button>
              </div>

              <label for="blogContentDir">blog 输出目录</label>
              <input id="blogContentDir" type="text" placeholder="src/content/blog" />

              <label for="essaysContentDir">essays 输出目录</label>
              <input id="essaysContentDir" type="text" placeholder="src/content/essays" />

              <label for="imagesDir">图片目录</label>
              <input id="imagesDir" type="text" placeholder="public/images" />

              <label for="dateFormat">日期格式</label>
              <input id="dateFormat" type="text" placeholder="%Y-%m-%d" />

              <label for="descriptionAutoLength">自动摘要长度</label>
              <input id="descriptionAutoLength" type="number" min="1" step="1" placeholder="80" />

              <label for="fileNameStrategy">文件名策略</label>
              <select id="fileNameStrategy">
                <option value="original">保留原文件名</option>
                <option value="titleSlug">按标题 slug 生成</option>
              </select>
            </div>

            <div class="modal-foot">
              <div class="config-path" id="configPath">config: 未加载</div>
              <div class="toolbar compact">
                <button id="resetConfig" type="button">恢复推荐配置</button>
                <button id="saveConfig" type="button" class="primary">保存设置</button>
              </div>
            </div>
          </section>
        </div>
      </div>

      <div class="drop-overlay hidden" id="dropOverlay" aria-hidden="true">
        <div class="drop-zone">
          <div class="drop-plus" aria-hidden="true">+</div>
          <div class="drop-title">拖入 Markdown 文件</div>
          <p>支持 <code>.md</code> / <code>.mdx</code>，松手后会自动读取路径并沿用现在的导入流程。</p>
        </div>
      </div>
    </div>
  `;
}

function getOutputType(): OutputType {
  return getEl<HTMLSelectElement>("#outputType").value as OutputType;
}

function getRepoRootValue() {
  return getEl<HTMLInputElement>("#repoRoot").value.trim();
}

function applyConfigToForm(config: AppConfig) {
  getEl<HTMLInputElement>("#repoRoot").value = config.repoRoot;
  getEl<HTMLInputElement>("#blogContentDir").value = config.blogContentDir;
  getEl<HTMLInputElement>("#essaysContentDir").value = config.essaysContentDir;
  getEl<HTMLInputElement>("#imagesDir").value = config.imagesDir;
  getEl<HTMLInputElement>("#dateFormat").value = config.dateFormat;
  getEl<HTMLInputElement>("#descriptionAutoLength").value = String(config.descriptionAutoLength);
  getEl<HTMLSelectElement>("#fileNameStrategy").value = config.fileNameStrategy;
}

function collectConfigFromForm(): AppConfig {
  const descriptionAutoLengthRaw = getEl<HTMLInputElement>("#descriptionAutoLength").value.trim();
  const descriptionAutoLength = Number.parseInt(descriptionAutoLengthRaw || "0", 10);

  if (!Number.isFinite(descriptionAutoLength) || descriptionAutoLength <= 0) {
    throw new Error("自动摘要长度必须是大于 0 的整数。");
  }

  const fileNameStrategyValue = getEl<HTMLSelectElement>("#fileNameStrategy").value;
  const fileNameStrategy: AppConfig["fileNameStrategy"] =
    fileNameStrategyValue === "titleSlug" ? "titleSlug" : "original";

  return {
    repoRoot: getRepoRootValue(),
    blogContentDir: getEl<HTMLInputElement>("#blogContentDir").value.trim() || DEFAULT_CONFIG.blogContentDir,
    essaysContentDir: getEl<HTMLInputElement>("#essaysContentDir").value.trim() || DEFAULT_CONFIG.essaysContentDir,
    imagesDir: getEl<HTMLInputElement>("#imagesDir").value.trim() || DEFAULT_CONFIG.imagesDir,
    imageSubdirStrategy: "title",
    copyMode: "copy",
    dateFormat: getEl<HTMLInputElement>("#dateFormat").value.trim() || DEFAULT_CONFIG.dateFormat,
    descriptionAutoLength,
    fileNameStrategy,
  };
}

function setStatus(kind: StatusKind, text: string) {
  const pill = getEl<HTMLSpanElement>("#statusPill");
  pill.className = `pill${kind === "idle" ? "" : ` ${kind}`}`;
  pill.textContent = text;
}

function setImagePill(counts?: AnalyzeResult["imageCounts"]) {
  const pill = getEl<HTMLSpanElement>("#imgPill");
  if (!counts) {
    pill.textContent = "图片：0";
    return;
  }

  pill.textContent = `图片：${counts.total}（本地 ${counts.local} / 远程 ${counts.remote} / 站点 ${counts.site}）`;
}

function reportText(text: string) {
  getEl<HTMLPreElement>("#report").textContent = text.trim() ? text : "等待操作...";
}

function splitReportMessages(messages: string[]) {
  const notices: string[] = [];
  const warnings: string[] = [];

  for (const message of messages) {
    if (message.startsWith("目标文章已存在，本次转换会覆盖：")) {
      notices.push(message);
      continue;
    }

    warnings.push(message);
  }

  return { notices, warnings };
}

function appendMessageSection(lines: string[], title: string, messages: string[]) {
  if (!messages.length) {
    return;
  }

  if (lines.length) {
    lines.push("");
  }

  lines.push(title);
  for (const message of messages) {
    lines.push(`- ${message}`);
  }
}

function updateTagsVisibility() {
  const isBlog = getOutputType() === "blog";
  getEl<HTMLDivElement>("#tagsRow").style.display = isBlog ? "grid" : "none";
  getEl<HTMLLabelElement>("#tagsLabel").style.display = isBlog ? "block" : "none";
}

function syncOverrideState() {
  getEl<HTMLTextAreaElement>("#descInput").disabled = !getEl<HTMLInputElement>("#descOverride").checked;

  const tagsEnabled = getEl<HTMLInputElement>("#tagsOverride").checked;
  getEl<HTMLInputElement>("#tagInput").disabled = !tagsEnabled;
  getEl<HTMLButtonElement>("#addTag").disabled = !tagsEnabled;
  getEl<HTMLDivElement>("#tagEditor").classList.toggle("disabled", !tagsEnabled);

  const heroEnabled = getEl<HTMLInputElement>("#heroOverride").checked;
  getEl<HTMLInputElement>("#heroPath").disabled = !heroEnabled;
  getEl<HTMLButtonElement>("#pickHero").disabled = !heroEnabled;
}

function setPreview(result: AnalyzeResult | null) {
  if (!result) {
    getEl<HTMLDivElement>("#titlePreview").textContent = "尚未解析";
    getEl<HTMLDivElement>("#outputPreview").textContent = "尚未生成";
    return;
  }

  getEl<HTMLDivElement>("#titlePreview").innerHTML = result.title
    ? escapeHtml(result.title)
    : '<span class="muted">缺少标题</span>';

  getEl<HTMLDivElement>("#outputPreview").innerHTML = result.outputMarkdownPath
    ? `<code>${escapeHtml(result.outputMarkdownPath)}</code>`
    : '<span class="muted">尚未生成输出路径</span>';
}

function setConvertButtonPhase(phase: ActionPhase) {
  const button = getEl<HTMLButtonElement>("#convertBtn");

  if (state.convertResetTimer !== null) {
    window.clearTimeout(state.convertResetTimer);
    state.convertResetTimer = null;
  }

  button.dataset.phase = phase;

  if (phase === "loading") {
    button.disabled = true;
    button.innerHTML = '<span class="button-spinner" aria-hidden="true"></span><span>转换中...</span>';
    return;
  }

  button.disabled = false;
  button.textContent = phase === "success" ? "转换完成" : phase === "error" ? "转换失败" : "开始转换";

  if (phase !== "idle") {
    state.convertResetTimer = window.setTimeout(() => {
      const convertButton = getEl<HTMLButtonElement>("#convertBtn");
      convertButton.dataset.phase = "idle";
      convertButton.textContent = "开始转换";
      state.convertResetTimer = null;
    }, 1600);
  }
}

function setSettingsOpen(openState: boolean) {
  const modal = getEl<HTMLDivElement>("#settingsModal");
  modal.classList.toggle("hidden", !openState);
  modal.setAttribute("aria-hidden", String(!openState));
  document.body.classList.toggle("modal-open", openState);

  if (openState) {
    getEl<HTMLInputElement>("#repoRoot").focus();
  }
}

function setDropOverlay(openState: boolean) {
  getEl<HTMLDivElement>("#dropOverlay").classList.toggle("hidden", !openState);
  getEl<HTMLDivElement>("#dropOverlay").setAttribute("aria-hidden", String(!openState));
  getEl<HTMLDivElement>("#shellContent").classList.toggle("blurred", openState);
}

function applySetupState(repoRoot: string) {
  const needsSetup = !repoRoot.trim();
  state.needsSetup = needsSetup;
  getEl<HTMLSpanElement>("#settingsDot").classList.toggle("hidden", !needsSetup);
  getEl<HTMLElement>("#setupBanner").classList.toggle("hidden", !needsSetup);
}

function ensureRepoRootConfigured(actionLabel: string) {
  const repoRoot = getRepoRootValue();
  applySetupState(repoRoot);

  if (repoRoot) {
    return true;
  }

  setStatus("warn", "请先设置博客仓库根目录");
  reportText(`[Setup Required]\n- ${actionLabel}前请先在设置中填写博客仓库根目录。`);
  setSettingsOpen(true);
  return false;
}

function isMarkdownPath(path: string) {
  return /\.(md|mdx)$/i.test(path);
}

async function handleDroppedPaths(paths: string[]) {
  setDropOverlay(false);

  const markdownPath = paths.find(isMarkdownPath);
  if (!markdownPath) {
    setStatus("warn", "拖入的文件不是 Markdown");
    reportText("[Warning]\n- 仅支持拖入 .md 或 .mdx 文件。");
    return;
  }

  getEl<HTMLInputElement>("#mdPath").value = markdownPath;
  setStatus("ok", "已读取拖入的 Markdown 文件");
  await analyze();
}

function normalizeTagParts(raw: string) {
  return raw
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function addTags(raw: string) {
  const nextTags = normalizeTagParts(raw);
  if (!nextTags.length) return;

  for (const tag of nextTags) {
    if (!state.tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) {
      state.tags.push(tag);
    }
  }

  getEl<HTMLInputElement>("#tagInput").value = "";
  renderTags();
}

function removeTag(index: number) {
  state.tags.splice(index, 1);
  renderTags();
}

function renderTags() {
  const list = getEl<HTMLDivElement>("#tagList");
  if (!state.tags.length) {
    list.innerHTML = '<span class="tag-placeholder">还没有添加 tag</span>';
    return;
  }

  list.innerHTML = state.tags
    .map(
      (tag, index) => `
        <span class="tag-chip">
          <span>${escapeHtml(tag)}</span>
          <button type="button" class="tag-remove" data-tag-index="${index}" aria-label="删除 tag">×</button>
        </span>
      `,
    )
    .join("");
}

async function loadConfig() {
  const envelope = (await invoke("load_config")) as ConfigEnvelope;
  applyConfigToForm(envelope.config);
  applySetupState(envelope.config.repoRoot);
  getEl<HTMLDivElement>("#configPath").textContent = envelope.configPath
    ? `config: ${envelope.configPath}`
    : "config: 未找到配置文件";

  if (envelope.config.repoRoot.trim()) {
    setStatus("idle", "本地配置已加载");
  } else {
    setStatus("warn", "首次使用请先设置博客仓库根目录");
  }
}

async function saveConfig() {
  const config = collectConfigFromForm();

  if (!config.repoRoot.trim()) {
    applySetupState("");
    setStatus("warn", "请先填写博客仓库根目录");
    getEl<HTMLInputElement>("#repoRoot").focus();
    return;
  }

  const envelope = (await invoke("save_config", { config })) as ConfigEnvelope;
  applyConfigToForm(envelope.config);
  applySetupState(envelope.config.repoRoot);
  getEl<HTMLDivElement>("#configPath").textContent = envelope.configPath
    ? `config: ${envelope.configPath}`
    : "config: 未找到配置文件";
  setStatus("ok", "设置已保存");
  setSettingsOpen(false);

  if (getEl<HTMLInputElement>("#mdPath").value.trim()) {
    await analyze();
  }
}

async function analyze() {
  reportText("");
  const mdPath = getEl<HTMLInputElement>("#mdPath").value.trim();

  if (!mdPath) {
    state.lastAnalyze = null;
    setStatus("idle", "请选择 Markdown 文件");
    setImagePill();
    setPreview(null);
    return;
  }

  if (!ensureRepoRootConfigured("解析")) {
    state.lastAnalyze = null;
    setImagePill();
    setPreview(null);
    return;
  }

  try {
    const config = collectConfigFromForm();
    const result = (await invoke("analyze_markdown", {
      request: { mdPath, outputType: getOutputType(), config },
    })) as AnalyzeResult;

    state.lastAnalyze = result;
    const { notices, warnings } = splitReportMessages(result.warnings);
    setStatus(
      warnings.length ? "warn" : "ok",
      warnings.length ? "解析完成，存在警告" : notices.length ? "解析完成，包含提示" : "解析完成",
    );
    setImagePill(result.imageCounts);
    setPreview(result);

    const lines: string[] = [];
    appendMessageSection(lines, "[Notes]", notices);
    appendMessageSection(lines, "[Warnings]", warnings);
    reportText(lines.join("\n"));
  } catch (error) {
    state.lastAnalyze = null;
    setStatus("error", "解析失败");
    setImagePill();
    setPreview(null);
    reportText(String(error));
  }
}

async function convert() {
  reportText("");
  const mdPath = getEl<HTMLInputElement>("#mdPath").value.trim();

  if (!mdPath) {
    setStatus("error", "请先选择 Markdown 文件");
    setConvertButtonPhase("error");
    return;
  }

  if (!ensureRepoRootConfigured("转换")) {
    setConvertButtonPhase("error");
    return;
  }

  try {
    setConvertButtonPhase("loading");
    setStatus("idle", "已触发转换，正在处理...");

    const config = collectConfigFromForm();
    const result = (await invoke("convert_markdown", {
      request: {
        mdPath,
        outputType: getOutputType(),
        config,
        meta: {
          descriptionOverride: getEl<HTMLInputElement>("#descOverride").checked,
          description: getEl<HTMLTextAreaElement>("#descInput").value,
          tagsOverride: getEl<HTMLInputElement>("#tagsOverride").checked,
          tags: getOutputType() === "blog" ? state.tags : [],
          heroImageOverride: getEl<HTMLInputElement>("#heroOverride").checked,
          heroImagePath: getEl<HTMLInputElement>("#heroPath").value.trim() || null,
        },
      },
    })) as ConvertReport;

    const { notices, warnings } = splitReportMessages(result.warnings);
    const lines = [`[OK] 输出文件：${result.outputMarkdownPath}`];
    if (result.images.length) {
      lines.push("", `[Images] ${result.images.length}`);
      for (const image of result.images) {
        lines.push(`- ${image.action}: ${image.sourcePath} -> ${image.finalSitePath}`);
      }
    }
    appendMessageSection(lines, "[Notes]", notices);
    appendMessageSection(lines, "[Warnings]", warnings);

    setConvertButtonPhase("success");
    setStatus(
      warnings.length ? "warn" : "ok",
      warnings.length ? "转换完成，存在警告" : notices.length ? "转换完成，包含提示" : "转换完成",
    );
    reportText(lines.join("\n"));
    await analyze();
  } catch (error) {
    setConvertButtonPhase("error");
    setStatus("error", "转换失败");
    reportText(String(error));
  }
}

function resetConfigDraft() {
  applyConfigToForm(DEFAULT_CONFIG);
  applySetupState(DEFAULT_CONFIG.repoRoot);
  setStatus("idle", "已恢复推荐配置");
}

async function copyReport() {
  const text = getEl<HTMLPreElement>("#report").textContent || "";
  if (!text.trim()) {
    setStatus("warn", "当前没有可复制的报告");
    return;
  }

  await navigator.clipboard.writeText(text);
  setStatus("ok", "报告已复制");
}

async function pickDirectory(inputSelector: string, title: string) {
  const selected = await open({ directory: true, multiple: false, title });
  if (typeof selected === "string") {
    getEl<HTMLInputElement>(inputSelector).value = selected;
  }
}

async function pickMarkdown() {
  const selected = await open({
    multiple: false,
    directory: false,
    title: "选择 Markdown 文件",
    filters: [{ name: "Markdown", extensions: ["md", "mdx"] }],
  });

  if (typeof selected === "string") {
    getEl<HTMLInputElement>("#mdPath").value = selected;
    await analyze();
  }
}

async function pickHeroImage() {
  const selected = await open({
    multiple: false,
    directory: false,
    title: "选择 heroImage",
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"] }],
  });

  if (typeof selected === "string") {
    getEl<HTMLInputElement>("#heroPath").value = selected;
  }
}

const app = getEl<HTMLDivElement>("#app");
render(app);
renderTags();
updateTagsVisibility();
syncOverrideState();
setConvertButtonPhase("idle");

getEl<HTMLButtonElement>("#openSettings").addEventListener("click", () => setSettingsOpen(true));
getEl<HTMLButtonElement>("#setupCta").addEventListener("click", () => setSettingsOpen(true));
getEl<HTMLButtonElement>("#closeSettings").addEventListener("click", () => setSettingsOpen(false));
getEl<HTMLDivElement>("#settingsModal").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) {
    setSettingsOpen(false);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setSettingsOpen(false);
  }
});

getEl<HTMLButtonElement>("#pickRepoRoot").addEventListener("click", async () => {
  await pickDirectory("#repoRoot", "选择博客仓库根目录");
  applySetupState(getRepoRootValue());
});

getEl<HTMLButtonElement>("#pickMd").addEventListener("click", () => void pickMarkdown());
getEl<HTMLButtonElement>("#pickHero").addEventListener("click", () => void pickHeroImage());
getEl<HTMLButtonElement>("#saveConfig").addEventListener("click", () =>
  void saveConfig().catch((error) => {
    setStatus("error", "保存设置失败");
    reportText(String(error));
  }),
);
getEl<HTMLButtonElement>("#resetConfig").addEventListener("click", resetConfigDraft);
getEl<HTMLButtonElement>("#analyzeBtn").addEventListener("click", () => void analyze());
getEl<HTMLButtonElement>("#convertBtn").addEventListener("click", () => void convert());
getEl<HTMLButtonElement>("#copyReport").addEventListener("click", () =>
  void copyReport().catch((error) => {
    setStatus("error", "复制报告失败");
    reportText(String(error));
  }),
);

getEl<HTMLInputElement>("#repoRoot").addEventListener("input", () => {
  applySetupState(getRepoRootValue());
});
getEl<HTMLInputElement>("#repoRoot").addEventListener("change", () => {
  applySetupState(getRepoRootValue());
  setStatus("idle", "仓库路径已更新，保存后会写入本地配置");
});
getEl<HTMLInputElement>("#mdPath").addEventListener("change", () => void analyze());
getEl<HTMLSelectElement>("#outputType").addEventListener("change", () => {
  updateTagsVisibility();
  void analyze();
});

getEl<HTMLInputElement>("#descOverride").addEventListener("change", syncOverrideState);
getEl<HTMLInputElement>("#tagsOverride").addEventListener("change", syncOverrideState);
getEl<HTMLInputElement>("#heroOverride").addEventListener("change", syncOverrideState);

getEl<HTMLButtonElement>("#addTag").addEventListener("click", () => {
  addTags(getEl<HTMLInputElement>("#tagInput").value);
});

getEl<HTMLInputElement>("#tagInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === ",") {
    event.preventDefault();
    addTags(getEl<HTMLInputElement>("#tagInput").value);
  }
});

getEl<HTMLDivElement>("#tagList").addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const button = target.closest<HTMLButtonElement>(".tag-remove");
  if (!button) return;

  const index = Number.parseInt(button.dataset.tagIndex || "", 10);
  if (Number.isFinite(index)) {
    removeTag(index);
  }
});

void getCurrentWindow()
  .onDragDropEvent((event) => {
    if (event.payload.type === "enter" || event.payload.type === "over") {
      setDropOverlay(true);
      return;
    }

    if (event.payload.type === "leave") {
      setDropOverlay(false);
      return;
    }

    if (event.payload.type === "drop") {
      void handleDroppedPaths(event.payload.paths);
    }
  })
  .catch((error) => {
    console.warn("drag-drop unavailable", error);
  });

loadConfig().catch((error) => {
  applyConfigToForm(DEFAULT_CONFIG);
  applySetupState(DEFAULT_CONFIG.repoRoot);
  setStatus("error", "加载配置失败");
  reportText(String(error));
});
