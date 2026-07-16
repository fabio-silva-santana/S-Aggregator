// FASE 7 — sondas de saúde das fontes de dados (health-check + validação de schema).
// Cada fonte tem uma URL leve de sondagem e um validador do formato esperado.
// A sonda tenta até 3 vezes com backoff progressivo e mede a latência.
// Espelha as fontes reais de lib/coletores.js (Django, STW, PNCP, Correios).

const TIMEOUT_MS = 15000;
const BACKOFFS = [0, 800, 2400]; // espera antes de cada tentativa

export const FONTES_SAUDE = [
  // API Django "Transparência" (DN/DF, PE, RO, AL)
  { id: "django-df", nome: "Sistema Indústria (DN/DF)", tipo: "django", url: "https://www.portaldaindustria.com.br/api/licitacoes/?status=A&current=1" },
  { id: "django-pe", nome: "SESI/SENAI-PE", tipo: "django", url: "https://licitacoes.pe.sesi.org.br:8081/api/licitacoes/?status=A&current=1" },
  { id: "django-ro", nome: "SESI/SENAI-RO (FIERO)", tipo: "django", url: "https://licitacao.fiero.org.br/api/licitacoes/?status=A&current=1" },
  { id: "django-al", nome: "SESI/SENAI-AL (FIEA)", tipo: "django", url: "https://licitacao.fiea.com.br/api/licitacoes/?status=A&current=1" },
  // Sistema Transparência Web (SP, RN, RS, BA — SESI e SENAI)
  ...["SESI-SP", "SENAI-SP", "SESI-RN", "SENAI-RN", "SESI-RS", "SENAI-RS", "SESI-BA", "SENAI-BA"].map((dep) => ({
    id: `stw-${dep.toLowerCase()}`,
    nome: `STW ${dep}`,
    tipo: "stw",
    url: `https://sistematransparenciaweb.com.br/api-licitacoes/publico/licitacoes?entidade=${dep.split("-")[0]}&departamento=${dep}&ano=${new Date().getFullYear()}&page=0&size=1`,
  })),
  // PNCP — busca usada como catch-all
  { id: "pncp", nome: "PNCP (busca pública)", tipo: "pncp", url: "https://pncp.gov.br/api/search/?q=SESI&tipos_documento=edital&pagina=1&tam_pagina=1&ordenacao=-data" },
  // Paradigma WBC — portal nacional de compras do SEST/SENAT (webservice é POST)
  {
    id: "paradigma-sest",
    nome: "SEST/SENAT (compras.sestsenat.org.br)",
    tipo: "paradigma",
    url: "https://compras.sestsenat.org.br/portal/WebService/Servicos.asmx/PesquisarProcessos",
    metodo: "POST",
    corpo: '{"dtoProcesso":{"nAnoFinalizacao":0,"tmpTipoMuralProcesso":2,"nCdModulo":0,"nCdModalidade":0,"nCdModalidadeFase":0,"nCdTipoModalidade":0,"tmpTipoMuralVisao":0,"nCdSituacao":0,"nCdTipoProcesso":0,"nCdEmpresa":0,"sNrProcesso":"","nCdProcesso":0,"sDsObjeto":"","sDtPeriodoDe":"","sDtPeriodoAte":"","sOrdenarPor":"NCDPROCESSO","sOrdenarPorDirecao":"DESC","dtoPaginacao":{"nPaginaDe":1,"nPaginaAte":1},"dtoIdioma":{"nCdIdioma":1}}}',
  },
  // Correios — portal com WAF que bloqueia IPs de nuvem (bloqueio é esperado em produção)
  { id: "correios", nome: "Correios (Portal do Fornecedor)", tipo: "correios", url: "https://editais.correios.com.br/app/consultar/licitacoes/index.php", esperadoBloqueado: true },
];

// valida o corpo devolvido conforme o tipo da fonte → null se ok, string com o problema
function validarSchema(tipo, corpo) {
  try {
    if (tipo === "django") {
      const j = JSON.parse(corpo);
      if (!Array.isArray(j.results)) return "campo 'results' ausente ou não é lista";
      const it = j.results[0];
      if (it && (it.id === undefined || it.objeto === undefined)) return "item sem campos esperados (id/objeto)";
      return null;
    }
    if (tipo === "stw") {
      const j = JSON.parse(corpo);
      if (!Array.isArray(j)) return "resposta não é uma lista";
      const it = j[0];
      if (it && it.objeto === undefined && it.titulo === undefined) return "item sem campos esperados (objeto/titulo)";
      return null;
    }
    if (tipo === "pncp") {
      const j = JSON.parse(corpo);
      if (!Array.isArray(j.items)) return "campo 'items' ausente ou não é lista";
      return null;
    }
    if (tipo === "paradigma") {
      const j = JSON.parse(corpo);
      if (!Array.isArray(j.d)) return "campo 'd' ausente ou não é lista";
      const it = j.d[0];
      if (it && it.nCdProcesso === undefined) return "item sem campo esperado (nCdProcesso)";
      return null;
    }
    if (tipo === "correios") {
      // da nuvem, o WAF devolve página de desafio/manutenção — detectamos e marcamos como bloqueado
      if (/manuten|blocked|access denied/i.test(corpo)) return "WAF bloqueou (esperado em IP de nuvem)";
      return null;
    }
    return null;
  } catch {
    return "corpo não é JSON válido";
  }
}

async function tentativa(fonte) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const r = await fetch(fonte.url, {
      signal: ctrl.signal,
      cache: "no-store",
      method: fonte.metodo || "GET",
      headers: {
        "User-Agent": "S-Aggregator/1.0 (health-check)",
        Accept: "application/json,text/html",
        ...(fonte.corpo ? { "Content-Type": "application/json; charset=utf-8" } : {}),
      },
      ...(fonte.corpo ? { body: fonte.corpo } : {}),
    });
    const latenciaMs = Date.now() - t0;
    const corpo = await r.text();
    if (!r.ok) return { status: "falha", httpStatus: r.status, latenciaMs, detalhe: `HTTP ${r.status}` };
    const problema = validarSchema(fonte.tipo, corpo);
    if (problema) {
      const bloqueado = fonte.esperadoBloqueado && /WAF/i.test(problema);
      return { status: bloqueado ? "bloqueado" : "degradado", httpStatus: r.status, latenciaMs, detalhe: problema };
    }
    return { status: "ok", httpStatus: r.status, latenciaMs, detalhe: null };
  } catch (err) {
    return { status: "falha", httpStatus: null, latenciaMs: Date.now() - t0, detalhe: err.name === "AbortError" ? `timeout ${TIMEOUT_MS}ms` : (err.message || "erro de rede") };
  } finally {
    clearTimeout(timer);
  }
}

// Sonda uma fonte com retry + backoff. Só re-tenta em "falha" (rede/HTTP);
// "degradado"/"bloqueado" são respostas do servidor e não mudam com retry.
export async function sondarFonte(fonte) {
  let ultimo = null;
  for (let i = 0; i < BACKOFFS.length; i++) {
    if (BACKOFFS[i]) await new Promise((res) => setTimeout(res, BACKOFFS[i]));
    ultimo = await tentativa(fonte);
    if (ultimo.status !== "falha") break;
  }
  return { fonte: fonte.id, nome: fonte.nome, tentativas: undefined, ...ultimo };
}

// Sonda todas as fontes em paralelo.
export async function sondarTodas() {
  return Promise.all(FONTES_SAUDE.map((f) => sondarFonte(f)));
}
