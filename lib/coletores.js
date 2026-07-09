// ============================================================
// S-Aggregator — Coletores de dados reais
//
// Fontes oficiais:
//  1. API Django "Transparência" (portais das federações da indústria):
//     DN/DF (portaldaindustria), PE, RO, AL — abertos E encerrados
//     (encerrados trazem participantes, vencedor e valor contratado)
//  2. API Sistema Transparência Web (sistematransparenciaweb.com.br):
//     SP, RN, RS, BA — SESI e SENAI (lotes com participantes e
//     valor homologado)
//  3. PNCP (pncp.gov.br) — SESI/SENAI em UFs sem coletor dedicado
//     + SESC, SENAC, SENAR e SEBRAE em todas as UFs do escopo
//
// RJ (Firjan) usa plataforma proprietária sem API pública —
// SESI/SENAI-RJ exibido como "em integração"; SENAC/SEBRAE-RJ já
// chegam via PNCP.
// ============================================================

import { unstable_cache } from "next/cache";

// Cobertura nacional — todas as UFs da federação
export const UFS = [
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT",
  "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
];

export const ENTIDADES = ["SESI", "SENAI", "SESC", "SENAC", "SENAR", "SEBRAE", "SEST/SENAT", "SESCOOP", "Correios", "Sistema Indústria"];

export const SEGMENTOS = [
  "TI e Tecnologia",
  "Saúde e Segurança do Trabalho",
  "Educação e Treinamento",
  "Engenharia e Obras",
  "Facilities e Conservação",
  "Alimentação",
  "Equipamentos e Mobiliário",
  "Marketing e Eventos",
  "Outros",
];

export const MODALIDADES = [
  "Pregão",
  "Seleção com Disputa (RCA)",
  "Licitação Correios (RLCC)",
  "Concorrência",
  "Credenciamento",
  "Convite",
  "Dispensa / Inexigibilidade",
  "Leilão",
  "Outras",
];

const REVALIDATE = 1800; // 30 min de cache por fonte

// ---------- utilidades ----------

// fetch com timeout individual — impede que uma fonte lenta trave a coleta
async function fetchComTimeout(url, opts = {}, ms = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJSON(url, tentativas = 2) {
  let ultimoErro;
  for (let t = 0; t < tentativas; t++) {
    try {
      const r = await fetchComTimeout(url, {
        headers: { "User-Agent": "S-Aggregator/1.0 (radar de licitacoes)", Accept: "application/json" },
        next: { revalidate: REVALIDATE },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}`);
      return await r.json();
    } catch (e) {
      ultimoErro = e;
      if (t < tentativas - 1) await new Promise((res) => setTimeout(res, 1000));
    }
  }
  throw ultimoErro;
}

function classificarSegmento(texto) {
  const t = (texto || "").toLowerCase();
  const regras = [
    ["Saúde e Segurança do Trabalho", ["saúde", "saude", "médic", "medic", "odont", "enferm", "audiô", "audio", "ocupacional", "telessa", "clínic", "clinic", "psicol", "ambulat", "exame", "vacina", "hospital", "farmác", "farmac", "epi ", "fisioter"]],
    ["TI e Tecnologia", ["software", "sistema de informa", "notebook", "computador", "microcomput", "licenç", "licenc", "nuvem", "cloud", "rede lógica", "wi-fi", "wifi", "telefonia", "impressor", "smartphone", "datacenter", "informátic", "informatic", "tecnologia da informa", "servidor", "firewall", "saas", "desenvolvimento de sistema", "link de internet", "outsourcing de impress", "workstation"]],
    ["Educação e Treinamento", ["educa", "curso", "didátic", "didatic", "docent", "ensino", "capacita", "treinament", "escolar", "pedagóg", "pedagog", "aprendizagem", "biblioteca", " ead", "instrutor", "professor", "bolsa de estudo", "consultoria"]],
    ["Engenharia e Obras", ["obra", "reforma", "engenharia", "constru", "manutenção predial", "manutencao predial", "elétric", "eletric", "hidráulic", "hidraulic", "climatiza", "ar condicionado", "elevador", "projeto executivo", "pintura", "telhado", "subesta", "impermeabiliza", "civil", "arquitet"]],
    ["Facilities e Conservação", ["limpeza", "conserva", "vigilân", "vigilan", "portaria", "recepc", "jardin", "patrimonial", "dedetiza", "resíduo", "residuo", "coleta", "pest", "praga", "zeladoria", "copeirag", "lavander"]],
    ["Alimentação", ["aliment", "refei", "coffee", "lanche", "restaurante", "gênero", "genero", "cozinha", "merenda", "buffet", "catering", "bebida", "café", "cafe"]],
    ["Equipamentos e Mobiliário", ["máquina", "maquina", "equipament", "solda", "torno", "cnc", "bancada", "ferrament", "empilhadeira", "laborató", "laborato", "mobiliário", "mobiliario", "móveis", "moveis", "cadeira", "veículo", "veiculo", "caminhão", "caminhao", "uniforme", "material de consumo", "utensílio", "utensilio", "poltrona"]],
    ["Marketing e Eventos", ["evento", "gráfic", "grafic", "comunica", "publicid", "marketing", "feira", "formatura", "impress", "brinde", "audiovisual", "cerimonial", "sinaliza", "mídia", "midia", "fotograf"]],
  ];
  for (const [seg, chaves] of regras) {
    if (chaves.some((k) => t.includes(k))) return seg;
  }
  return "Outros";
}

function normalizarModalidade(m) {
  const t = (m || "").toLowerCase();
  if (t.includes("pregão") || t.includes("pregao")) return "Pregão";
  if (t.includes("credenc") || t.includes("ponto de coleta")) return "Credenciamento";
  if (t.includes("concorr")) return "Concorrência";
  if (t.includes("convite")) return "Convite";
  if (t.includes("dispensa") || t.includes("inexig") || t.startsWith("dl")) return "Dispensa / Inexigibilidade";
  if (t.includes("leilão") || t.includes("leilao")) return "Leilão";
  if (t.includes("chamamento") || t.includes("consulta pública") || t.includes("consulta publica")) return "Credenciamento";
  if (t.includes("lic. correios") || t.includes("licitação correios") || t.includes("contr. ") || t.includes("cpsi")) return "Licitação Correios (RLCC)";
  if (t.includes("disputa") || t.includes("seleção") || t.includes("selecao") || t.includes("scd") || t.includes("rca") || t.includes("processo de sele")) return "Seleção com Disputa (RCA)";
  return "Outras";
}

function normalizarStatus(statusOriginal, dataAberturaISO) {
  const t = (statusOriginal || "").toLowerCase();
  if (/encerr|homolog|conclu|cancel|fracass|desert|revog|adjudic|suspens/.test(t)) return "Encerrado";
  if (dataAberturaISO && dataAberturaISO >= hojeISO()) return "Aberto";
  if (/aberto|andamento|publica|julgamento|recebendo|divulga|execução|execucao/.test(t)) return "Em andamento";
  return dataAberturaISO ? "Encerrado" : "Em andamento";
}

// Fase divulgada do processo (para exibição de andamento)
function inferirFase(statusOriginal, status) {
  const t = (statusOriginal || "").toLowerCase();
  if (/homolog|adjudic|conclu|encerr/.test(t)) return "Homologação / Encerramento";
  if (/julgament|proposta|classifica|habilita/.test(t)) return "Julgamento das propostas";
  if (/abert|recebendo|divulga|publica/.test(t)) return "Publicação / Recebimento de propostas";
  if (/cancel|fracass|desert|revog|suspens/.test(t)) return "Processo interrompido";
  return status === "Aberto" ? "Publicação / Recebimento de propostas" : "Em execução";
}

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

function brDateToISO(s) {
  const t = (s || "").trim();
  // aceita ISO ("2026-06-30...") vinda de algumas fontes
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(t);
  let ano, mes, dia;
  if (iso) [, ano, mes, dia] = iso;
  else if (br) [, dia, mes, ano] = br;
  else return null;
  // os portais usam placeholders inválidos (ex.: "30/11/0002") — descarta
  const a = parseInt(ano, 10);
  if (a < 2000 || a > 2100) return null;
  return `${ano}-${mes}-${dia}`;
}

export function detectarEntidade(nomes) {
  const t = (Array.isArray(nomes) ? nomes.join(" ") : String(nomes || "")).toUpperCase();
  if (t.includes("CORREIOS") || t.includes("TELEGRAFOS") || t.includes("TELÉGRAFOS")) return "Correios";
  // SESCOOP contém "SESC" — testar antes
  if (t.includes("SESCOOP") || t.includes("COOPERATIVISMO")) return "SESCOOP";
  if (t.includes("SEST") || t.includes("SENAT") || t.includes("SOCIAL DO TRANSPORTE") || t.includes("APRENDIZAGEM DO TRANSPORTE")) return "SEST/SENAT";
  if (t.includes("SEBRAE") || t.includes("APOIO AS MICRO") || t.includes("APOIO ÀS MICRO")) return "SEBRAE";
  if (t.includes("SENAC") || t.includes("APRENDIZAGEM COMERCIAL")) return "SENAC";
  if (t.includes("SESC") || t.includes("SOCIAL DO COMERCIO") || t.includes("SOCIAL DO COMÉRCIO")) return "SESC";
  if (t.includes("SENAR") || t.includes("APRENDIZAGEM RURAL")) return "SENAR";
  const sesi = t.includes("SESI") || t.includes("SOCIAL DA INDUSTRIA") || t.includes("SOCIAL DA INDÚSTRIA");
  const senai = t.includes("SENAI") || t.includes("APRENDIZAGEM INDUSTRIAL");
  if (sesi && senai) return "SESI e SENAI";
  if (sesi) return "SESI";
  if (senai) return "SENAI";
  if (t.includes("SISTEMA IND")) return "Sistema Indústria";
  return null;
}

// extrai resultado (vencedor/participantes) do formato Django
function extrairResultadoDjango(item) {
  const participantes = [];
  const vencedores = [];
  let valorContratado = null;

  const listaPart = item.participantes?.Item || [];
  for (const p of listaPart) {
    participantes.push({
      nome: p.nome || "—",
      cnpj: p.cpf_cnpj || null,
      valorProposta: typeof p.valor_proposta === "number" ? p.valor_proposta : null,
      vencedor: false,
    });
  }
  const listaVenc = item.propostas_vencedora?.Item || [];
  for (const v of listaVenc) {
    vencedores.push({ nome: v.nome || "—", cnpj: v.cpf_cnpj || null, valor: v.valor_vencedora ?? v.valor_proposta ?? null });
    if (typeof (v.valor_vencedora ?? v.valor_proposta) === "number") {
      valorContratado = (valorContratado || 0) + (v.valor_vencedora ?? v.valor_proposta);
    }
    const p = participantes.find((x) => x.cnpj && x.cnpj === v.cpf_cnpj);
    if (p) p.vencedor = true;
    else participantes.push({ nome: v.nome, cnpj: v.cpf_cnpj, valorProposta: v.valor_proposta ?? null, vencedor: true });
  }
  return {
    participantes,
    vencedores,
    valorContratado,
    dataHomologacao: brDateToISO(item.homologacao) || null,
  };
}

// ---------- Fonte 1: API Django "Transparência" ----------

const FONTES_DJANGO = [
  {
    host: "https://www.portaldaindustria.com.br",
    uf: "DF",
    regional: "Sistema Indústria (DN)",
    cidade: "Brasília",
    portal: "https://www.portaldaindustria.com.br/licitacoes/",
    entidadePadrao: "Sistema Indústria",
  },
  {
    host: "https://licitacoes.pe.sesi.org.br:8081",
    uf: "PE",
    regional: "SESI/SENAI-PE",
    cidade: "Recife",
    portal: "https://transparencia.pe.sesi.org.br/licitacoes-e-editais/",
    entidadePadrao: "SESI",
  },
  {
    host: "https://licitacao.fiero.org.br",
    uf: "RO",
    regional: "SESI/SENAI-RO (FIERO)",
    cidade: "Porto Velho",
    portal: "https://licitacao.fiero.org.br/",
    entidadePadrao: "SESI",
  },
  {
    host: "https://licitacao.fiea.com.br",
    uf: "AL",
    regional: "SESI/SENAI-AL (FIEA)",
    cidade: "Maceió",
    portal: "https://licitacao.fiea.com.br/",
    entidadePadrao: "SESI",
  },
];

function mapearDjango(item, fonte) {
  const nomesEmpresas = (item.empresas || []).map((e) => e.nome);
  const entidade = detectarEntidade(nomesEmpresas) || fonte.entidadePadrao;
  const dataAbertura = item.data_abertura || null;
  const objeto = item.objeto || item.titulo || "";
  const documentos = (item.documentos || [])
    .filter((d) => d.arquivo)
    .map((d) => ({
      descricao: `${d.tipo ? d.tipo + " — " : ""}${d.descricao || "documento"}`,
      url: d.arquivo.startsWith("http") ? d.arquivo : `${fonte.host}${d.arquivo}`,
    }));
  const status = normalizarStatus(item.status, dataAbertura);
  const resultado = extrairResultadoDjango(item);

  return {
    id: `dj-${fonte.uf}-${item.id}`,
    numero: item.titulo?.length <= 60 ? item.titulo : `${item.numero}/${item.ano}`,
    entidade,
    uf: fonte.uf,
    regional: fonte.regional,
    cidade: fonte.cidade,
    modalidade: normalizarModalidade(item.modalidade),
    modalidadeOriginal: item.modalidade || null,
    segmento: classificarSegmento(`${item.titulo} ${objeto}`),
    objeto: objeto.slice(0, 1200),
    titulo: item.titulo || null,
    valorEstimado: resultado.valorContratado,
    valorContratado: resultado.valorContratado,
    dataPublicacao: null,
    dataAbertura,
    dataHomologacao: resultado.dataHomologacao,
    status,
    statusOriginal: item.status || null,
    fase: inferirFase(item.status, status),
    criterioJulgamento: item.criterios_julgamento || null,
    participantes: resultado.participantes,
    vencedores: resultado.vencedores,
    lotes: [],
    documentos,
    portal: fonte.portal,
    fonte: `Portal de transparência — ${fonte.regional}`,
  };
}

async function coletarDjango(fonte) {
  const editais = [];
  for (const statusParam of ["A", "E"]) {
    let url = `${fonte.host}/api/licitacoes/?status=${statusParam}&current=1`;
    for (let pagina = 0; pagina < 3 && url; pagina++) {
      const data = await fetchJSON(url);
      for (const item of data.results || []) editais.push(mapearDjango(item, fonte));
      url = data.next || null;
    }
  }
  return editais;
}

// ---------- Fonte 2: Sistema Transparência Web ----------

const FONTES_STW = [
  { dep: "SESI-SP", uf: "SP", cidade: "São Paulo", portal: "https://transparencia.sesisp.org.br/licitacoes/licitacoes-editais" },
  { dep: "SENAI-SP", uf: "SP", cidade: "São Paulo", portal: "https://transparencia.sp.senai.br/licitacoes/licitacoes-editais" },
  { dep: "SESI-RN", uf: "RN", cidade: "Natal", portal: null },
  { dep: "SENAI-RN", uf: "RN", cidade: "Natal", portal: null },
  { dep: "SESI-RS", uf: "RS", cidade: "Porto Alegre", portal: null },
  { dep: "SENAI-RS", uf: "RS", cidade: "Porto Alegre", portal: null },
  { dep: "SESI-BA", uf: "BA", cidade: "Salvador", portal: null },
  { dep: "SENAI-BA", uf: "BA", cidade: "Salvador", portal: null },
];

async function coletarSTW(fonte) {
  const entidade = fonte.dep.split("-")[0];
  const ano = new Date().getFullYear();
  const url =
    `https://sistematransparenciaweb.com.br/api-licitacoes/publico/licitacoes` +
    `?entidade=${entidade}&departamento=${fonte.dep}&ano=${ano}&page=0&size=500`;
  const data = await fetchJSON(url);
  if (!Array.isArray(data)) return [];

  const limiteISO = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);
  const editais = [];
  for (const item of data) {
    const dataAbertura = brDateToISO(item.dataAbertura);
    const status = normalizarStatus(item.statusLicitacao, dataAbertura);
    if (status === "Encerrado" && (!dataAbertura || dataAbertura < limiteISO)) continue;

    const objeto = item.objeto || item.titulo || "";
    let valorHomologado = null;
    const lotes = [];
    const participantesGlobais = [];
    for (const lote of item.itensLotes || []) {
      const vLote = parseFloat(lote.valorPropostaVencedora);
      const participantes = (lote.participantes || []).map((p) => ({
        nome: p.participante || "—",
        cnpj: p.cnpjCpf || null,
        valorProposta: typeof p.valorProposta === "number" ? p.valorProposta : null,
        vencedor: lote.participantes.length === 1 && !isNaN(vLote) && vLote > 0,
      }));
      participantesGlobais.push(...participantes);
      lotes.push({
        lote: lote.tipo || "Lote",
        valorHomologado: !isNaN(vLote) && vLote > 0 ? vLote : null,
        participantes,
      });
      if (!isNaN(vLote) && vLote > 0) valorHomologado = (valorHomologado || 0) + vLote;
    }

    editais.push({
      id: `stw-${fonte.dep}-${item.codigoLicitacao}`,
      numero: item.numero || item.titulo || String(item.codigoLicitacao),
      entidade,
      uf: fonte.uf,
      regional: item.entidadeRegional || fonte.dep,
      cidade: fonte.cidade,
      modalidade: normalizarModalidade(item.modalidade),
      modalidadeOriginal: item.modalidade || null,
      segmento: classificarSegmento(`${item.titulo} ${objeto}`),
      objeto: objeto.slice(0, 1200),
      titulo: item.titulo && item.titulo !== item.numero ? item.titulo : null,
      valorEstimado: valorHomologado,
      valorContratado: status === "Encerrado" ? valorHomologado : null,
      // dataPublicacao da STW é placeholder ("01/01/<ano>" em 100% dos
      // registros) — não é a data real de publicação; descartada.
      dataPublicacao: null,
      dataAbertura,
      dataHomologacao: brDateToISO(item.dtHomologacao),
      status,
      statusOriginal: item.statusLicitacao || null,
      fase: inferirFase(item.statusLicitacao, status),
      criterioJulgamento: item.critJulgamento || null,
      participantes: participantesGlobais,
      vencedores: [],
      lotes,
      documentos: [],
      portal: fonte.portal,
      fonte: `Sistema Transparência Web — ${fonte.dep}`,
    });
  }
  editais.sort((a, b) => ((a.dataAbertura || "") < (b.dataAbertura || "") ? 1 : -1));
  return editais.slice(0, 120);
}

// ---------- Fonte 3: PNCP ----------

const UFS_COM_COLETOR_DEDICADO_INDUSTRIA = new Set(["DF", "PE", "RO", "AL", "SP", "RN", "RS", "BA"]);
const ENTIDADES_INDUSTRIA = new Set(["SESI", "SENAI", "SESI e SENAI", "Sistema Indústria"]);

async function coletarPNCP(termo) {
  const editais = [];
  for (let pagina = 1; pagina <= 2; pagina++) {
    const url =
      `https://pncp.gov.br/api/search/?q=${encodeURIComponent(termo)}` +
      `&tipos_documento=edital&pagina=${pagina}&tam_pagina=100&ordenacao=-data`;
    let data;
    try {
      data = await fetchJSON(url, 3);
    } catch (e) {
      if (pagina === 1) throw e; // 1ª página é obrigatória; 2ª é bônus
      break;
    }
    editais.push(...mapearPNCP(data.items || [], termo));
    if ((data.items || []).length < 100) break;
  }
  return editais;
}

function mapearPNCP(items, termo) {
  const editais = [];
  for (const item of items) {
    const entidade = detectarEntidade(item.orgao_nome);
    if (!entidade) continue;
    if (!UFS.includes(item.uf)) continue;
    // SESI/SENAI já têm coletor dedicado nessas UFs — evita duplicidade
    if (ENTIDADES_INDUSTRIA.has(entidade) && UFS_COM_COLETOR_DEDICADO_INDUSTRIA.has(item.uf)) continue;
    // mantém apenas a entidade pesquisada (a busca do PNCP é textual)
    const termoOk =
      entidade.includes(termo) ||
      (termo === "SEST" && entidade === "SEST/SENAT") ||
      termo === "SESI" || termo === "SENAI";
    if (!termoOk) continue;

    const dataAbertura = (item.data_fim_vigencia || "").slice(0, 10) || null;
    const situacao = (item.situacao_nome || "").toLowerCase();
    const recebendo = dataAbertura && dataAbertura >= hojeISO();
    const status = /anulad|revogad|suspens/.test(situacao) ? "Encerrado" : recebendo ? "Aberto" : "Em andamento";

    editais.push({
      id: `pncp-${item.numero_controle_pncp}`,
      numero: item.numero_controle_pncp,
      entidade,
      uf: item.uf,
      regional: `${entidade}-${item.uf}`,
      cidade: item.municipio_nome || null,
      modalidade: normalizarModalidade(item.modalidade_licitacao_nome),
      modalidadeOriginal: item.modalidade_licitacao_nome || null,
      segmento: classificarSegmento(`${item.title} ${item.description}`),
      objeto: (item.description || item.title || "").slice(0, 1200),
      titulo: item.title || null,
      valorEstimado: null,
      valorContratado: null,
      dataPublicacao: (item.data_publicacao_pncp || "").slice(0, 10) || null,
      dataAbertura,
      dataHomologacao: null,
      status,
      statusOriginal: item.situacao_nome || null,
      fase: recebendo ? "Publicação / Recebimento de propostas" : "Em execução",
      criterioJulgamento: null,
      participantes: [],
      vencedores: [],
      lotes: [],
      documentos: [],
      portal: item.item_url ? `https://pncp.gov.br${item.item_url}` : null,
      fonte: "PNCP — Portal Nacional de Contratações Públicas",
    });
  }
  return editais;
}

// ---------- Fonte 4: Correios (Portal do Fornecedor / RLCC) ----------
//
// O portal editais.correios.com.br exige sessão PHP e devolve a grade em
// HTML. Fluxo: abre index.php (cookies) → listarProcessos.php via GET com
// os campos do formulário (valores VAZIOS, não "0") → parse dos rótulos.

const CORREIOS_BASE = "https://editais.correios.com.br/app/consultar/licitacoes";
// situação do portal → status normalizado (abertos primeiro; homologadas p/ histórico)
const CORREIOS_SITUACOES = [
  { codigo: "8", rotulo: "Publicada - A ser Aberta", paginas: 4 },
  { codigo: "2", rotulo: "Em Andamento", paginas: 3 },
  { codigo: "9", rotulo: "Homologada", paginas: 2 },
];

function extrairCampo(bloco, rotulo) {
  const rx = new RegExp(`${rotulo}:?\\s*</td>\\s*<td[^>]*>(?:\\s*<b>)?\\s*([^<]{1,600})`, "i");
  const m = rx.exec(bloco);
  return m ? m[1].trim() : null;
}

function parsearPaginaCorreios(html, sit) {
  const editais = [];
  const blocos = html.split(/detalharProcesso\('(\d+)'\)/).slice(1);
  for (let i = 0; i + 1 < blocos.length; i += 2) {
    const idProcesso = blocos[i];
    const bloco = blocos[i + 1];
    const objeto = extrairCampo(bloco, "Objeto");
    if (!objeto) continue;
    const numero = extrairCampo(bloco, "Número Edital") || `Processo ${idProcesso}`;
    const uf = (extrairCampo(bloco, "UF") || "").slice(0, 2).toUpperCase();
    const dependencia = extrairCampo(bloco, "Dependência");
    const modalidadeOrig = extrairCampo(bloco, "Modalidade");
    const dataPublicacao = brDateToISO(extrairCampo(bloco, "Data Publicação"));
    const dataAbertura = brDateToISO(extrairCampo(bloco, "Data Abertura"));
    if (!UFS.includes(uf)) continue;

    const status = sit.codigo === "9" ? "Encerrado" : normalizarStatus(sit.rotulo, dataAbertura);
    editais.push({
      id: `cor-${idProcesso}`,
      numero,
      entidade: "Correios",
      uf,
      regional: `Correios — ${dependencia || uf}`,
      cidade: null,
      modalidade: normalizarModalidade(modalidadeOrig),
      modalidadeOriginal: modalidadeOrig || null,
      segmento: classificarSegmento(objeto),
      objeto: objeto.slice(0, 1200),
      titulo: null,
      valorEstimado: null,
      valorContratado: null,
      dataPublicacao,
      dataAbertura,
      dataHomologacao: sit.codigo === "9" ? dataAbertura : null,
      status,
      statusOriginal: sit.rotulo,
      fase: inferirFase(sit.rotulo, status),
      criterioJulgamento: null,
      participantes: [],
      vencedores: [],
      lotes: [],
      documentos: [],
      portal: `${CORREIOS_BASE}/index.php`,
      fonte: "Portal do Fornecedor dos Correios (RLCC)",
    });
  }
  return editais;
}

// scrape com sessão não passa pelo Data Cache do fetch — cacheia a função
const coletarCorreios = unstable_cache(coletarCorreiosSemCache, ["correios-v2"], { revalidate: REVALIDATE });

const CORREIOS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const CORREIOS_HEADERS_BASE = {
  "User-Agent": CORREIOS_UA,
  "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
  Referer: `${CORREIOS_BASE}/index.php`,
};

async function coletarCorreiosSemCache() {
  const inicio = await fetchComTimeout(
    `${CORREIOS_BASE}/index.php`,
    {
      headers: { ...CORREIOS_HEADERS_BASE, Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
      cache: "no-store",
    },
    18000
  );
  const cookies = (inicio.headers.getSetCookie?.() || [])
    .map((c) => c.split(";")[0])
    .join("; ");

  // todas as páginas de todas as situações em paralelo — cada falha isolada
  const requisicoes = [];
  for (const sit of CORREIOS_SITUACOES) {
    for (let pagina = 1; pagina <= sit.paginas; pagina++) {
      const params = new URLSearchParams({
        situacao: sit.codigo, modalidade: "", dependencia: "", ordenacao: "1",
        periodo: "", nEdital: "", dataInicial: "", dataFinal: "",
        idProcesso: "", paginaAtual: String(pagina), paginaFavoritos: "N", parDefault: "S",
      });
      requisicoes.push(
        fetchComTimeout(`${CORREIOS_BASE}/listarProcessos.php?${params}`, {
          headers: { ...CORREIOS_HEADERS_BASE, "X-Requested-With": "XMLHttpRequest", Cookie: cookies },
          cache: "no-store",
        }, 18000)
          .then((r) => r.text())
          .then((html) => parsearPaginaCorreios(html, sit))
          .catch(() => [])
      );
    }
  }
  const partes = await Promise.all(requisicoes);
  const vistos = new Set();
  const editais = [];
  for (const e of partes.flat()) {
    if (vistos.has(e.id)) continue;
    vistos.add(e.id);
    editais.push(e);
  }
  // portal protegido por WAF (F5 ASM) que bloqueia IPs de datacenter —
  // sinaliza para a UI exibir o status com link, em vez de "0 itens"
  if (editais.length === 0) {
    const err = new Error("Portal do Fornecedor protegido por WAF anti-bot — indisponível para coleta a partir de servidores em nuvem");
    err.correiosBloqueado = true;
    throw err;
  }
  return editais;
}

// diagnóstico do scraper (usado pela rota /api/documentos?diag=correios)
export async function diagnosticoCorreios() {
  try {
    const inicio = await fetchComTimeout(
      `${CORREIOS_BASE}/index.php`,
      { headers: { ...CORREIOS_HEADERS_BASE, Accept: "text/html" }, cache: "no-store" },
      18000
    );
    const cookies = (inicio.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]);
    const params = new URLSearchParams({
      situacao: "8", modalidade: "", dependencia: "", ordenacao: "1", periodo: "",
      nEdital: "", dataInicial: "", dataFinal: "", idProcesso: "", paginaAtual: "1",
      paginaFavoritos: "N", parDefault: "S",
    });
    const r = await fetchComTimeout(`${CORREIOS_BASE}/listarProcessos.php?${params}`, {
      headers: { ...CORREIOS_HEADERS_BASE, "X-Requested-With": "XMLHttpRequest", Cookie: cookies.join("; ") },
      cache: "no-store",
    }, 18000);
    const html = await r.text();
    return {
      index_status: inicio.status,
      cookies: cookies.map((c) => c.split("=")[0]),
      lista_status: r.status,
      lista_bytes: html.length,
      total: (html.match(/Total de Registros:\s*(\d+)/) || [])[1] || null,
      processos: (html.match(/detalharProcesso/g) || []).length,
      trecho: html.slice(0, 300).replace(/\s+/g, " "),
    };
  } catch (e) {
    return { erro: String(e?.message || e) };
  }
}

// ---------- agregador ----------

export async function coletarEditais() {
  const tarefas = [
    ...FONTES_DJANGO.map((f) => ({ nome: f.regional, promessa: coletarDjango(f) })),
    ...FONTES_STW.map((f) => ({ nome: f.dep, promessa: coletarSTW(f) })),
    ...["SESI", "SENAI", "SESC", "SENAC", "SENAR", "SEBRAE", "SEST", "SESCOOP"].map((t) => ({
      nome: `PNCP (${t})`,
      promessa: coletarPNCP(t),
    })),
    { nome: "Correios (Portal do Fornecedor)", promessa: coletarCorreios() },
  ];

  const resultados = await Promise.allSettled(tarefas.map((t) => t.promessa));

  const editais = [];
  const fontes = [];
  const vistos = new Set();
  resultados.forEach((r, i) => {
    if (r.status === "fulfilled") {
      for (const e of r.value) {
        if (vistos.has(e.id)) continue;
        vistos.add(e.id);
        editais.push(e);
      }
      fontes.push({ nome: tarefas[i].nome, ok: true, itens: r.value.length });
    } else if (r.reason?.correiosBloqueado) {
      fontes.push({
        nome: tarefas[i].nome,
        ok: false,
        erro: "Portal do Fornecedor bloqueia acesso automatizado (WAF) — os editais podem ser consultados diretamente no site oficial. Regulamento e análise por IA disponíveis.",
        link: `${CORREIOS_BASE}/index.php`,
      });
    } else {
      fontes.push({ nome: tarefas[i].nome, ok: false, erro: String(r.reason?.message || r.reason).slice(0, 120) });
    }
  });

  fontes.push({
    nome: "SESI/SENAI-RJ (Firjan)",
    ok: false,
    erro: "Portal proprietário sem API pública — integração em desenvolvimento",
    link: "https://www.firjan.com.br/senai-transparencia/transparencia/licitacoes-processos-de-selecao/",
  });

  const peso = { Aberto: 0, "Em andamento": 1, Encerrado: 2 };
  editais.sort((a, b) => {
    if (peso[a.status] !== peso[b.status]) return peso[a.status] - peso[b.status];
    if (a.status === "Aberto") return (a.dataAbertura || "9999") < (b.dataAbertura || "9999") ? -1 : 1;
    return (a.dataAbertura || "") < (b.dataAbertura || "") ? 1 : -1;
  });

  return { editais, fontes, coletadoEm: new Date().toISOString() };
}

export function filtrarEditais(editais, { entidade, uf, modalidade, segmento, status, busca }) {
  return editais.filter((e) => {
    if (entidade && entidade !== "Todas" && !e.entidade.includes(entidade)) return false;
    if (uf && uf !== "Todos" && e.uf !== uf) return false;
    if (modalidade && modalidade !== "Todas" && e.modalidade !== modalidade) return false;
    if (segmento && segmento !== "Todos" && e.segmento !== segmento) return false;
    if (status && status !== "Todos" && e.status !== status) return false;
    if (busca) {
      const q = busca.toLowerCase();
      const alvo = `${e.numero} ${e.titulo || ""} ${e.objeto} ${e.regional} ${e.cidade || ""} ${e.segmento} ${e.entidade}`.toLowerCase();
      if (!alvo.includes(q)) return false;
    }
    return true;
  });
}

// Anexos sob demanda: PNCP expõe os arquivos em API própria; fontes
// Django já trazem os documentos no payload da listagem.
export async function resolverDocumentos(edital) {
  if (edital.documentos?.length) return edital.documentos;
  if (!edital.id.startsWith("pncp-")) return [];
  const m = /^(\d{14})-\d+-(\d+)\/(\d{4})$/.exec(edital.numero);
  if (!m) return [];
  const [, cnpj, seq, ano] = m;
  try {
    const arquivos = await fetchJSON(
      `https://pncp.gov.br/api/pncp/v1/orgaos/${cnpj}/compras/${ano}/${parseInt(seq, 10)}/arquivos`
    );
    return (arquivos || [])
      .filter((a) => a.statusAtivo !== false && (a.url || a.uri))
      .map((a) => ({
        descricao: `${a.tipoDocumentoNome ? a.tipoDocumentoNome + " — " : ""}${a.titulo || "documento"}`,
        url: a.url || a.uri,
      }));
  } catch {
    return [];
  }
}

export function montarTextoEdital(e) {
  const linhas = [
    `EDITAL ${e.numero} — ${e.regional} (${e.uf})`,
    e.titulo ? `Título: ${e.titulo}` : null,
    `Objeto: ${e.objeto}`,
    `Modalidade: ${e.modalidadeOriginal || e.modalidade} (regida pelo regulamento próprio de licitações e contratos da entidade do Sistema S)`,
    e.criterioJulgamento ? `Critério de julgamento: ${e.criterioJulgamento}` : null,
    `Situação atual: ${e.statusOriginal || e.status} — fase: ${e.fase}`,
    e.dataPublicacao ? `Data de publicação: ${e.dataPublicacao}` : null,
    e.dataAbertura ? `Data de abertura/prazo: ${e.dataAbertura}` : null,
    e.dataHomologacao ? `Data de homologação: ${e.dataHomologacao}` : null,
    e.valorContratado
      ? `Valor contratado/homologado: R$ ${e.valorContratado.toLocaleString("pt-BR")}`
      : e.valorEstimado
        ? `Valor de referência: R$ ${e.valorEstimado.toLocaleString("pt-BR")}`
        : "Valor estimado: não divulgado publicamente",
    e.vencedores?.length
      ? `Vencedor(es): ${e.vencedores.map((v) => `${v.nome}${v.valor ? ` (R$ ${v.valor.toLocaleString("pt-BR")})` : ""}`).join("; ")}`
      : null,
    e.participantes?.length
      ? `Participantes conhecidos: ${e.participantes.slice(0, 8).map((p) => p.nome).join("; ")}`
      : null,
    e.documentos?.length
      ? `Documentos do processo: ${e.documentos.map((d) => d.descricao).join("; ")}`
      : null,
    `Fonte oficial: ${e.fonte}${e.portal ? ` — ${e.portal}` : ""}`,
  ];
  return linhas.filter(Boolean).join("\n");
}
