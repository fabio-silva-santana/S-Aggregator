// Cron noturno de coleta (22:30 Recife): colheita profunda do PNCP por CNPJ
// (todas as entidades do Sistema S nas 27 UFs) + sondas de saúde das fontes.
// Ocupa 1 dos 2 crons do plano (o outro é o backup) — por isso saúde e
// colheita compartilham o mesmo job. Protegido por CRON_SECRET.
import { NextResponse } from "next/server";
import { supabaseAdmin, supabaseConfigurado } from "@/lib/supabaseServer";
import { colherPNCP } from "@/lib/harvestPNCP";
import { sondarTodas } from "@/lib/saudeFontes";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function autorizado(request) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${segredo}`;
}

export async function GET(request) {
  if (!autorizado(request)) return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  const t0 = Date.now();

  // 1) colheita profunda do PNCP → banco
  let colheita;
  try {
    colheita = await colherPNCP();
  } catch (err) {
    console.error("[coleta] colheita falhou", err);
    colheita = { ok: false, erro: err.message };
  }

  // 2) sondas de saúde (mesma lógica do /api/cron/saude)
  let saude = null;
  try {
    const resultados = await sondarTodas();
    const contagem = resultados.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});
    if (supabaseConfigurado()) {
      try {
        const sb = supabaseAdmin();
        const agora = new Date().toISOString();
        await sb.from("api_health").insert(resultados.map((r) => ({
          fonte: r.fonte, nome: r.nome, status: r.status, http_status: r.httpStatus,
          latencia_ms: r.latenciaMs, detalhe: r.detalhe, checked_at: agora,
        })));
        await sb.from("api_health").delete().lt("checked_at", new Date(Date.now() - 90 * 86400000).toISOString());
      } catch { /* tabela ausente — segue sem persistir */ }
    }
    const falhas = resultados.filter((r) => r.status === "falha");
    if (falhas.length) console.warn("[coleta] fontes com falha:", falhas.map((f) => f.fonte).join(", "));
    saude = contagem;
  } catch (err) {
    console.error("[coleta] sondas falharam", err);
  }

  console.log("[coleta] resumo", { colheita: { ok: colheita.ok, orgaosOk: colheita.orgaosOk, editais: colheita.editais }, saude, ms: Date.now() - t0 });
  return NextResponse.json({ colheita, saude, duracaoMs: Date.now() - t0 });
}
