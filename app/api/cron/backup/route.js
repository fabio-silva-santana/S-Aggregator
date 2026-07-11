// Backup diário do Postgres (rede de segurança do plano gratuito do Supabase).
// Exporta todas as tabelas em JSON e grava no bucket privado "backups" do
// Supabase Storage. Retenção: 30 arquivos mais recentes (~30 dias).
// Disparado pelo Vercel Cron (vercel.json); protegido por CRON_SECRET.
// Limitação consciente: o backup mora no mesmo projeto Supabase — protege
// contra corrupção/apagamento acidental de linhas, não contra perda do projeto.
import { NextResponse } from "next/server";
import { supabaseAdmin, supabaseConfigurado } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BUCKET = "backups";
const TABELAS = ["users", "organizations", "organization_members", "company_profile", "processes", "ia_cache"];
const RETENCAO = 30; // arquivos

function autorizado(request) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return process.env.NODE_ENV !== "production"; // sem segredo: só em dev
  return request.headers.get("authorization") === `Bearer ${segredo}`;
}

async function despejarTabela(sb, tabela) {
  const linhas = [];
  const LOTE = 1000;
  for (let de = 0; ; de += LOTE) {
    const { data, error } = await sb.from(tabela).select("*").range(de, de + LOTE - 1);
    if (error) {
      // tabela pode ainda não existir (ex.: ia_cache recém-planejada) — registra e segue
      return { erro: error.message, linhas: [] };
    }
    linhas.push(...(data || []));
    if (!data || data.length < LOTE) break;
  }
  return { linhas };
}

export async function GET(request) {
  if (!autorizado(request)) return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  if (!supabaseConfigurado()) return NextResponse.json({ error: "supabase não configurado" }, { status: 503 });
  const t0 = Date.now();
  try {
    const sb = supabaseAdmin();

    // 1) despeja todas as tabelas
    const conteudo = { geradoEm: new Date().toISOString(), tabelas: {}, avisos: [] };
    for (const t of TABELAS) {
      const { linhas, erro } = await despejarTabela(sb, t);
      conteudo.tabelas[t] = linhas;
      if (erro) conteudo.avisos.push(`${t}: ${erro}`);
    }

    // 2) garante o bucket privado e grava o arquivo do dia (re-execução sobrescreve)
    const { data: bkt } = await sb.storage.getBucket(BUCKET);
    if (!bkt) {
      const { error } = await sb.storage.createBucket(BUCKET, { public: false });
      if (error && !/exist/i.test(error.message || "")) throw error;
    }
    const nome = `backup-${new Date().toISOString().slice(0, 10)}.json`;
    const buf = Buffer.from(JSON.stringify(conteudo));
    const up = await sb.storage.from(BUCKET).upload(nome, buf, { contentType: "application/json", upsert: true });
    if (up.error) throw up.error;

    // 3) retenção: mantém só os RETENCAO arquivos mais recentes
    const { data: arquivos } = await sb.storage.from(BUCKET).list("", { limit: 200, sortBy: { column: "name", order: "desc" } });
    const excedentes = (arquivos || []).filter((a) => a.name.startsWith("backup-")).slice(RETENCAO).map((a) => a.name);
    if (excedentes.length) await sb.storage.from(BUCKET).remove(excedentes);

    const resumo = Object.fromEntries(Object.entries(conteudo.tabelas).map(([k, v]) => [k, v.length]));
    console.log("[backup] ok", nome, resumo);
    return NextResponse.json({ ok: true, arquivo: nome, bytes: buf.length, linhasPorTabela: resumo, avisos: conteudo.avisos, removidos: excedentes.length, duracaoMs: Date.now() - t0 });
  } catch (err) {
    console.error("[backup] falha", err);
    return NextResponse.json({ ok: false, error: err.message || "falha no backup" }, { status: 500 });
  }
}
