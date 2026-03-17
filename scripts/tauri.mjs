import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
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

function createTauriSpawn(env, args) {
  const tauriBin = getTauriBin();
  if (!fs.existsSync(tauriBin)) {
    console.error(`[blog-format-tool] 找不到 Tauri CLI：${tauriBin}`);
    console.error("[blog-format-tool] 请先执行：npm install");
    process.exit(1);
  }

  if (process.platform === "win32") {
    return {
      command: getWindowsCmdExe(env),
      args: ["/c", tauriBin, ...args],
    };
  }

  return {
    command: tauriBin,
    args,
  };
}

function runSync(command, args, env) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env,
    shell: false,
  });

  if (result.error) {
    console.error(result.error.message || String(result.error));
    process.exit(1);
  }

  return result.status ?? 0;
}

function startViteServer(env) {
  const viteBin = path.resolve("node_modules", "vite", "bin", "vite.js");
  if (!fs.existsSync(viteBin)) {
    console.error(`[blog-format-tool] 找不到 Vite CLI：${viteBin}`);
    console.error("[blog-format-tool] 请先执行：npm install");
    process.exit(1);
  }

  const viteEnv = {
    ...env,
    TAURI_DEV_HOST: "127.0.0.1",
  };

  return spawn(process.execPath, [viteBin, "--host", "127.0.0.1", "--strictPort"], {
    stdio: "inherit",
    env: viteEnv,
    shell: false,
  });
}

function requestUrl(url) {
  const transport = url.startsWith("https://") ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.get(url, (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });

    request.on("error", reject);
    request.setTimeout(1000, () => {
      request.destroy(new Error("timeout"));
    });
  });
}

async function waitForUrl(url, serverProcess, timeoutMs = 30000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (serverProcess.exitCode !== null) {
      throw new Error("前端开发服务器提前退出，Tauri 没法继续启动");
    }

    try {
      const status = await requestUrl(url);
      if (status >= 200 && status < 500) {
        return;
      }
    } catch {
      // Ignore until timeout and keep polling.
    }

    await new Promise((resolve) => setTimeout(resolve, 350));
  }

  throw new Error(`等待开发服务器超时：${url}`);
}

function stopProcessTree(child) {
  if (!child || child.exitCode !== null) {
    return;
  }

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      shell: false,
    });
    return;
  }

  child.kill("SIGTERM");
}

async function runDevFlow(env, args) {
  const viteServer = startViteServer(env);
  const devUrl = "http://127.0.0.1:1420";

  try {
    await waitForUrl(devUrl, viteServer);

    const configOverride = JSON.stringify({
      build: {
        beforeDevCommand: 'node -e "process.exit(0)"',
        devUrl,
      },
    });

    const tauriArgs = ["dev", "--no-dev-server-wait", "--config", configOverride, ...args.slice(1)];
    const tauriSpawn = createTauriSpawn(env, tauriArgs);
    return runSync(tauriSpawn.command, tauriSpawn.args, env);
  } finally {
    stopProcessTree(viteServer);
  }
}

const env = { ...process.env };
ensureCargoOnPath(env);
ensureNodeOnPath(env);

const args = process.argv.slice(2);
const command = args[0];
const shouldUseManagedDevFlow =
  command === "dev" && !args.includes("--help") && !args.includes("-h");

const exitCode = shouldUseManagedDevFlow
  ? await runDevFlow(env, args)
  : (() => {
      const tauriSpawn = createTauriSpawn(env, args);
      return runSync(tauriSpawn.command, tauriSpawn.args, env);
    })();

process.exit(exitCode);
