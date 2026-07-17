// Cron diário matinal (07:00 Recife = 10:00 UTC), em 3 etapas:
//   1. colheita profunda do PNCP por CNPJ (Sistema S nas 27 UFs)
//   2. sondas de saúde das fontes → api_health
//   3. digest diário de oportunidades abertas por e-mail/WhatsApp
// Roda de manhã de propósito: os assinantes recebem o resumo com os dados
// recém-colhidos, em horário útil. O plano da Vercel permite 2 crons — este
// e o backup —, por isso as três etapas compartilham o mesmo job.
// Protegido por CRON_SECRET.
import { NextResponse } from "next/server";
import { supabaseAdmin, supabaseConfigurado } from "@/lib/supabaseServer";
import { colherPNCP } from "@/lib/harvestPNCP";
import { sondarTodas } from "@/lib/saudeFontes";
import { coletarEditais } from "@/lib/coletores";
import { enviarDigestsDiarios } from "@/lib/digest";

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

  // 3) digest diário — usa a coleta completa (banco + fontes ao vivo)
  let digest = null;
  try {
    const { editais } = await coletarEditais();
    digest = await enviarDigestsDiarios(editais);
    if (digest.erros?.length) console.warn("[coleta] erros no digest:", digest.erros.slice(0, 5));
  } catch (err) {
    console.error("[coleta] digest falhou", err);
    digest = { ok: false, erro: err.message };
  }

  console.log("[coleta] resumo", { colheita: { ok: colheita.ok, orgaosOk: colheita.orgaosOk, editais: colheita.editais }, saude, digest: { orgs: digest?.orgs, enviados: digest?.enviados }, ms: Date.now() - t0 });
  return NextResponse.json({ colheita, saude, digest, duracaoMs: Date.now() - t0 });
}
