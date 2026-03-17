import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function commandExists(cmd) {
  const result = spawnSync(cmd, ["--version"], { stdio: "ignore", shell: false });
  return result.status === 0 && !result.error;
}

function prependPath(env, dir) {
  const delimiter = process.platform === "win32" ? ";" : ":";
  const current = env.PATH || env.Path || "";
  if (current.split(delimiter).some((item) => item.toLowerCase() === dir.toLowerCase())) {
    return;
  }

  const next = `${dir}${delimiter}${current}`;
  env.PATH = next;
  env.Path = next;
}

function ensureCargoOnPath(env) {
  if (commandExists("cargo")) {
    return;
  }

  const candidates = [];
  if (process.platform === "win32") {
    if (env.USERPROFILE) {
      candidates.push(path.join(env.USERPROFILE, ".cargo", "bin"));
    }
  } else if (env.HOME) {
    candidates.push(path.join(env.HOME, ".cargo", "bin"));
  }

  for (const dir of candidates) {
    const cargoPath = path.join(dir, process.platform === "win32" ? "cargo.exe" : "cargo");
    if (fs.existsSync(cargoPath)) {
      prependPath(env, dir);
      return;
    }
  }
}

function ensureNodeOnPath(env) {
  if (commandExists("node")) {
    return;
  }

  if (!process.execPath || !fs.existsSync(process.execPath)) {
    return;
  }

  prependPath(env, path.dirname(process.execPath));
}

function getTauriBin() {
  const binName = process.platform === "win32" ? "tauri.cmd" : "tauri";
  return path.resolve("node_modules", ".bin", binName);
}

function getWindowsCmdExe(env) {
  const comspec = env.ComSpec || env.COMSPEC;
  if (comspec && fs.existsSync(comspec)) {
    return comspec;
  }

  const systemRoot = env.SystemRoot || env.SYSTEMROOT || "C:\\Windows";
  const candidate = path.join(systemRoot, "System32", "cmd.exe");
  return fs.existsSync(candidate) ? candidate : "cmd.exe";
}

const env = { ...process.env };
ensureCargoOnPath(env);
ensureNodeOnPath(env);

const tauriBin = getTauriBin();
if (!fs.existsSync(tauriBin)) {
  console.error(`[blog-format-tool] 找不到 Tauri CLI：${tauriBin}`);
  console.error("[blog-format-tool] 请先执行：npm install");
  process.exit(1);
}

const args = process.argv.slice(2);
const spawnTarget =
  process.platform === "win32"
    ? { command: getWindowsCmdExe(env), args: ["/c", tauriBin, ...args] }
    : { command: tauriBin, args };

const result = spawnSync(spawnTarget.command, spawnTarget.args, {
  stdio: "inherit",
  env,
  shell: false,
});

if (result.error) {
  console.error(result.error.message || String(result.error));
  process.exit(1);
}

process.exit(result.status ?? 0);
