import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 55;

export async function POST(request: NextRequest) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 50_000);

  try {
    const body = await request.text();
    const upstream = await fetch(process.env.COMPILE_API_URL ?? "http://127.0.0.1:4000/compile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: controller.signal,
      cache: "no-store",
    });
    return new NextResponse(await upstream.text(), {
      status: upstream.status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return NextResponse.json({
      ok: false,
      log: timedOut ? "コンパイルAPIがタイムアウトしました。" : "コンパイルAPIに接続できませんでした。",
      error: timedOut ? "Gateway timeout" : "Compiler unavailable",
    }, { status: timedOut ? 504 : 503 });
  } finally {
    clearTimeout(timer);
  }
}
