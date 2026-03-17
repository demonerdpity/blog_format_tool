import "./style.css";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

type OutputType = "blog" | "essays";

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

const $ = <T extends HTMLElement>(selector: string) => document.querySelector(selector) as T;

function escapeHtml(s: string) {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function render(app: HTMLElement) {
  app.innerHTML = `
    <div class="container">
      <h1>Markdown & 图片转化器（Astro /images 路径）</h1>
      <div class="grid">
        <div class="panel">
          <div class="row">
            <label>博客仓库根目录</label>
            <input id="repoRoot" type="text" placeholder="例如：C:\\\\Users\\\\admin\\\\work\\\\blog" />
            <button id="pickRepoRoot">选择</button>
          </div>
          <div class="row">
            <label>Markdown 文件</label>
            <input id="mdPath" type="text" placeholder="选择单个 .md/.mdx 文件" />
            <button id="pickMd">选择</button>
          </div>
          <div class="row">
            <label>输出类型</label>
            <select id="outputType">
              <option value="blog">博文（blog）</option>
              <option value="essays">随笔（essays）</option>
            </select>
            <span class="small" id="configPath"></span>
          </div>

          <div class="row">
            <label>覆盖 description</label>
            <div>
              <label class="small"><input id="descOverride" type="checkbox" /> 勾选后使用下方输入，否则优先保留原值（缺失则自动生成）</label>
              <textarea id="descInput" placeholder="留空则自动生成首段摘要" disabled></textarea>
            </div>
            <span></span>
          </div>

          <div class="row" id="tagsRow">
            <label>写入 tags（仅 blog）</label>
            <div>
              <label class="small"><input id="tagsOverride" type="checkbox" /> 勾选后写入 tags（逗号分隔）</label>
              <input id="tagsInput" type="text" placeholder="例如：Astro, Rust, Tauri" disabled />
            </div>
            <span></span>
          </div>

          <div class="row">
            <label>heroImage（可选）</label>
            <div>
              <label class="small"><input id="heroOverride" type="checkbox" /> 勾选后选择 heroImage，并参与复制与路径改写</label>
              <div style="display:flex; gap:10px; margin-top:8px;">
                <input id="heroPath" type="text" placeholder="可留空" disabled />
                <button id="pickHero" disabled>选择</button>
              </div>
            </div>
            <span></span>
          </div>

          <div class="actions">
            <button id="saveConfig">保存配置</button>
            <button id="analyzeBtn">解析预览</button>
            <button class="primary" id="convertBtn">开始转换</button>
            <button id="copyReport">复制报告</button>
          </div>
          <div class="hint" style="margin-top:10px;">
            默认：图片复制（不删除源图片）；updatedDate 每次覆盖；pubDate 缺失才补全；图片子目录=title（安全化后）。
          </div>
        </div>

        <div class="panel">
          <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
            <span class="pill" id="statusPill">未解析</span>
            <span class="pill" id="imgPill">图片：0</span>
          </div>
          <div style="margin-top:10px;">
            <div class="small">Title</div>
            <div id="titlePreview" style="margin-top:6px;"></div>
          </div>
          <div style="margin-top:10px;">
            <div class="small">输出文件</div>
            <div id="outputPreview" style="margin-top:6px;"></div>
          </div>
          <pre id="report"></pre>
        </div>
      </div>
    </div>
  `;
}

const app = $("#app");
render(app);

const state = {
  config: null as AppConfig | null,
  lastAnalyze: null as AnalyzeResult | null,
};

function getOutputType(): OutputType {
  return ($("#outputType") as HTMLSelectElement).value as OutputType;
}

function setStatus(kind: "idle" | "ok" | "warn" | "error", text: string) {
  const pill = $("#statusPill");
  pill.className = "pill " + (kind === "ok" ? "ok" : kind === "warn" ? "warn" : kind === "error" ? "danger" : "");
  pill.textContent = text;
}

function setImagePill(counts?: AnalyzeResult["imageCounts"]) {
  const pill = $("#imgPill");
  if (!counts) {
    pill.textContent = "图片：0";
    return;
  }
  pill.textContent = `图片：${counts.total}（本地 ${counts.local} / 远程 ${counts.remote} / 站点 ${counts.site}）`;
}

function reportText(s: string) {
  $("#report").textContent = s.trim() ? s : "";
}

function updateTagsVisibility() {
  const isBlog = getOutputType() === "blog";
  ($("#tagsRow") as HTMLDivElement).style.display = isBlog ? "grid" : "none";
}

async function loadConfig() {
  const env = (await invoke("load_config")) as ConfigEnvelope;
  state.config = env.config;
  ($("#repoRoot") as HTMLInputElement).value = env.config.repoRoot || "";
  ($("#configPath") as HTMLSpanElement).textContent = env.configPath ? `config: ${env.configPath}` : "";
}

async function saveConfig() {
  if (!state.config) return;
  const repoRoot = ($("#repoRoot") as HTMLInputElement).value.trim();
  const next: AppConfig = { ...state.config, repoRoot };
  const env = (await invoke("save_config", { config: next })) as ConfigEnvelope;
  state.config = env.config;
  ($("#configPath") as HTMLSpanElement).textContent = env.configPath ? `config: ${env.configPath}` : "";
  setStatus("ok", "配置已保存");
}

async function analyze() {
  reportText("");
  const mdPath = ($("#mdPath") as HTMLInputElement).value.trim();
  const repoRoot = ($("#repoRoot") as HTMLInputElement).value.trim();
  if (!mdPath) {
    setStatus("idle", "未解析");
    return;
  }
  if (!state.config) {
    setStatus("error", "配置未加载");
    return;
  }

  const config: AppConfig = { ...state.config, repoRoot };
  try {
    const res = (await invoke("analyze_markdown", {
      request: { mdPath, outputType: getOutputType(), config },
    })) as AnalyzeResult;
    state.lastAnalyze = res;

    setStatus(res.warnings.length ? "warn" : "ok", res.warnings.length ? "有警告" : "已解析");
    setImagePill(res.imageCounts);
    $("#titlePreview").innerHTML = res.title ? escapeHtml(res.title) : `<span class="small">（缺少 title）</span>`;
    $("#outputPreview").innerHTML = res.outputMarkdownPath
      ? `<code>${escapeHtml(res.outputMarkdownPath)}</code>`
      : `<span class="small">（未生成输出路径）</span>`;

    if (res.warnings.length) {
      reportText(["[Warnings]", ...res.warnings.map((w) => `- ${w}`)].join("\n"));
    }
  } catch (e) {
    state.lastAnalyze = null;
    setStatus("error", "解析失败");
    setImagePill(undefined);
    $("#titlePreview").textContent = "";
    $("#outputPreview").textContent = "";
    reportText(String(e));
  }
}

async function convert() {
  reportText("");
  const mdPath = ($("#mdPath") as HTMLInputElement).value.trim();
  const repoRoot = ($("#repoRoot") as HTMLInputElement).value.trim();
  if (!mdPath) {
    setStatus("error", "请先选择 Markdown");
    return;
  }
  if (!state.config) {
    setStatus("error", "配置未加载");
    return;
  }

  const config: AppConfig = { ...state.config, repoRoot };
  const descOverride = ($("#descOverride") as HTMLInputElement).checked;
  const descInput = ($("#descInput") as HTMLTextAreaElement).value;

  const tagsOverride = ($("#tagsOverride") as HTMLInputElement).checked;
  const tagsInput = ($("#tagsInput") as HTMLInputElement).value;

  const heroOverride = ($("#heroOverride") as HTMLInputElement).checked;
  const heroPath = ($("#heroPath") as HTMLInputElement).value.trim();

  const tags =
    getOutputType() === "blog" && tagsOverride
      ? tagsInput
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

  try {
    const res = (await invoke("convert_markdown", {
      request: {
        mdPath,
        outputType: getOutputType(),
        config,
        meta: {
          descriptionOverride: descOverride,
          description: descInput,
          tagsOverride,
          tags,
          heroImageOverride: heroOverride,
          heroImagePath: heroPath || null,
        },
      },
    })) as ConvertReport;

    setStatus(res.warnings.length ? "warn" : "ok", res.warnings.length ? "完成（有警告）" : "完成");
    const lines: string[] = [];
    lines.push(`[OK] 输出：${res.outputMarkdownPath}`);
    if (res.images.length) {
      lines.push("");
      lines.push(`[Images] ${res.images.length}`);
      for (const img of res.images) {
        lines.push(`- ${img.action}: ${img.sourcePath} -> ${img.finalSitePath}`);
      }
    }
    if (res.warnings.length) {
      lines.push("");
      lines.push("[Warnings]");
      for (const w of res.warnings) lines.push(`- ${w}`);
    }
    reportText(lines.join("\n"));
    await analyze();
  } catch (e) {
    setStatus("error", "转换失败");
    reportText(String(e));
  }
}

$("#pickRepoRoot").addEventListener("click", async () => {
  const selected = await open({ directory: true, multiple: false, title: "选择博客仓库根目录" });
  if (typeof selected === "string") {
    ($("#repoRoot") as HTMLInputElement).value = selected;
    await analyze();
  }
});

$("#pickMd").addEventListener("click", async () => {
  const selected = await open({
    multiple: false,
    directory: false,
    title: "选择 Markdown 文件",
    filters: [{ name: "Markdown", extensions: ["md", "mdx"] }],
  });
  if (typeof selected === "string") {
    ($("#mdPath") as HTMLInputElement).value = selected;
    await analyze();
  }
});

($("#repoRoot") as HTMLInputElement).addEventListener("change", analyze);
($("#mdPath") as HTMLInputElement).addEventListener("change", analyze);

$("#saveConfig").addEventListener("click", saveConfig);
$("#analyzeBtn").addEventListener("click", analyze);
$("#convertBtn").addEventListener("click", convert);

$("#copyReport").addEventListener("click", async () => {
  const text = $("#report").textContent || "";
  await navigator.clipboard.writeText(text);
  setStatus("ok", "报告已复制");
});

$("#outputType").addEventListener("change", async () => {
  updateTagsVisibility();
  await analyze();
});

$("#descOverride").addEventListener("change", () => {
  const enabled = ($("#descOverride") as HTMLInputElement).checked;
  ($("#descInput") as HTMLTextAreaElement).disabled = !enabled;
});

$("#tagsOverride").addEventListener("change", () => {
  const enabled = ($("#tagsOverride") as HTMLInputElement).checked;
  ($("#tagsInput") as HTMLInputElement).disabled = !enabled;
});

$("#heroOverride").addEventListener("change", () => {
  const enabled = ($("#heroOverride") as HTMLInputElement).checked;
  ($("#heroPath") as HTMLInputElement).disabled = !enabled;
  ($("#pickHero") as HTMLButtonElement).disabled = !enabled;
});

$("#pickHero").addEventListener("click", async () => {
  const selected = await open({
    multiple: false,
    directory: false,
    title: "选择 heroImage",
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"] }],
  });
  if (typeof selected === "string") {
    ($("#heroPath") as HTMLInputElement).value = selected;
  }
});

updateTagsVisibility();
loadConfig().catch((e) => {
  setStatus("error", "加载配置失败");
  reportText(String(e));
});
