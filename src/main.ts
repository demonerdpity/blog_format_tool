import "./style.css";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
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

const trayWindow = getCurrentWebviewWindow();

const state = {
  lastAnalyze: null as AnalyzeResult | null,
  convertResetTimer: null as number | null,
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
      <header class="hero">
        <div>
          <div class="eyebrow">Tauri Local Tray App</div>
          <h1>Blog Format Tool</h1>
          <p class="hero-copy">
            把 Markdown 和本地图片整理成可直接放进 Astro 仓库的文章文件。关闭窗口后程序不会退出，会继续驻留在系统托盘里。
          </p>
        </div>
        <div class="hero-actions">
          <span class="pill subtle">图片会改写为相对文章的路径</span>
          <button id="hideToTray">隐藏到托盘</button>
        </div>
      </header>

      <div class="workspace-grid">
        <section class="panel">
          <div class="panel-head">
            <div>
              <h2>工作区</h2>
              <p>选择仓库和 Markdown 文件，生成 blog 或 essays 文章。</p>
            </div>
          </div>

          <div class="form-grid">
            <label for="repoRoot">博客仓库根目录</label>
            <div class="field-with-button">
              <input id="repoRoot" type="text" placeholder="例如：C:\\Users\\admin\\work\\blog" />
              <button id="pickRepoRoot">选择</button>
            </div>

            <label for="mdPath">Markdown 文件</label>
            <div class="field-with-button">
              <input id="mdPath" type="text" placeholder="选择单个 .md 或 .mdx 文件" />
              <button id="pickMd">选择</button>
            </div>

            <label for="outputType">输出类型</label>
            <select id="outputType">
              <option value="blog">博客文章（blog）</option>
              <option value="essays">随笔（essays）</option>
            </select>

            <label for="descInput">覆盖 description</label>
            <div class="stack-field">
              <label class="checkbox-line">
                <input id="descOverride" type="checkbox" />
                勾选后使用下面的内容；不勾选时优先保留原 description，缺失时自动生成。
              </label>
              <textarea id="descInput" placeholder="留空则尝试从正文首段自动生成摘要" disabled></textarea>
            </div>

            <label id="tagsLabel" for="tagsInput">写入 tags</label>
            <div class="stack-field" id="tagsRow">
              <label class="checkbox-line">
                <input id="tagsOverride" type="checkbox" />
                仅 blog 模式生效，支持用英文逗号分隔多个标签。
              </label>
              <input id="tagsInput" type="text" placeholder="例如：Astro, Rust, Tauri" disabled />
            </div>

            <label for="heroPath">heroImage</label>
            <div class="stack-field">
              <label class="checkbox-line">
                <input id="heroOverride" type="checkbox" />
                勾选后会将 heroImage 一并复制并改写为相对路径。
              </label>
              <div class="field-with-button">
                <input id="heroPath" type="text" placeholder="可留空" disabled />
                <button id="pickHero" disabled>选择</button>
              </div>
            </div>
          </div>

          <div class="toolbar">
            <button id="analyzeBtn">解析预览</button>
            <button class="primary action-button" id="convertBtn" data-phase="idle">开始转换</button>
            <button id="copyReport">复制报告</button>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <div>
              <h2>状态与输出</h2>
              <p>如果发现同名文章，解析阶段会先给告警，转换阶段会直接拦截。</p>
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

          <div class="preview-card">
            <div class="preview-label">当前本地配置</div>
            <div class="config-path" id="configPath">config: 未加载</div>
            <div class="inline-note">
              图片目录默认是 <code>public/images</code>，写回 Markdown 时会自动换成相对当前文章的路径。
            </div>
          </div>
        </section>
      </div>

      <section class="panel config-panel">
        <div class="panel-head">
          <div>
            <h2>本地配置</h2>
            <p>这些设置会写入系统配置目录，托盘常驻后也会继续沿用。</p>
          </div>
        </div>

        <div class="config-grid">
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

        <div class="toolbar">
          <button id="saveConfig">保存本地配置</button>
          <button id="resetConfig">恢复推荐配置</button>
        </div>
      </section>

      <section class="panel report-panel">
        <div class="panel-head">
          <div>
            <h2>执行报告</h2>
            <p>这里会显示解析告警、图片复制结果和最终输出路径。</p>
          </div>
        </div>
        <pre id="report">等待操作…</pre>
      </section>
    </div>
  `;
}

function getOutputType(): OutputType {
  return getEl<HTMLSelectElement>("#outputType").value as OutputType;
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
    throw new Error("自动摘要长度必须是大于 0 的整数");
  }

  const fileNameStrategyValue = getEl<HTMLSelectElement>("#fileNameStrategy").value;
  const fileNameStrategy: AppConfig["fileNameStrategy"] =
    fileNameStrategyValue === "titleSlug" ? "titleSlug" : "original";

  return {
    repoRoot: getEl<HTMLInputElement>("#repoRoot").value.trim(),
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
  getEl<HTMLPreElement>("#report").textContent = text.trim() ? text : "等待操作…";
}

function updateTagsVisibility() {
  const isBlog = getOutputType() === "blog";
  getEl<HTMLDivElement>("#tagsRow").style.display = isBlog ? "grid" : "none";
  getEl<HTMLLabelElement>("#tagsLabel").style.display = isBlog ? "block" : "none";
}

function syncOverrideState() {
  getEl<HTMLTextAreaElement>("#descInput").disabled = !getEl<HTMLInputElement>("#descOverride").checked;
  getEl<HTMLInputElement>("#tagsInput").disabled = !getEl<HTMLInputElement>("#tagsOverride").checked;

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
  button.textContent =
    phase === "success" ? "转换完成" : phase === "error" ? "转换失败" : "开始转换";

  if (phase !== "idle") {
    state.convertResetTimer = window.setTimeout(() => {
      const convertButton = getEl<HTMLButtonElement>("#convertBtn");
      convertButton.dataset.phase = "idle";
      convertButton.textContent = "开始转换";
      state.convertResetTimer = null;
    }, 1600);
  }
}

async function loadConfig() {
  const envelope = (await invoke("load_config")) as ConfigEnvelope;
  applyConfigToForm(envelope.config);
  getEl<HTMLDivElement>("#configPath").textContent = envelope.configPath
    ? `config: ${envelope.configPath}`
    : "config: 未找到配置文件";
  setStatus("idle", "本地配置已加载");
}

async function saveConfig() {
  const config = collectConfigFromForm();
  const envelope = (await invoke("save_config", { config })) as ConfigEnvelope;
  applyConfigToForm(envelope.config);
  getEl<HTMLDivElement>("#configPath").textContent = envelope.configPath
    ? `config: ${envelope.configPath}`
    : "config: 未找到配置文件";
  setStatus("ok", "本地配置已保存");
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

  try {
    const config = collectConfigFromForm();
    const result = (await invoke("analyze_markdown", {
      request: { mdPath, outputType: getOutputType(), config },
    })) as AnalyzeResult;

    state.lastAnalyze = result;
    setStatus(result.warnings.length ? "warn" : "ok", result.warnings.length ? "解析完成，有告警" : "解析完成");
    setImagePill(result.imageCounts);
    setPreview(result);

    if (result.warnings.length) {
      reportText(["[Warnings]", ...result.warnings.map((warning) => `- ${warning}`)].join("\n"));
    }
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

  const tags =
    getOutputType() === "blog" && getEl<HTMLInputElement>("#tagsOverride").checked
      ? getEl<HTMLInputElement>("#tagsInput")
          .value.split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : [];

  try {
    setConvertButtonPhase("loading");
    setStatus("idle", "已触发转换，正在处理中");

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
          tags,
          heroImageOverride: getEl<HTMLInputElement>("#heroOverride").checked,
          heroImagePath: getEl<HTMLInputElement>("#heroPath").value.trim() || null,
        },
      },
    })) as ConvertReport;

    const lines = [`[OK] 输出文件：${result.outputMarkdownPath}`];
    if (result.images.length) {
      lines.push("", `[Images] ${result.images.length}`);
      for (const image of result.images) {
        lines.push(`- ${image.action}: ${image.sourcePath} -> ${image.finalSitePath}`);
      }
    }
    if (result.warnings.length) {
      lines.push("", "[Warnings]");
      for (const warning of result.warnings) {
        lines.push(`- ${warning}`);
      }
    }

    setConvertButtonPhase(result.warnings.length ? "error" : "success");
    setStatus(result.warnings.length ? "warn" : "ok", result.warnings.length ? "转换完成，有告警" : "转换完成");
    reportText(lines.join("\n"));
    await analyze();
  } catch (error) {
    setConvertButtonPhase("error");
    setStatus("error", "转换失败");
    reportText(String(error));
  }
}

function resetConfigDraft() {
  const repoRoot = getEl<HTMLInputElement>("#repoRoot").value.trim();
  applyConfigToForm({ ...DEFAULT_CONFIG, repoRoot });
  setStatus("idle", "已恢复推荐配置，点击保存后生效");
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

async function hideToTray() {
  await trayWindow.hide();
  setStatus("ok", "窗口已隐藏到系统托盘");
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
updateTagsVisibility();
syncOverrideState();
setConvertButtonPhase("idle");

getEl<HTMLButtonElement>("#pickRepoRoot").addEventListener("click", async () => {
  await pickDirectory("#repoRoot", "选择博客仓库根目录");
  await analyze();
});

getEl<HTMLButtonElement>("#pickMd").addEventListener("click", pickMarkdown);
getEl<HTMLButtonElement>("#pickHero").addEventListener("click", pickHeroImage);
getEl<HTMLButtonElement>("#saveConfig").addEventListener("click", () =>
  void saveConfig().catch((error) => {
    setStatus("error", "保存配置失败");
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
getEl<HTMLButtonElement>("#hideToTray").addEventListener("click", () =>
  void hideToTray().catch((error) => {
    setStatus("error", "隐藏到托盘失败");
    reportText(String(error));
  }),
);

getEl<HTMLInputElement>("#repoRoot").addEventListener("change", () => void analyze());
getEl<HTMLInputElement>("#mdPath").addEventListener("change", () => void analyze());
getEl<HTMLSelectElement>("#outputType").addEventListener("change", () => {
  updateTagsVisibility();
  void analyze();
});

getEl<HTMLInputElement>("#descOverride").addEventListener("change", syncOverrideState);
getEl<HTMLInputElement>("#tagsOverride").addEventListener("change", syncOverrideState);
getEl<HTMLInputElement>("#heroOverride").addEventListener("change", syncOverrideState);

loadConfig().catch((error) => {
  applyConfigToForm(DEFAULT_CONFIG);
  setStatus("error", "加载配置失败");
  reportText(String(error));
});
