// Cache de IA por organização (FASE 6b) — economiza tokens reaproveitando o
// relatório executivo já gerado e o histórico do chat entre sessões/dispositivos.
//   GET  /api/cache?kind=analise&key=<editalId|hash>  → { data }
//   GET  /api/cache?kind=chat&key=<editalId>          → { data }
//   POST /api/cache  { kind, key, data }              → { ok }
// Autenticado (Auth.js) e escopado por org_id. Se a tabela ia_cache ainda não
// existir no banco, degrada de forma graciosa (data:null / ok:false) para não
// quebrar a experiência — o app continua com o cache local do navegador.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { supabaseAdmin, supabaseConfigurado } from "@/lib/supabaseServer";
import { garantirUsuarioEOrg } from "@/lib/orgServer";

export const dynamic = "force-dynamic";

const KINDS = new Set(["analise", "chat"]);

// erro típico de "relation public.ia_cache does not exist" (tabela não criada ainda)
function tabelaAusente(err) {
  const m = `${err?.message || ""} ${err?.code || ""}`;
  return /ia_cache/i.test(m) && /exist|not found|schema cache|relation/i.test(m);
}

async function orgDaSessao() {
  const session = await auth();
  if (!session?.user) return { erro: NextResponse.json({ error: "não autenticado" }, { status: 401 }) };
  const { orgId } = await garantirUsuarioEOrg(session.user);
  return { orgId };
}

export async function GET(request) {
  if (!supabaseConfigurado()) return NextResponse.json({ data: null });
  const { orgId, erro } = await orgDaSessao();
  if (erro) return erro;
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  const key = url.searchParams.get("key");
  if (!KINDS.has(kind) || !key) return NextResponse.json({ error: "kind/key inválidos" }, { status: 400 });
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("ia_cache")
      .select("data")
      .eq("org_id", orgId)
      .eq("kind", kind)
      .eq("key", key)
      .maybeSingle();
    if (error) throw error;
    return NextResponse.json({ data: data?.data ?? null });
  } catch (err) {
    if (tabelaAusente(err)) return NextResponse.json({ data: null, semTabela: true });
    console.error("[cache][GET]", err);
    return NextResponse.json({ data: null }, { status: 200 }); // nunca derruba a UX
  }
}

export async function POST(request) {
  if (!supabaseConfigurado()) return NextResponse.json({ ok: false });
  const { orgId, erro } = await orgDaSessao();
  if (erro) return erro;
  const body = await request.json().catch(() => ({}));
  const { kind, key, data } = body;
  if (!KINDS.has(kind) || !key || data === undefined) {
    return NextResponse.json({ error: "kind/key/data inválidos" }, { status: 400 });
  }
  try {
    const sb = supabaseAdmin();
    const { error } = await sb.from("ia_cache").upsert(
      { org_id: orgId, kind, key: String(key), data, updated_at: new Date().toISOString() },
      { onConflict: "org_id,kind,key" }
    );
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (tabelaAusente(err)) return NextResponse.json({ ok: false, semTabela: true });
    console.error("[cache][POST]", err);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
