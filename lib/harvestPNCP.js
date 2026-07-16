// Colheita profunda do PNCP por CNPJ (precisa e sem ruído): a busca textual
// do PNCP é suja (qualquer documento que cite "SESI" aparece), mas buscar
// pelo CNPJ do órgão devolve exatamente os editais dele — o numero_controle
// começa com o próprio CNPJ, o que permite validar cada item.
//
// Fluxo (rodado pelo cron noturno /api/cron/coleta):
//   registro (semente lib/orgaosPNCP.js + tabela orgaos_pncp) → 1 busca por
//   CNPJ → normaliza → grava em editais_pncp → app lê do banco na hora.
// Órgãos sem UF na semente ganham a UF do primeiro edital colhido.
import { supabaseAdmin, supabaseConfigurado } from "@/lib/supabaseServer";
import { ORGAOS_PNCP_SEED } from "@/lib/orgaosPNCP";
import { normalizarItemPNCP, UFS } from "@/lib/coletores";

const CONCORRENCIA = 6;
const PAUSA_LOTE_MS = 250;
const PAGINAS_MAX = 1; // 100 mais recentes por órgão bastam (abertas + poda)
const DIAS_ENCERRADO = 120; // encerrados mais velhos que isso são descartados
const ENCERRADOS_POR_ORGAO = 10;
// orçamento de tempo: para antes do limite da função (300s) e devolve o
// restante — a colheita é retomável (processa os mais desatualizados antes)
const ORCAMENTO_MS = 220000;
const DIAS_EDITAL_ORFAO = 3; // editais não re-vistos há 3 colheitas saem do banco

async function buscarPorCNPJ(cnpj) {
  const itens = [];
  for (let pagina = 1; pagina <= PAGINAS_MAX; pagina++) {
    const url =
      `https://pncp.gov.br/api/search/?q=${cnpj}&tipos_documento=edital` +
      `&pagina=${pagina}&tam_pagina=100&ordenacao=-data`;
    let ok = false;
    for (let t = 0; t < 3 && !ok; t++) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 20000);
        const r = await fetch(url, {
          signal: ctrl.signal,
          cache: "no-store",
          headers: { "User-Agent": "Mozilla/5.0 (S-Aggregator; radar Sistema S)", Accept: "application/json" },
        });
        clearTimeout(timer);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        const pag = (data.items || []).filter((i) => (i.numero_controle_pncp || "").startsWith(cnpj));
        itens.push(...pag);
        ok = true;
        if ((data.items || []).length < 100) return itens;
      } catch (e) {
        if (t === 2) throw e;
        await new Promise((res) => setTimeout(res, 1200 * (t + 1)));
      }
    }
  }
  return itens;
}

// registro completo: semente do código + descobertas salvas no banco.
// Ordenado do mais desatualizado para o mais recente — assim uma colheita
// interrompida pelo orçamento de tempo continua de onde parou na próxima.
async function carregarRegistro(sb) {
  const mapa = new Map(ORGAOS_PNCP_SEED.map((o) => [o.cnpj, { ...o, updated_at: null }]));
  const { data } = await sb.from("orgaos_pncp").select("cnpj, nome, entidade, uf, updated_at");
  for (const o of data || []) {
    const atual = mapa.get(o.cnpj);
    if (atual) { if (!atual.uf && o.uf) atual.uf = o.uf; atual.updated_at = o.updated_at; }
    else mapa.set(o.cnpj, o);
  }
  return [...mapa.values()].sort((a, b) => ((a.updated_at || "") < (b.updated_at || "") ? -1 : 1));
}

// poda por órgão: todas as abertas/andamento + N encerradas recentes
function podarEditais(editais) {
  const limiteISO = new Date(Date.now() - DIAS_ENCERRADO * 86400000).toISOString().slice(0, 10);
  const abertos = editais.filter((e) => e.status !== "Encerrado");
  const encerrados = editais
    .filter((e) => e.status === "Encerrado" && (e.dataPublicacao || e.dataAbertura || "") >= limiteISO)
    .sort((a, b) => ((a.dataPublicacao || "") < (b.dataPublicacao || "") ? 1 : -1))
    .slice(0, ENCERRADOS_POR_ORGAO);
  return [...abertos, ...encerrados];
}

export async function colherPNCP() {
  if (!supabaseConfigurado()) return { ok: false, erro: "supabase não configurado" };
  const sb = supabaseAdmin();
  const t0 = Date.now();
  const inicio = new Date().toISOString();
  const registro = await carregarRegistro(sb);

  let totalEditais = 0;
  let orgaosOk = 0;
  let processados = 0;
  const falhas = [];
  const atualizacoesOrgao = [];

  for (let i = 0; i < registro.length; i += CONCORRENCIA) {
    if (Date.now() - t0 > ORCAMENTO_MS) break; // orçamento esgotado — retoma na próxima
    const lote = registro.slice(i, i + CONCORRENCIA);
    processados += lote.length;
    const resultados = await Promise.allSettled(lote.map((o) => buscarPorCNPJ(o.cnpj)));
    for (let k = 0; k < lote.length; k++) {
      const org = lote[k];
      const r = resultados[k];
      if (r.status === "rejected") { falhas.push(`${org.cnpj} (${org.entidade}): ${String(r.reason?.message || r.reason).slice(0, 60)}`); continue; }
      orgaosOk++;
      const normalizados = r.value.map((item) => normalizarItemPNCP(item)).filter(Boolean);
      // completa a UF do órgão a partir dos editais reais
      const ufReal = normalizados.find((e) => UFS.includes(e.uf))?.uf || org.uf || null;
      atualizacoesOrgao.push({ cnpj: org.cnpj, nome: org.nome, entidade: org.entidade, uf: ufReal, updated_at: inicio });
      const uteis = podarEditais(normalizados);
      if (uteis.length) {
        const linhas = uteis.map((e) => ({ id: e.id, uf: e.uf, entidade: e.entidade, status: e.status, data: e, updated_at: inicio }));
        const up = await sb.from("editais_pncp").upsert(linhas, { onConflict: "id" });
        if (up.error) { falhas.push(`upsert ${org.cnpj}: ${up.error.message.slice(0, 60)}`); continue; }
        totalEditais += linhas.length;
      }
    }
    await new Promise((res) => setTimeout(res, PAUSA_LOTE_MS));
  }

  // atualiza o registro de órgãos (updated_at marca o progresso da retomada)
  if (atualizacoesOrgao.length) await sb.from("orgaos_pncp").upsert(atualizacoesOrgao, { onConflict: "cnpj" });
  // remove só editais órfãos (não re-vistos há N colheitas) — seguro mesmo com colheita parcial
  await sb.from("editais_pncp").delete().lt("updated_at", new Date(Date.now() - DIAS_EDITAL_ORFAO * 86400000).toISOString());

  return {
    ok: falhas.length === 0,
    orgaos: registro.length,
    processados,
    restantes: registro.length - processados,
    orgaosOk,
    editais: totalEditais,
    falhas: falhas.slice(0, 12),
    coletadoEm: inicio,
  };
}

// leitura instantânea usada pelo /api/editais
export async function lerEditaisPNCPBanco() {
  if (!supabaseConfigurado()) return null;
  try {
    const sb = supabaseAdmin();
    const linhas = [];
    const LOTE = 1000;
    for (let de = 0; ; de += LOTE) {
      const { data, error } = await sb.from("editais_pncp").select("data, updated_at").range(de, de + LOTE - 1);
      if (error) return null; // tabela ausente → chamador cai no modo ao vivo
      linhas.push(...(data || []));
      if (!data || data.length < LOTE) break;
    }
    if (!linhas.length) return null;
    return { editais: linhas.map((l) => l.data), coletadoEm: linhas[0]?.updated_at || null };
  } catch {
    return null;
  }
}
