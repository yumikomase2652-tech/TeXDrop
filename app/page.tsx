"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const SAMPLE = String.raw`\documentclass[a4paper,11pt]{bxjsarticle}
\usepackage{luatexja-fontspec}
\usepackage{amsmath}
\title{はじめての TeXdrop}
\author{}
\date{}

\begin{document}
\maketitle

ブラウザから、\LaTeX をPDFに変換できます。

\begin{equation}
  e^{i\pi} + 1 = 0
\end{equation}

日本語も、そのままどうぞ。
\end{document}`;

type CompileResult = {
  ok: boolean;
  pdf?: string;
  log: string;
  error?: string;
  durationMs?: number;
};

function base64ToBlobUrl(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
}

export default function Home() {
  const [source, setSource] = useState(SAMPLE);
  const [status, setStatus] = useState<"idle" | "compiling" | "success" | "error">("idle");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [log, setLog] = useState("コンパイルを実行すると、ここにログが表示されます。");
  const [duration, setDuration] = useState<number | null>(null);

  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);

  const lineCount = useMemo(() => source.split("\n").length, [source]);

  const compile = useCallback(async () => {
    setStatus("compiling");
    setLog("コンパイル環境を準備しています…");
    setDuration(null);

    try {
      const response = await fetch("/api/compile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source, engine: "lualatex" }),
      });
      const result = (await response.json()) as CompileResult;
      setLog(result.log || result.error || "ログはありません。");
      setDuration(result.durationMs ?? null);
      if (!response.ok || !result.ok || !result.pdf) {
        setStatus("error");
        return;
      }
      const nextUrl = base64ToBlobUrl(result.pdf);
      setPdfUrl((current) => { if (current) URL.revokeObjectURL(current); return nextUrl; });
      setStatus("success");
    } catch {
      setStatus("error");
      setLog("コンパイルAPIに接続できませんでした。APIが起動しているか確認してください。");
    }
  }, [source]);

  return (
    <main>
      <header className="siteHeader">
        <a className="brand" href="#top" aria-label="TeXdrop ホーム">
          <span className="brandMark" aria-hidden="true">T<span>x</span></span>
          <span>TeXdrop</span>
        </a>
        <div className="headerMeta">
          <span className="privacyDot" /> 保存なし・ログイン不要
        </div>
      </header>

      <section className="hero" id="top">
        <p className="eyebrow">ONE FILE. ONE CLICK. ONE PDF.</p>
        <h1>LaTeXを、<br /><em>すぐPDFに。</em></h1>
        <p className="lead">環境構築もアカウントもいりません。<br className="mobileBreak" />書いて、押して、できあがり。</p>
        <div className="principles" aria-label="サービスの特徴">
          <span>01　ブラウザだけ</span><span>02　日本語対応</span><span>03　自動削除</span>
        </div>
      </section>

      <section className="workspace" aria-label="LaTeXコンパイラー">
        <div className="editorPanel">
          <div className="panelHeader">
            <div><span className="step">01</span><h2>LaTeXを書く</h2></div>
            <span className="fileName">main.tex</span>
          </div>
          <div className="editorWrap">
            <div className="lineRail" aria-hidden="true">{Array.from({ length: lineCount }, (_, i) => <span key={i}>{i + 1}</span>)}</div>
            <textarea value={source} onChange={(e) => setSource(e.target.value)} spellCheck={false} aria-label="LaTeXソース" />
          </div>
          <div className="editorFooter">
            <span>LuaLaTeX</span><span>UTF-8</span><span>{lineCount} lines</span>
          </div>
        </div>

        <div className="actionBar">
          <button onClick={compile} disabled={status === "compiling"}>
            {status === "compiling" ? <><span className="spinner" /> Compiling…</> : <>Compile <span aria-hidden="true">↗</span></>}
          </button>
          <p>45秒でタイムアウト</p>
        </div>

        <div className="previewPanel">
          <div className="panelHeader">
            <div><span className="step">02</span><h2>PDFを確認</h2></div>
            {status === "success" && <span className="successBadge">● READY {duration ? `${(duration / 1000).toFixed(1)}s` : ""}</span>}
          </div>
          <div className="previewBody">
            {pdfUrl ? (
              <iframe src={`${pdfUrl}#toolbar=0&view=FitH`} title="生成されたPDF" />
            ) : (
              <div className="emptyPreview">
                <div className="paperIcon"><span>PDF</span></div>
                <strong>{status === "compiling" ? "PDFを生成中…" : "プレビューはここに表示されます"}</strong>
                <p>左のLaTeXをコンパイルしてください</p>
              </div>
            )}
          </div>
          <div className="previewFooter">
            <span>{pdfUrl ? "main.pdf" : "PDF未生成"}</span>
            {pdfUrl && <a href={pdfUrl} download="main.pdf">PDFをダウンロード <span>↓</span></a>}
          </div>
        </div>
      </section>

      <section className={`logPanel ${status === "error" ? "hasError" : ""}`}>
        <div className="logHeader">
          <div><span className="step">03</span><h2>コンパイルログ</h2></div>
          <span>{status === "error" ? "ERROR" : status === "success" ? "SUCCESS" : "OUTPUT"}</span>
        </div>
        <pre>{log}</pre>
      </section>

      <footer>
        <p>ファイルは保存されません。コンパイル後、サーバーから自動的に削除されます。</p>
        <span>TeXdrop / Local MVP</span>
      </footer>
    </main>
  );
}
