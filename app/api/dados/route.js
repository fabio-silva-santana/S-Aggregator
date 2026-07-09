// Sincronização dos dados da organização (FASE 4b).
// GET  → garante user+org e devolve { organizacao, empresa, pipeline }.
// POST → salva empresa (company_profile) e/ou pipeline (processes) da org do usuário.
// Todo acesso é autenticado (Auth.js) e escopado por org_id no servidor.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { supabaseAdmin, supabaseConfigurado } from "@/lib/supabaseServer";
import { garantirUsuarioEOrg, carregarDadosOrg } from "@/lib/orgServer";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!supabaseConfigurado()) return NextResponse.json({ semBanco: true });
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  try {
    const { orgId, role, novoUsuario } = await garantirUsuarioEOrg(session.user);
    const dados = await carregarDadosOrg(orgId);
    return NextResponse.json({ ...dados, role, novoUsuario });
  } catch (err) {
    console.error("[dados][GET]", err);
    return NextResponse.json({ error: err.message || "falha ao carregar" }, { status: 500 });
  }
}

export async function POST(request) {
  if (!supabaseConfigurado()) return NextResponse.json({ semBanco: true });
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  try {
    const { orgId } = await garantirUsuarioEOrg(session.user);
    const sb = supabaseAdmin();

    // Cadastro da empresa (objeto inteiro em jsonb)
    if (body.empresa !== undefined) {
      await sb.from("company_profile").upsert(
        { org_id: orgId, data: body.empresa || {}, updated_at: new Date().toISOString() },
        { onConflict: "org_id" }
      );
      // reflete os campos de onboarding na org (para scoring)
      const e = body.empresa || {};
      const patch = {};
      if (e.cnpj) patch.cnpj = e.cnpj;
      const inter = e.interesses || {};
      if (Array.isArray(inter.ufs)) patch.regioes = inter.ufs;
      if (Array.isArray(inter.segmentos)) patch.cnaes = inter.segmentos;
      if (Object.keys(patch).length) {
        patch.updated_at = new Date().toISOString();
        await sb.from("organizations").update(patch).eq("id", orgId);
      }
    }

    // Pipeline de processos (substitui o conjunto da org)
    if (Array.isArray(body.pipeline)) {
      const linhas = body.pipeline
        .filter((p) => p && p.id)
        .map((p) => ({ org_id: orgId, id: String(p.id), data: p, updated_at: new Date().toISOString() }));
      const ids = linhas.map((l) => l.id);
      // remove os que saíram
      const del = sb.from("processes").delete().eq("org_id", orgId);
      await (ids.length ? del.not("id", "in", `(${ids.map((i) => `"${i}"`).join(",")})`) : del);
      if (linhas.length) await sb.from("processes").upsert(linhas, { onConflict: "org_id,id" });
    }

    // marca onboarding concluído quando sinalizado
    if (body.onboardingDone) {
      await sb.from("organizations").update({ onboarding_done: true, updated_at: new Date().toISOString() }).eq("id", orgId);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[dados][POST]", err);
    return NextResponse.json({ error: err.message || "falha ao salvar" }, { status: 500 });
  }
}
