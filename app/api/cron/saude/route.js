// FASE 7 — auditoria diária de saúde dos conectores (Vercel Cron, 00:00 Recife).
// Sonda cada fonte oficial (Django, STW, PNCP, Correios) com retry+backoff,
// valida o schema da resposta e grava o resultado na tabela api_health.
// Retenção: 90 dias de histórico. Protegido por CRON_SECRET.
// Se a tabela api_health ainda não existir, degrada: devolve o resultado das
// sondas com aviso, sem quebrar (mesmo padrão da ia_cache).
import { NextResponse } from "next/server";
import { supabaseAdmin, supabaseConfigurado } from "@/lib/supabaseServer";
import { sondarTodas } from "@/lib/saudeFontes";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function autorizado(request) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${segredo}`;
}

export async function GET(request) {
  if (!autorizado(request)) return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  const t0 = Date.now();

  // 1) sonda todas as fontes em paralelo
  const resultados = await sondarTodas();
  const contagem = resultados.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});
  const falhas = resultados.filter((r) => r.status === "falha");

  // 2) persiste no api_health (se banco e tabela disponíveis)
  let persistido = false;
  let avisoTabela = null;
  if (supabaseConfigurado()) {
    try {
      const sb = supabaseAdmin();
      const agora = new Date().toISOString();
      const linhas = resultados.map((r) => ({
        fonte: r.fonte,
        nome: r.nome,
        status: r.status,
        http_status: r.httpStatus,
        latencia_ms: r.latenciaMs,
        detalhe: r.detalhe,
        checked_at: agora,
      }));
      const ins = await sb.from("api_health").insert(linhas);
      if (ins.error) throw ins.error;
      persistido = true;
      // retenção de 90 dias
      const limite = new Date(Date.now() - 90 * 86400000).toISOString();
      await sb.from("api_health").delete().lt("checked_at", limite);
    } catch (err) {
      if (/api_health/i.test(`${err.message}`) && /exist|schema cache|relation/i.test(`${err.message}`)) {
        avisoTabela = "tabela api_health ainda não criada — rode o bloco correspondente de docs/supabase-schema.sql";
      } else {
        console.error("[saude] persistência falhou", err);
        avisoTabela = `persistência falhou: ${err.message}`;
      }
    }
  }

  // 3) alerta simples: falhas ficam registradas no log da Vercel (visível em Deployments → Functions)
  if (falhas.length) console.warn("[saude] fontes com falha:", falhas.map((f) => `${f.fonte} (${f.detalhe})`).join("; "));
  console.log("[saude] resumo", contagem, `${Date.now() - t0}ms`);

  return NextResponse.json({
    ok: falhas.length === 0,
    resumo: contagem,
    persistido,
    ...(avisoTabela ? { aviso: avisoTabela } : {}),
    fontes: resultados,
    duracaoMs: Date.now() - t0,
  });
}
