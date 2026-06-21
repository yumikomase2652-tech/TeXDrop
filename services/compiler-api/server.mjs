import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? "127.0.0.1";
const TIMEOUT_MS = 45_000;
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT ?? 2);
const TEX_IMAGE = process.env.TEX_IMAGE ?? "latex-mvp-texlive:local";
const COMPILER_RUNTIME = process.env.COMPILER_RUNTIME ?? "docker";
const WORK_ROOT = process.env.WORK_ROOT ?? tmpdir();
const TEX_CACHE_SEED = process.env.TEX_CACHE_SEED;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000")
  .split(",").map((origin) => origin.trim()).filter(Boolean);
let activeJobs = 0;

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin || (!ALLOWED_ORIGINS.includes("*") && !ALLOWED_ORIGINS.includes(origin))) return {};
  return {
    "access-control-allow-origin": ALLOWED_ORIGINS.includes("*") ? "*" : origin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    vary: "Origin",
  };
}

function json(req, res, status, value) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...corsHeaders(req),
  });
  res.end(JSON.stringify(value));
}

function prepareSource(source) {
  return source.replace(
    /\\documentclass(?:\[([^\]]*)\])?\{bxjsarticle\}/,
    (declaration, optionText = "") => {
      const options = optionText.split(",").map((option) => option.trim()).filter(Boolean);
      const hasEngine = options.some((option) => ["lualatex", "xelatex", "platex", "uplatex"].includes(option));
      const hasJapaneseMode = options.some((option) => option.startsWith("ja="));
      if (hasEngine && hasJapaneseMode) return declaration;
      if (!hasEngine) options.push("lualatex");
      if (!hasJapaneseMode) options.push("ja=standard");
      return `\\documentclass[${options.join(",")}]{bxjsarticle}`;
    },
  );
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], ...options });
    let output = "";
    let timedOut = false;
    let settled = false;
    const finish = (result) => { if (!settled) { settled = true; resolve(result); } };
    const collect = (data) => { output += data.toString(); if (output.length > 500_000) output = output.slice(-500_000); };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (error) => finish({ code: 127, output: `${output}\n${error.message}`, timedOut: false }));
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, TIMEOUT_MS);
    child.on("close", (code) => { clearTimeout(timer); finish({ code: code ?? 1, output, timedOut }); });
  });
}

function runDocker(workdir) {
  const args = [
    "run", "--rm", "--network", "none", "--cpus", "1", "--memory", "1g", "--memory-swap", "1g",
    "--pids-limit", "128", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--read-only",
    "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=256m",
    "--env", "HOME=/tmp",
    "--env", "TEXMFVAR=/tmp/texmf-var",
    "--env", "TEXMFCONFIG=/tmp/texmf-config",
    "--env", "TEXMFCACHE=/tmp/texmf-cache",
    "--env", "XDG_CACHE_HOME=/tmp/.cache",
    "--user", "1000:1000", "-v", `${workdir}:/work:rw`,
    TEX_IMAGE,
    "sh", "-c",
    "mkdir -p /tmp/texmf-var /tmp/texmf-config /tmp/texmf-cache /tmp/.cache && exec \"$@\"",
    "texdrop-compile",
    "latexmk", "-lualatex",
    "-interaction=nonstopmode", "-halt-on-error", "-file-line-error",
    "-no-shell-escape", "-outdir=/work", "/work/main.tex",
  ];
  return runProcess("docker", args);
}

async function runNative(workdir) {
  const texmfVar = join(workdir, "texmf-var");
  const texmfConfig = join(workdir, "texmf-config");
  const texmfCache = join(workdir, "texmf-cache");
  const xdgCache = join(workdir, "xdg-cache");
  await Promise.all([texmfVar, texmfConfig, texmfCache, xdgCache].map((path) => mkdir(path, { recursive: true })));
  if (TEX_CACHE_SEED) await cp(TEX_CACHE_SEED, texmfCache, { recursive: true });

  const compileEnv = {
    ...process.env,
    HOME: workdir,
    TEXMFVAR: texmfVar,
    TEXMFCONFIG: texmfConfig,
    TEXMFCACHE: texmfCache,
    XDG_CACHE_HOME: xdgCache,
  };
  const options = { cwd: workdir, env: compileEnv };

  return runProcess("latexmk", [
    "-lualatex",
    "-interaction=nonstopmode", "-halt-on-error", "-file-line-error", "-no-shell-escape",
    `-outdir=${workdir}`, join(workdir, "main.tex"),
  ], options);
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(req));
    return res.end();
  }
  if (req.method === "GET" && req.url === "/health") {
    return json(req, res, 200, { ok: true, service: "texdrop-compiler", runtime: COMPILER_RUNTIME, activeJobs });
  }
  if (req.method !== "POST" || req.url !== "/compile") return json(req, res, 404, { ok: false, error: "Not found", log: "" });
  if (activeJobs >= MAX_CONCURRENT) return json(req, res, 429, { ok: false, error: "Compiler busy", log: "同時実行数の上限に達しています。少し待って再実行してください。" });

  let workdir;
  const startedAt = Date.now();
  activeJobs += 1;
  try {
    const body = await readJson(req);
    if (body.engine !== undefined && body.engine !== "lualatex") return json(req, res, 400, { ok: false, error: "Unsupported engine", log: "MVPではLuaLaTeXのみ選択できます。" });
    if (typeof body.source !== "string" || body.source.trim() === "") return json(req, res, 400, { ok: false, error: "Source required", log: "LaTeXソースを入力してください。" });

    workdir = await mkdtemp(join(WORK_ROOT, "texdrop-"));
    await writeFile(join(workdir, "main.tex"), prepareSource(body.source), { encoding: "utf8", mode: 0o600 });
    const result = COMPILER_RUNTIME === "native" ? await runNative(workdir) : await runDocker(workdir);
    const durationMs = Date.now() - startedAt;
    if (result.timedOut) return json(req, res, 408, { ok: false, error: "Compile timeout", log: `${result.output}\n\n45秒でタイムアウトしました。`, durationMs });
    if (result.code !== 0) {
      const dockerMissing = result.code === 127;
      return json(req, res, 422, {
        ok: false,
        error: dockerMissing ? "Docker unavailable" : "LaTeX compile failed",
        log: dockerMissing
          ? "Dockerを実行できませんでした。Docker Desktopのインストールと起動を確認してください。"
          : result.output || "コンパイルに失敗しました。",
        durationMs,
      });
    }

    const pdf = await readFile(join(workdir, "main.pdf"));
    return json(req, res, 200, { ok: true, pdf: pdf.toString("base64"), log: result.output, durationMs });
  } catch (error) {
    const status = Number(error?.status) || (error instanceof SyntaxError ? 400 : 500);
    return json(req, res, status, { ok: false, error: status === 400 ? "Invalid JSON" : "Internal compiler error", log: error instanceof Error ? error.message : "予期しないエラーが発生しました。" });
  } finally {
    activeJobs -= 1;
    if (workdir) await rm(workdir, { recursive: true, force: true });
  }
});

server.listen(PORT, HOST, () => console.log(`Compiler API listening on http://${HOST}:${PORT} (${COMPILER_RUNTIME})`));
