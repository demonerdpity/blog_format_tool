import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function commandExists(cmd) {
  const res = spawnSync(cmd, ["--version"], { stdio: "ignore", shell: false });
  return res.status === 0 && !res.error;
}

function prependPath(env, dir) {
  const delimiter = process.platform === "win32" ? ";" : ":";
  const current = env.PATH || env.Path || "";
  if (current.split(delimiter).some((p) => p.toLowerCase() === dir.toLowerCase())) return;
  const next = dir + delimiter + current;
  env.PATH = next;
  env.Path = next;
}

function maybeEnsureCargoOnPath(env) {
  if (commandExists("cargo")) return;

  const candidates = [];
  if (process.platform === "win32") {
    const userProfile = env.USERPROFILE;
    if (userProfile) candidates.push(path.join(userProfile, ".cargo", "bin"));
  } else {
    const home = env.HOME;
    if (home) candidates.push(path.join(home, ".cargo", "bin"));
  }

  for (const dir of candidates) {
    const cargoPath = path.join(dir, process.platform === "win32" ? "cargo.exe" : "cargo");
    if (fs.existsSync(cargoPath)) {
      prependPath(env, dir);
      return;
    }
  }
}

function maybeEnsureNodeOnPath(env) {
  if (commandExists("node")) return;
  const nodeExe = process.execPath;
  if (!nodeExe) return;
  const dir = path.dirname(nodeExe);
  if (dir && fs.existsSync(nodeExe)) {
    prependPath(env, dir);
  }
}

function getTauriBin() {
  const binName = process.platform === "win32" ? "tauri.cmd" : "tauri";
  return path.resolve("node_modules", ".bin", binName);
}

function getWindowsCmdExe(env) {
  const comspec = env.ComSpec || env.COMSPEC;
  if (comspec && fs.existsSync(comspec)) return comspec;

  const systemRoot = env.SystemRoot || env.SYSTEMROOT || "C:\\Windows";
  const candidate = path.join(systemRoot, "System32", "cmd.exe");
  if (fs.existsSync(candidate)) return candidate;

  return "cmd.exe";
}

const env = { ...process.env };
maybeEnsureCargoOnPath(env);
maybeEnsureNodeOnPath(env);

const tauriBin = getTauriBin();
if (!fs.existsSync(tauriBin)) {
  console.error(`[blog-format-tool] 找不到 Tauri CLI：${tauriBin}`);
  console.error(`[blog-format-tool] 先运行：npm install`);
  process.exit(1);
}

const args = process.argv.slice(2);
const spawn = (() => {
  if (process.platform === "win32") {
    const cmdExe = getWindowsCmdExe(env);
    return { command: cmdExe, args: ["/c", tauriBin, ...args] };
  }
  return { command: tauriBin, args };
})();

const res = spawnSync(spawn.command, spawn.args, { stdio: "inherit", env, shell: false });

if (res.error) {
  console.error(res.error.message || String(res.error));
  process.exit(1);
}
process.exit(res.status ?? 0);
