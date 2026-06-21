import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const compileUrl = process.env.COMPILE_API_URL ?? "http://127.0.0.1:4000/compile";
  const healthUrl = new URL("/health", compileUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);

  try {
    const upstream = await fetch(healthUrl, { signal: controller.signal, cache: "no-store" });
    const compiler = await upstream.json();
    return NextResponse.json({ ok: upstream.ok, service: "texdrop-web", compiler }, { status: upstream.ok ? 200 : 503 });
  } catch {
    return NextResponse.json({ ok: false, service: "texdrop-web", compiler: null }, { status: 503 });
  } finally {
    clearTimeout(timer);
  }
}
