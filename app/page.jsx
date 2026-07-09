"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { formatarCNPJ, limparCNPJ } from "@/lib/empresa";
import { salvarDoc, removerDoc, baixarDoc } from "@/lib/docStore";
import { MAPA_UF, MAPA_W, MAPA_H } from "@/lib/mapaBrasil";

const FILTRO_INICIAL = { entidade: "Todas", uf: "Todos", modalidade: "Todas", segmento: "Todos", status: "Todos", busca: "" };
const FASES = ["Publicação / Recebimento de propostas", "Julgamento das propostas", "Homologação / Encerramento"];
const EMPRESA_VAZIA = {
  cnpjInput: "",
  dados: null,
  certidoes: [],
  questionario: { segmentosAtuacao: "", estadosAtendidos: "", atendeRemoto: false, faturamentoAnual: "", numeroFuncionarios: "", possuiCapacidadeTecnica: false, participouLicitacoesS: false, certidoesEmDia: false, observacoes: "" },
  interesses: { entidades: [], ufs: [], segmentos: [] },
  atestados: [],
  documentos: [],
  textoLivre: "",
};
const STATUS_CERTIDAO = ["Não informada", "Regular", "Positiva com efeito negativo", "Pendente / vencida"];

const ENTIDADES_INTERESSE = ["SESI", "SENAI", "SESC", "SENAC", "SENAR", "SEBRAE", "SEST/SENAT", "SESCOOP", "Correios"];
const UFS_INTERESSE = ["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"];
const SEGMENTOS_INTERESSE = ["TI e Tecnologia", "Saúde e Segurança do Trabalho", "Educação e Treinamento", "Engenharia e Obras", "Facilities e Conservação", "Alimentação", "Equipamentos e Mobiliário", "Marketing e Eventos", "Outros"];

// Fases do painel de acompanhamento (Kanban)
const FASES_PIPELINE = [
  { id: "analise", nome: "Análise do Edital", icone: "bolt" },
  { id: "documentos", nome: "Preparação de Documentos", icone: "doc" },
  { id: "lances", nome: "Abertura / Lances", icone: "radar" },
  { id: "recursos", nome: "Recursos", icone: "chat" },
  { id: "homologacao", nome: "Homologação / Contrato", icone: "check" },
  { id: "finalizado", nome: "Finalizado", icone: "star" },
];

// Coordenadas de tela (x,y em 0–100) de cada UF — calibradas p/ silhueta do Brasil
const CORES_STATUS = { "Aberto": "#1b9e4b", "Em andamento": "#2563eb", "Encerrado": "#94a3b8" };
const CORES_ENTIDADE = {
  SESI: "#2563eb", SENAI: "#7c3aed", "SESI e SENAI": "#4f46e5", "Sistema Indústria": "#0891b2",
  SESC: "#0f766e", SENAC: "#be185d", SENAR: "#4d7c0f", SEBRAE: "#b45309",
  "SEST/SENAT": "#1d4ed8", SESCOOP: "#15803d", Correios: "#c2410c",
};
function corEntidade(e) { return CORES_ENTIDADE[e] || "#64748b"; }

// helpers de arco SVG (donut / pizza)
function polar(cx, cy, r, ang) { const a = ((ang - 90) * Math.PI) / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; }
function arco(cx, cy, r, ini, fim) {
  const [x1, y1] = polar(cx, cy, r, fim);
  const [x2, y2] = polar(cx, cy, r, ini);
  const grande = fim - ini <= 180 ? 0 : 1;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${grande} 0 ${x2} ${y2}`;
}
function fatia(cx, cy, r, ini, fim) {
  const [x1, y1] = polar(cx, cy, r, fim);
  const [x2, y2] = polar(cx, cy, r, ini);
  const grande = fim - ini <= 180 ? 0 : 1;
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${grande} 0 ${x2} ${y2} Z`;
}

// Desfechos possíveis ao finalizar o processo (alimentam o Relatório de Processos)
const RESULTADOS = ["Em andamento", "Vencido / Contratado", "Não vencido", "Desclassificado", "Revogado / Anulado", "Deserto / Fracassado", "Desistência"];
const RESULTADO_IMPUGNACAO = ["Pendente", "Deferida", "Indeferida", "Parcialmente deferida"];
const CORES_RESULTADO = {
  "Em andamento": "#2563eb", "Vencido / Contratado": "#1b9e4b", "Não vencido": "#dc2626",
  "Desclassificado": "#b45309", "Revogado / Anulado": "#7c3aed", "Deserto / Fracassado": "#0891b2",
  "Desistência": "#94a3b8",
};
// converte valor em pt-BR ("340.000,00") ou número para Number
function parseBRL(v) {
  if (typeof v === "number") return v;
  if (!v) return 0;
  const n = parseFloat(String(v).replace(/\s|R\$/g, "").replace(/\./g, "").replace(",", "."));
  return isNaN(n) ? 0 : n;
}
// valor de referência do processo: proposta do usuário, senão valor de referência do edital
function valorProcesso(p) { return parseBRL(p.valorProposta) || parseBRL(p.valorReferencia) || 0; }
const RESULTADO_DECIDE = new Set(["Vencido / Contratado", "Não vencido", "Desclassificado"]);

// aderência de um edital aos interesses declarados no cadastro
function editalAderente(e, interesses) {
  if (!interesses) return false;
  const ent = interesses.entidades || [], seg = interesses.segmentos || [], ufs = interesses.ufs || [];
  if (!ent.length && !seg.length && !ufs.length) return false;
  if (ent.length && !ent.some((x) => (e.entidade || "").includes(x))) return false;
  if (seg.length && !seg.includes(e.segmento)) return false;
  if (ufs.length && !ufs.includes(e.uf)) return false;
  return true;
}

// Checklist padrão de habilitação no Sistema S — base para cada processo
const CHECKLIST_PADRAO = [
  "Contrato social / estatuto e última alteração",
  "Cartão CNPJ atualizado",
  "CND — Débitos Federais e Dívida Ativa da União (Receita/PGFN)",
  "CRF — Certificado de Regularidade do FGTS (Caixa)",
  "CNDT — Certidão Negativa de Débitos Trabalhistas (TST)",
  "Certidão Negativa de Débitos Estaduais",
  "Certidão Negativa de Débitos Municipais",
  "Certidão Negativa de Falência e Recuperação Judicial",
  "Atestado(s) de capacidade técnica compatível(is)",
  "Proposta comercial assinada",
  "Declarações do edital (menor, inexistência de fato impeditivo etc.)",
];

const LOGOS = {
  SESI: "/logos/sesi.png",
  SENAI: "/logos/senai.png",
  SESC: "/logos/sesc.png",
  SENAC: "/logos/senac.png",
  SENAR: "/logos/senar.png",
  SEBRAE: "/logos/sebrae.jpg",
  "SEST/SENAT": "/logos/sest-senat.jpg",
  SESCOOP: "/logos/sescoop.jpg",
};

const PAGE_SIZE = 30;

/* regulamentos oficiais servidos em /regulamentos (espelho de lib/regulamentos.js) */
const REGULAMENTOS = {
  SESI: { nome: "Regulamento para Contratação e Alienação (RCA) — SESI", pdf: "/regulamentos/rca-sesi.pdf" },
  SENAI: { nome: "Regulamento para Contratação e Alienação (RCA) — SENAI", pdf: "/regulamentos/rca-senai.pdf" },
  SESC: { nome: "Regulamento de Licitações e Contratos do Sesc (Resolução Sesc nº 1.593/2024)", pdf: "/regulamentos/rlc-sesc-senac.pdf" },
  SENAC: { nome: "Regulamento de Licitações e Contratos do Senac (Resolução Senac nº 1.270/2024)", pdf: "/regulamentos/rlc-sesc-senac.pdf" },
  SENAR: { nome: "Regulamento de Licitações e Contratos do SENAR (2023)", pdf: "/regulamentos/rlc-senar.pdf" },
  SEBRAE: { nome: "Regulamento de Licitações e Contratos do Sistema Sebrae (Resolução CDN nº 493/2024)", pdf: "/regulamentos/rlc-sebrae.pdf" },
  "SEST/SENAT": { nome: "Regulamento de Licitações e Contratos do SEST e do SENAT (Resolução Normativa CN nº 002/2024)", pdf: "/regulamentos/rlc-sest-senat.pdf" },
  SESCOOP: { nome: "Regulamento de Licitações e Contratos do SESCOOP (Resolução nº 2.056/2023)", pdf: "/regulamentos/rlc-sescoop.pdf" },
  CORREIOS: { nome: "Regulamento de Licitações e Contratações dos Correios — RLCC", pdf: "/regulamentos/rlcc-correios.pdf" },
};
function regulamentoDe(entidade) {
  const e = (entidade || "").toUpperCase();
  if (REGULAMENTOS[e]) return REGULAMENTOS[e];
  if (e.includes("CORREIOS")) return REGULAMENTOS.CORREIOS;
  if (e.includes("SESCOOP")) return REGULAMENTOS.SESCOOP;
  if (e.includes("SEST") || e.includes("SENAT")) return REGULAMENTOS["SEST/SENAT"];
  if (e.includes("SENAI") && !e.includes("SESI")) return REGULAMENTOS.SENAI;
  if (e.includes("SESI") || e.includes("SISTEMA IND")) return REGULAMENTOS.SESI;
  return null;
}

/* ---------- ícones proprietários (SVG inline) ---------- */
const PATHS = {
  radar: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="0.8" fill="currentColor" /><path d="M12 3v4.5" /><path d="M18.4 5.6 15.2 8.8" /></>,
  star: <path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 16.9l-5.3 2.7 1-5.8-4.2-4.1 5.9-.9L12 3.5z" />,
  chat: <><path d="M4 5.5h16v11H9l-5 4v-15z" /><path d="M8 9.5h8M8 12.5h5" /></>,
  fonte: <><ellipse cx="12" cy="6" rx="7" ry="2.8" /><path d="M5 6v12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6" /><path d="M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8" /></>,
  perfil: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c1-4 4-5.5 7-5.5s6 1.5 7 5.5" /></>,
  bolt: <path d="M13 2 5 13.5h5.5L11 22l8-11.5h-5.5L13 2z" />,
  pdf: <><path d="M6 3h8l4 4v14H6V3z" /><path d="M14 3v4h4" /><path d="M9 13h6M9 16.5h6" /></>,
  salvar: <path d="M6 3h12v18l-6-4-6 4V3z" />,
  doc: <><path d="M6 3h8l4 4v14H6V3z" /><path d="M14 3v4h4" /></>,
  seta: <path d="M7 17 17 7M9 7h8v8" />,
  check: <path d="M4 12.5 9.5 18 20 6.5" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  sol: <><circle cx="12" cy="12" r="4.2" /><path d="M12 2.5v2.5M12 19v2.5M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2.5 12H5M19 12h2.5M4.2 19.8 6 18M18 6l1.8-1.8" /></>,
  lua: <path d="M20 14.5A8 8 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5z" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  kanban: <><rect x="3" y="4" width="5" height="16" rx="1" /><rect x="9.5" y="4" width="5" height="11" rx="1" /><rect x="16" y="4" width="5" height="14" rx="1" /></>,
  calendario: <><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 9.5h17M8 3v4M16 3v4" /></>,
  tabela: <><rect x="3.5" y="5" width="17" height="14" rx="1.5" /><path d="M3.5 10h17M3.5 14.5h17M9 5v14" /></>,
  mais: <path d="M12 5v14M5 12h14" />,
  lixeira: <><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" /></>,
  home: <><path d="M4 11 12 4l8 7" /><path d="M6 10v9h12v-9" /><path d="M10 19v-5h4v5" /></>,
};
function Icon({ nome, size = 15, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, ...style }} aria-hidden="true">
      {PATHS[nome]}
    </svg>
  );
}

function LogoMark({ size = 34 }) {
  // id único e estável (server/client) por instância — evita colisão de gradiente
  const gid = `sgrad-${useId()}`;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="S-Aggregator">
      <defs>
        <linearGradient id={gid} x1="10" y1="4" x2="40" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3DBB4E" />
          <stop offset="1" stopColor="#0E7A34" />
        </linearGradient>
      </defs>
      <path
        d="M38 12.5C38 8.4 34.6 5 30.5 5H24c-6.6 0-12 5.4-12 12 0 6.6 5.4 11 12 11h3.5c2.5 0 4.5 1.8 4.5 4s-2 4-4.5 4H14c-2.8 0-5 2.2-5 5s2.2 4 5 4h13.5c6.6 0 12-5.4 12-12 0-6.6-5.4-11-12-11H24c-2.5 0-4.5-1.8-4.5-4s2-4 4.5-4h9c2.8 0 5-2.2 5-4.5z"
        fill={`url(#${gid})`}
      />
      <rect x="2" y="19" width="4" height="4" rx="1" fill="#2FA746" />
      <rect x="8" y="24" width="3" height="3" rx="0.8" fill="#3DBB4E" />
      <rect x="4" y="28" width="3" height="3" rx="0.8" fill="#6FCF6F" />
    </svg>
  );
}

/* logotipo oficial da entidade; fallback em chip de texto */
function EntidadeLogo({ entidade, altura = 16 }) {
  const e = entidade.toUpperCase();
  if (e === "SESI E SENAI") {
    return (
      <span className="ent-logo-wrap" title={entidade}>
        <img src={LOGOS.SESI} alt="SESI" style={{ height: altura }} />
        <img src={LOGOS.SENAI} alt="SENAI" style={{ height: altura }} />
      </span>
    );
  }
  const chave = Object.keys(LOGOS).find((k) => e === k);
  if (chave) {
    return (
      <span className="ent-logo-wrap" title={entidade}>
        <img src={LOGOS[chave]} alt={entidade} style={{ height: altura }} />
      </span>
    );
  }
  return <span className="chip chip-seg">{entidade}</span>;
}

function chipStatus(status) {
  if (status === "Aberto") return "chip-aberto";
  if (status === "Em andamento") return "chip-andamento";
  return "chip-encerrado";
}

/* chips de texto por entidade (coluna da tabela — tamanhos consistentes) */
function chipEntidade(entidade) {
  const e = entidade.toUpperCase();
  if (e.includes("CORREIOS")) return "chip-correios";
  if (e.includes("SESCOOP")) return "chip-sescoop";
  if (e.includes("SEST") || e.includes("SENAT")) return "chip-sest";
  if (e.includes("SEBRAE")) return "chip-sebrae";
  if (e.includes("SENAC")) return "chip-senac";
  if (e.includes("SESC")) return "chip-sesc";
  if (e.includes("SENAR")) return "chip-senar";
  if (e.includes("SENAI") && !e.includes("SESI")) return "chip-senai";
  if (e.includes("SESI")) return "chip-sesi";
  return "chip-seg";
}

/* timbrado para impressão/PDF (modelo oficial) */
function PrintHeader({ entidade }) {
  return (
    <div className="print-header">
      <div className="print-header-bar" />
      <div className="print-header-row">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <LogoMark size={38} />
          <div>
            <div className="print-logo-name"><span className="s-green">S</span>-Aggregator</div>
            <div className="print-logo-tag">AGREGANDO OPORTUNIDADES DE NEGÓCIOS DO <b>SISTEMA S</b></div>
          </div>
        </div>
        {entidade && <EntidadeLogo entidade={entidade} altura={22} />}
      </div>
    </div>
  );
}
function PrintFooter() {
  return (
    <div className="print-footer">
      <div className="print-footer-bar" />
      <div className="print-footer-row">
        <span><b>S-Aggregator</b> · Radar de Licitações do Sistema S</span>
        <span>www.s-aggregator.com.br · contato@s-aggregator.com.br</span>
        <span>Relatório gerado automaticamente com dados dos portais oficiais</span>
      </div>
    </div>
  );
}

function grauClass(g) {
  const t = (g || "").toLowerCase();
  if (t.includes("alto") && !t.includes("médio") && !t.includes("medio")) return "grau-alto";
  if (t.includes("alto")) return "grau-medioalto";
  if (t.includes("médio") || t.includes("medio") || t.includes("média") || t.includes("media")) return "grau-medio";
  return "grau-baixo";
}

function fmtBRL(v) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}
function fmtData(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T12:00:00");
  if (isNaN(d) || d.getFullYear() < 2000 || d.getFullYear() > 2100) return "—";
  return d.toLocaleDateString("pt-BR");
}
function diasAte(iso) {
  if (!iso) return null;
  return Math.ceil((new Date(iso + "T12:00:00") - new Date()) / 86400000);
}
function splitKV(s) {
  const i = s.indexOf(":");
  if (i > 0 && i < 60) return [s.slice(0, i).trim(), s.slice(i + 1).trim()];
  return [null, s];
}
function splitRisco(s) {
  const m = /^(.*?)\s*[—–-]\s*(Baixo|Médio\/Alto|Medio\/Alto|Médio|Medio|Alto)\s*$/i.exec(s);
  return m ? [m[1], m[2]] : [s, "Médio"];
}

/* transforma URLs em links clicáveis */
function Linkify({ texto }) {
  const partes = String(texto).split(/(https?:\/\/[^\s)]+)/g);
  return partes.map((p, i) =>
    /^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noreferrer">{p.length > 60 ? p.slice(0, 60) + "…" : p}</a> : p
  );
}

function SecKV({ n, titulo, itens }) {
  if (!itens?.length) return null;
  return (
    <div className="rel-sec">
      <h4>{n}. {titulo}</h4>
      <dl className="sumario-grid">
        {itens.map((x, i) => {
          const [campo, valor] = splitKV(x);
          return (
            <FragmentoKV key={i} campo={campo || "—"} valor={valor} />
          );
        })}
      </dl>
    </div>
  );
}
function FragmentoKV({ campo, valor }) {
  return (<><dt>{campo}</dt><dd><Linkify texto={valor} /></dd></>);
}
function SecLista({ n, titulo, itens, marcador }) {
  if (!itens?.length) return null;
  return (
    <div className="rel-sec">
      <h4>{n}. {titulo}</h4>
      <ul className={marcador === "check" ? "lista-check" : ""}>
        {itens.map((x, i) => <li key={i}><Linkify texto={x} /></li>)}
      </ul>
    </div>
  );
}

// Etapas reais da geração do relatório (emitidas pelo backend via SSE, FASE 3).
// A ordem espelha o pipeline do /api/analisar: localizar → anexos → extração ‖ parecer → consolidação.
const ETAPAS_ANALISE = [
  { id: "lendo", label: "Lendo o edital" },
  { id: "anexos", label: "Cruzando com o regulamento e o seu perfil" },
  { id: "extraindo", label: "Extraindo dados, prazos e exigências" },
  { id: "analisando", label: "Analisando compatibilidade e probabilidade" },
  { id: "redigindo", label: "Redigindo o relatório executivo" },
];

// Estado de espera com etapas REAIS + lupa varrendo o documento (SVG inline,
// respeita prefers-reduced-motion). Sem barra de progresso falsa.
function LoadingAnalise({ etapa, tokens }) {
  const pos = ETAPAS_ANALISE.findIndex((e) => e.id === etapa?.id);
  const idx = pos < 0 ? 0 : pos;
  return (
    <div className="analise-loading" role="status" aria-live="polite">
      <div className="lupa-wrap" aria-hidden="true">
        <svg viewBox="0 0 150 120" className="lupa-svg">
          <rect x="26" y="14" width="74" height="94" rx="7" className="lupa-doc" />
          <line x1="38" y1="34" x2="88" y2="34" className="lupa-linha" />
          <line x1="38" y1="46" x2="88" y2="46" className="lupa-linha" />
          <line x1="38" y1="58" x2="76" y2="58" className="lupa-linha" />
          <line x1="38" y1="70" x2="88" y2="70" className="lupa-linha" />
          <line x1="38" y1="82" x2="70" y2="82" className="lupa-linha" />
          <g className="lupa-glass">
            <circle cx="0" cy="0" r="19" className="lupa-lente" />
            <circle cx="0" cy="0" r="19" className="lupa-aro" />
            <line x1="13.5" y1="13.5" x2="30" y2="30" className="lupa-cabo" />
          </g>
        </svg>
      </div>
      <div className="analise-etapas-col">
        <ul className="analise-etapas">
          {ETAPAS_ANALISE.map((e, i) => (
            <li key={e.id} className={i < idx ? "feita" : i === idx ? "ativa" : "futura"}>
              <span className="etapa-marca">
                {i < idx ? <Icon nome="check" size={11} /> : i === idx ? <span className="etapa-spin" /> : <span className="etapa-dot" />}
              </span>
              {e.label}
            </li>
          ))}
        </ul>
        <div className="analise-tokens">{tokens > 0 ? `${tokens.toLocaleString("pt-BR")} tokens redigidos…` : "Preparando a leitura…"}</div>
      </div>
    </div>
  );
}

function RelatorioExecutivo({ analise: a, numero }) {
  const rec = a.recomendacao;
  const badgeRec = (
    <span className={`recomendacao ${rec === "PARTICIPAR" ? "rec-participar" : rec === "NAO_PARTICIPAR" ? "rec-nao" : "rec-avaliar"}`}>
      {rec === "PARTICIPAR" ? "✓ RECOMENDAÇÃO: PARTICIPAR" : rec === "NAO_PARTICIPAR" ? "✕ RECOMENDAÇÃO: NÃO PARTICIPAR" : "⚠ RECOMENDAÇÃO: AVALIAR COM CAUTELA"}
    </span>
  );
  return (
    <div className="ia-box relatorio" id="relatorio-executivo">
      <div className="ia-header">
        <span className="ia-title"><Icon nome="bolt" size={13} style={{ marginRight: 5, verticalAlign: -2 }} />RELATÓRIO EXECUTIVO DE ANÁLISE — {numero}</span>
        {a.demo && <span className="chip chip-erro">MODO DEMO</span>}
      </div>

      <div className="score-ring">
        <div className="score-num" style={{ color: a.score_aderencia >= 70 ? "var(--green-dark)" : a.score_aderencia >= 40 ? "var(--amber)" : "var(--red)" }}>
          {a.score_aderencia}
        </div>
        <div>
          <div style={{ fontSize: 11, color: "var(--muted-2)", marginBottom: 5 }}>SCORE DE ADERÊNCIA</div>
          <div className="score-bar-track" style={{ width: 220 }}>
            <div className="score-bar" style={{ width: `${a.score_aderencia}%`, background: a.score_aderencia >= 70 ? "var(--green)" : a.score_aderencia >= 40 ? "#d97706" : "var(--red)" }} />
          </div>
          <div style={{ fontSize: 11, color: "var(--muted-2)", marginTop: 5, maxWidth: 330 }}>{a.justificativa_score}</div>
        </div>
      </div>

      {badgeRec}

      <SecKV n={1} titulo="Resumo Executivo" itens={a.resumo_executivo} />
      <SecKV n={2} titulo="Dados Gerais da Licitação" itens={a.dados_gerais} />

      <div className="rel-sec">
        <h4>3. Objeto da Licitação</h4>
        <p style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 8 }}>{a.objeto_descricao}</p>
        {a.objeto_escopo?.length > 0 && (
          <>
            <div className="rel-sub">Escopo principal</div>
            <ul>{a.objeto_escopo.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </>
        )}
        {a.objeto_obrigacoes?.length > 0 && (
          <>
            <div className="rel-sub">Obrigações principais</div>
            <ul>{a.objeto_obrigacoes.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </>
        )}
        <div className="rel-sub">Perfil da empresa ideal</div>
        <p style={{ fontSize: 13, lineHeight: 1.7 }}>{a.perfil_empresa_ideal}</p>
      </div>

      <SecKV n={4} titulo="Valores" itens={a.valores} />

      {a.cronograma?.length > 0 && (
        <div className="rel-sec">
          <h4>5. Cronograma</h4>
          <table className="part-table">
            <thead><tr><th>Etapa</th><th>Prazo / Data</th></tr></thead>
            <tbody>
              {a.cronograma.map((c, i) => {
                const [etapa, prazo] = splitKV(c);
                return (
                  <tr key={i}><td>{etapa || "—"}</td><td style={{ fontWeight: 600 }}>{prazo}</td></tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <SecKV n={6} titulo="Condições de Participação" itens={a.condicoes_participacao} />
      <SecLista n={7} titulo="Documentação Exigida" itens={a.documentacao_exigida} />
      <SecKV n={8} titulo="Execução do Contrato" itens={a.execucao_contrato} />

      {a.garantias && (
        <div className="rel-sec">
          <h4>9. Garantias</h4>
          <p style={{ fontSize: 13, lineHeight: 1.7 }}>{a.garantias}</p>
        </div>
      )}

      <SecLista n={10} titulo="Penalidades" itens={a.penalidades} />

      {a.matriz_riscos?.length > 0 && (
        <div className="rel-sec">
          <h4>11. Matriz de Riscos</h4>
          <div className="riscos-lista">
            {a.matriz_riscos.map((r, i) => {
              const [risco, grau] = splitRisco(r);
              return (
                <div className="risco-linha" key={i}>
                  <span>{risco}</span>
                  <span className={`chip grau ${grauClass(grau)}`}>{grau}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <SecLista n={12} titulo="Conformidade com o Regulamento da Entidade" itens={a.conformidade_regulamento} />
      <SecLista n={13} titulo="Oportunidades" itens={a.oportunidades} />
      <SecLista n={14} titulo="Pontos de Atenção" itens={a.pontos_atencao} />
      <SecLista n={15} titulo="Checklist para Participação" itens={a.checklist_participacao} marcador="check" />
      <SecKV n={16} titulo="Como Participar (plataforma, cadastro e canais)" itens={a.como_participar} />

      <div className="rel-sec">
        <h4>17. Decisão Estratégica</h4>
        <div className="decisao-grid">
          <div className="decisao-item"><b>Grau de dificuldade</b>{a.grau_dificuldade}</div>
          <div className="decisao-item"><b>Atratividade financeira</b>{a.atratividade_financeira}</div>
          <div className="decisao-item"><b>Complexidade operacional</b>{a.complexidade_operacional}</div>
          <div className="decisao-item"><b>Risco jurídico</b>{a.risco_juridico}</div>
          <div className="decisao-item"><b>Competitividade esperada</b>{a.competitividade_esperada}</div>
        </div>
      </div>

      <div className="rel-sec parecer-box">
        <h4>18. Parecer Final</h4>
        <dl className="sumario-grid">
          <FragmentoKV campo="Principais vantagens" valor={a.parecer_vantagens} />
          <FragmentoKV campo="Principais desvantagens" valor={a.parecer_desvantagens} />
          <FragmentoKV campo="Principais riscos" valor={a.parecer_riscos} />
          <FragmentoKV campo="Perfil mais adequado" valor={a.parecer_perfil_adequado} />
        </dl>
        <div style={{ marginTop: 10 }}>{badgeRec}</div>
        <p style={{ fontSize: 13, lineHeight: 1.7, marginTop: 10 }}><b>Justificativa:</b> {a.justificativa_recomendacao}</p>
      </div>
    </div>
  );
}

/* ---------- chat "Pergunte ao Edital" ---------- */
function ChatEdital({ edital, perfil, empresa }) {
  const [msgs, setMsgs] = useState([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState(null);
  const fimRef = useRef(null);

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, enviando]);

  async function enviar(e) {
    e?.preventDefault();
    const pergunta = texto.trim();
    if (!pergunta || enviando) return;
    const novas = [...msgs, { autor: "usuario", texto: pergunta }];
    setMsgs(novas);
    setTexto("");
    setEnviando(true);
    setErro(null);
    try {
      const r = await fetch("/api/perguntar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ editalId: edital.id, mensagens: novas, empresa, perfilEmpresa: perfil }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Erro ${r.status}`);
      setMsgs([...novas, { autor: "assistente", texto: j.resposta }]);
    } catch (err) {
      setErro(err.message);
      setMsgs(msgs); // desfaz a pergunta para reenviar
      setTexto(pergunta);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="chat-box no-print">
      <div className="chat-head">
        <Icon nome="chat" size={14} />
        <span>Pergunte ao Edital</span>
        <span className="chip chip-aberto" style={{ marginLeft: "auto" }}>lê o edital e o regulamento</span>
      </div>
      <div className="chat-msgs">
        {msgs.length === 0 && (
          <div className="chat-vazio">
            Ex.: &quot;Qual o prazo para impugnação?&quot; · &quot;Preciso de atestado de capacidade técnica?&quot; ·
            &quot;Aceita consórcio?&quot; · &quot;Como envio a proposta?&quot;
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`chat-msg ${m.autor === "usuario" ? "chat-user" : "chat-ia"}`}>
            {m.texto}
          </div>
        ))}
        {enviando && <div className="chat-msg chat-ia chat-digitando">Consultando o edital…</div>}
        {erro && <div className="ia-erro">✕ {erro}</div>}
        <div ref={fimRef} />
      </div>
      <form className="chat-input" onSubmit={enviar}>
        <input
          type="text"
          placeholder="Faça uma pergunta sobre este processo..."
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          disabled={enviando}
        />
        <button className="btn-ia" type="submit" disabled={enviando || !texto.trim()}>
          {enviando ? <span className="spinner" /> : "Enviar"}
        </button>
      </form>
    </div>
  );
}

/* ---------- Módulo de Cadastro da Empresa ---------- */
function diasParaVencer(validadeISO) {
  if (!validadeISO) return null;
  const alvo = new Date(validadeISO + "T00:00:00");
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return Math.round((alvo - hoje) / 86400000);
}
function statusCertidaoClasse(c) {
  if (c.status === "Regular") {
    const d = diasParaVencer(c.validade);
    if (d !== null && d < 0) return "cert-vencida";
    if (d !== null && d <= 15) return "cert-vencendo";
    return "cert-ok";
  }
  if (c.status === "Positiva com efeito negativo") return "cert-ok";
  if (c.status === "Pendente / vencida") return "cert-vencida";
  return "cert-neutra";
}

function CadastroEmpresa({
  empresa, consultando, erroCnpj, salva,
  onCnpjInput, onConsultar, onCertidao, onQuestionario, onInteresse,
  onAddAtestado, onSetAtestado, onRemoverAtestado, onAnexar, onRemoverDoc, onTextoLivre, onSalvar,
}) {
  const d = empresa.dados;
  const inter = empresa.interesses || { entidades: [], ufs: [], segmentos: [] };
  const fmtDataBR = (iso) => (iso ? new Date(iso + "T12:00:00").toLocaleDateString("pt-BR") : "—");
  const alertasCertidao = empresa.certidoes.filter((c) => statusCertidaoClasse(c) === "cert-vencida" || statusCertidaoClasse(c) === "cert-vencendo").length;

  return (
    <>
      <div className="header-row">
        <div>
          <h1 className="page-title"><Icon nome="perfil" size={19} style={{ marginRight: 8, verticalAlign: -2, color: "var(--green)" }} />Cadastro da Empresa</h1>
          <div className="page-sub">Dados da Receita Federal, certidões e capacidade técnica — a IA cruza tudo com cada edital</div>
        </div>
        <button className="btn-ia" onClick={onSalvar}><Icon nome="salvar" size={14} /> Salvar cadastro</button>
      </div>
      {salva && <div className="cadastro-salvo">✓ Cadastro salvo neste navegador. A IA passará a usar estes dados nas análises.</div>}

      {/* 1. CNPJ + consulta Receita */}
      <div className="cad-card">
        <div className="cad-titulo"><Icon nome="fonte" size={14} /> 1. Identificação (Receita Federal)</div>
        <div className="cad-cnpj-row">
          <input
            type="text"
            placeholder="Digite o CNPJ (só números ou formatado)"
            value={empresa.cnpjInput}
            onChange={(e) => onCnpjInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onConsultar()}
          />
          <button className="btn-ia" onClick={onConsultar} disabled={consultando}>
            {consultando ? <><span className="spinner" /> Consultando...</> : <><Icon nome="radar" size={14} /> Consultar Receita</>}
          </button>
        </div>
        {erroCnpj && <div className="ia-erro">✕ {erroCnpj}</div>}

        {d && (
          <div className="cad-receita">
            <div className="cad-receita-head">
              <div>
                <div className="cad-razao">{d.razaoSocial}</div>
                {d.nomeFantasia && <div className="cad-fantasia">{d.nomeFantasia}</div>}
                <div className="objeto-num">{d.cnpj}</div>
              </div>
              <span className={`chip ${d.situacaoRegular ? "chip-aberto" : "chip-erro"}`} style={{ fontSize: 12, padding: "5px 12px" }}>
                {d.situacaoRegular ? "✓ " : "⚠ "}{d.situacao}
              </span>
            </div>
            <dl className="sumario-grid" style={{ marginTop: 8 }}>
              <dt>Porte</dt><dd>{d.porte}</dd>
              <dt>Enquadramento tributário</dt><dd>{d.enquadramentoTributario}</dd>
              <dt>Natureza jurídica</dt><dd>{d.naturezaJuridica || "—"}</dd>
              <dt>Capital social</dt><dd>{d.capitalSocial != null ? `R$ ${Number(d.capitalSocial).toLocaleString("pt-BR")}` : "—"}</dd>
              <dt>Abertura</dt><dd>{fmtDataBR(d.dataAbertura)}</dd>
              <dt>Atividade principal (CNAE)</dt><dd>{d.cnaePrincipal || "—"}</dd>
              <dt>Localização</dt><dd>{[d.endereco, d.municipio, d.uf].filter(Boolean).join(" · ")}{d.cep ? ` — CEP ${d.cep}` : ""}</dd>
              {d.telefone && <><dt>Contato</dt><dd>{d.telefone}{d.email ? ` · ${d.email}` : ""}</dd></>}
            </dl>
            {d.socios?.length > 0 && (
              <>
                <div className="rel-sub" style={{ marginTop: 10 }}>Quadro societário ({d.socios.length})</div>
                <ul className="cad-socios">
                  {d.socios.map((s, i) => (
                    <li key={i}>{s.nome}{s.qualificacao ? <span className="cad-socio-q"> · {s.qualificacao}</span> : null}</li>
                  ))}
                </ul>
              </>
            )}
            {d.cnaesSecundarios?.length > 0 && (
              <details className="cad-cnaes">
                <summary>Atividades secundárias ({d.cnaesSecundarios.length})</summary>
                <ul>{d.cnaesSecundarios.map((c, i) => <li key={i}>{c}</li>)}</ul>
              </details>
            )}
            <div className="cad-fonte">{d.fonte} · atualizado em {new Date(d.atualizadoEm).toLocaleString("pt-BR")} · reconsulta automática a cada 30 min</div>
          </div>
        )}
      </div>

      {/* 2. Certidões de habilitação */}
      {empresa.certidoes.length > 0 && (
        <div className="cad-card">
          <div className="cad-titulo">
            <Icon nome="check" size={14} /> 2. Certidões de habilitação
            {alertasCertidao > 0 && <span className="chip chip-erro" style={{ marginLeft: 8 }}>{alertasCertidao} vencida(s)/vencendo</span>}
          </div>
          <p className="cad-hint">
            Emita cada certidão no órgão oficial (link ao lado), informe o status e a validade, e anexe o PDF.
            O sistema alerta automaticamente quando alguma está vencida ou perto de vencer — e a IA considera isso no score de aderência.
          </p>
          <div className="cert-lista">
            {empresa.certidoes.map((c) => {
              const cls = statusCertidaoClasse(c);
              const dias = diasParaVencer(c.validade);
              return (
                <div key={c.id} className={`cert-item ${cls}`}>
                  <div className="cert-info">
                    <div className="cert-nome">{c.nome}</div>
                    <div className="cert-orgao">
                      {c.esfera} · {c.orgao}
                      {c.link ? <> · <a href={c.link} target="_blank" rel="noreferrer">emitir no site oficial ↗</a></> : <span className="cert-manual"> · emitir no site do órgão</span>}
                    </div>
                    {c.docNome && (
                      <div className="cert-doc">
                        <button className="link-btn" onClick={() => baixarDoc(c.docId, c.docNome)}>📎 {c.docNome}</button>
                        <button className="link-btn cert-remover" onClick={() => onRemoverDoc(c.docId, c.id)}>remover</button>
                      </div>
                    )}
                  </div>
                  <div className="cert-controles">
                    <select value={c.status || "Não informada"} onChange={(e) => onCertidao(c.id, "status", e.target.value)}>
                      {STATUS_CERTIDAO.map((s) => <option key={s}>{s}</option>)}
                    </select>
                    <input type="date" value={c.validade || ""} onChange={(e) => onCertidao(c.id, "validade", e.target.value)} title="Validade" />
                    <label className="cert-anexar">
                      {c.docNome ? "trocar" : "anexar"}
                      <input type="file" accept="application/pdf,image/*" style={{ display: "none" }} onChange={(e) => onAnexar("certidao", e.target.files?.[0], c.id)} />
                    </label>
                  </div>
                  {c.status === "Regular" && dias !== null && (
                    <div className={`cert-badge ${cls}`}>{dias < 0 ? `vencida há ${-dias} dia(s)` : dias === 0 ? "vence hoje" : `vence em ${dias} dia(s)`}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 3. Perfil para licitações (questionário) */}
      <div className="cad-card">
        <div className="cad-titulo"><Icon nome="doc" size={14} /> 3. Perfil para licitações</div>
        <div className="cad-grid2">
          <label className="cad-campo">
            <span>Segmentos de atuação</span>
            <input type="text" placeholder="Ex.: TI, engenharia, facilities" value={empresa.questionario.segmentosAtuacao} onChange={(e) => onQuestionario("segmentosAtuacao", e.target.value)} />
          </label>
          <label className="cad-campo">
            <span>Estados que atende presencialmente</span>
            <input type="text" placeholder="Ex.: PE, AL, BA" value={empresa.questionario.estadosAtendidos} onChange={(e) => onQuestionario("estadosAtendidos", e.target.value)} />
          </label>
          <label className="cad-campo">
            <span>Faturamento anual aproximado</span>
            <input type="text" placeholder="Ex.: R$ 2,5 milhões" value={empresa.questionario.faturamentoAnual} onChange={(e) => onQuestionario("faturamentoAnual", e.target.value)} />
          </label>
          <label className="cad-campo">
            <span>Nº de funcionários</span>
            <input type="text" placeholder="Ex.: 12" value={empresa.questionario.numeroFuncionarios} onChange={(e) => onQuestionario("numeroFuncionarios", e.target.value)} />
          </label>
        </div>
        <div className="cad-checks">
          <label className="cad-check"><input type="checkbox" checked={empresa.questionario.atendeRemoto} onChange={(e) => onQuestionario("atendeRemoto", e.target.checked)} /> Atende remotamente em todo o Brasil</label>
          <label className="cad-check"><input type="checkbox" checked={empresa.questionario.possuiCapacidadeTecnica} onChange={(e) => onQuestionario("possuiCapacidadeTecnica", e.target.checked)} /> Possui atestados de capacidade técnica</label>
          <label className="cad-check"><input type="checkbox" checked={empresa.questionario.participouLicitacoesS} onChange={(e) => onQuestionario("participouLicitacoesS", e.target.checked)} /> Já participou de licitações no Sistema S</label>
          <label className="cad-check"><input type="checkbox" checked={empresa.questionario.certidoesEmDia} onChange={(e) => onQuestionario("certidoesEmDia", e.target.checked)} /> Declara certidões e habilitação em dia</label>
        </div>
      </div>

      {/* 4. Interesses de participação */}
      <div className="cad-card">
        <div className="cad-titulo"><Icon nome="star" size={14} /> 4. Interesses de participação</div>
        <p className="cad-hint">Marque as entidades, estados e segmentos em que tem interesse. A IA usa essas preferências para calibrar as recomendações e destacar as oportunidades mais aderentes ao seu foco.</p>
        <div className="interesse-grupo">
          <div className="interesse-titulo">Entidades</div>
          <div className="interesse-chips">
            {ENTIDADES_INTERESSE.map((x) => (
              <label key={x} className={`interesse-chip ${inter.entidades.includes(x) ? "on" : ""}`}>
                <input type="checkbox" checked={inter.entidades.includes(x)} onChange={() => onInteresse("entidades", x)} />{x}
              </label>
            ))}
          </div>
        </div>
        <div className="interesse-grupo">
          <div className="interesse-titulo">Segmentos</div>
          <div className="interesse-chips">
            {SEGMENTOS_INTERESSE.map((x) => (
              <label key={x} className={`interesse-chip ${inter.segmentos.includes(x) ? "on" : ""}`}>
                <input type="checkbox" checked={inter.segmentos.includes(x)} onChange={() => onInteresse("segmentos", x)} />{x}
              </label>
            ))}
          </div>
        </div>
        <div className="interesse-grupo">
          <div className="interesse-titulo">Estados (UF)</div>
          <div className="interesse-chips interesse-ufs">
            {UFS_INTERESSE.map((x) => (
              <label key={x} className={`interesse-chip ${inter.ufs.includes(x) ? "on" : ""}`}>
                <input type="checkbox" checked={inter.ufs.includes(x)} onChange={() => onInteresse("ufs", x)} />{x}
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* 5. Atestados de capacidade técnica */}
      <div className="cad-card">
        <div className="cad-titulo">
          <Icon nome="doc" size={14} />XX__ATEST
          <button className="btn-secundario cad-add" onClick={onAddAtestado}>+ Adicionar atestado</button>
        </div>
        {empresa.atestados.length === 0 && <p className="cad-hint">Cadastre os contratos que comprovam sua experiência — a IA usa para verificar se você atende à qualificação técnica exigida no edital.</p>}
        {empresa.atestados.map((a, i) => (
          <div key={i} className="atestado-row">
            <input type="text" placeholder="Objeto do contrato" value={a.objeto} onChange={(e) => onSetAtestado(i, "objeto", e.target.value)} style={{ flex: 2 }} />
            <input type="text" placeholder="Órgão/cliente" value={a.orgao} onChange={(e) => onSetAtestado(i, "orgao", e.target.value)} style={{ flex: 1 }} />
            <input type="text" placeholder="Ano" value={a.ano} onChange={(e) => onSetAtestado(i, "ano", e.target.value)} style={{ width: 70 }} />
            <input type="text" placeholder="Valor R$" value={a.valor} onChange={(e) => onSetAtestado(i, "valor", e.target.value)} style={{ width: 100 }} />
            <button className="link-btn cert-remover" onClick={() => onRemoverAtestado(i)}><Icon nome="x" size={14} /></button>
          </div>
        ))}
      </div>

      {/* 6. Documentos anexados */}
      <div className="cad-card">
        <div className="cad-titulo">
          <Icon nome="doc" size={14} /> 6. Documentos (contrato social, atestados, outros)
          <label className="btn-secundario cad-add">
            + Anexar documento
            <input type="file" accept="application/pdf,image/*" style={{ display: "none" }} onChange={(e) => onAnexar("documento", e.target.files?.[0])} />
          </label>
        </div>
        {empresa.documentos.length === 0 && <p className="cad-hint">Anexe o contrato social e outros documentos padrão de habilitação (até 15 MB cada). Ficam guardados neste navegador.</p>}
        {empresa.documentos.length > 0 && (
          <ul className="docs-lista">
            {empresa.documentos.map((doc) => (
              <li key={doc.docId}>
                <button className="link-btn" onClick={() => baixarDoc(doc.docId, doc.nome)}>📎 {doc.nome}</button>
                <span className="doc-tam">{(doc.tamanho / 1024).toFixed(0)} KB</span>
                <button className="link-btn cert-remover" onClick={() => onRemoverDoc(doc.docId)}>remover</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 7. Observações livres */}
      <div className="cad-card">
        <div className="cad-titulo"><Icon nome="chat" size={14} /> 7. Informações adicionais</div>
        <textarea placeholder="Diferenciais, certificações (ISO), restrições de atuação, ou qualquer contexto que ajude a IA a avaliar aderência." value={empresa.textoLivre} onChange={(e) => onTextoLivre(e.target.value)} style={{ minHeight: 90 }} />
      </div>

      <div style={{ marginBottom: 30 }}>
        <button className="btn-ia" onClick={onSalvar}><Icon nome="salvar" size={14} /> Salvar cadastro</button>
        {salva && <span className="perfil-saved">✓ Cadastro salvo</span>}
      </div>
    </>
  );
}

/* ---------- Página Inicial: mapa do Brasil + gráficos ---------- */

// estados pequenos e amontoados no Nordeste (e DF): a bolha é deslocada para uma
// área livre e ligada ao estado por uma linha fina, evitando sobreposição.
const OFFSET_UF = {
  RN: [91.5, 14], PB: [93, 22.5], PE: [94, 31], AL: [93, 39.5], SE: [91.5, 48],
  DF: [69.5, 46],
};

function MapaBrasil({ contagemUF, ufSelecionada, onSelecionar, max }) {
  return (
    <svg viewBox={`0 0 ${MAPA_W} ${MAPA_H}`} className="mapa-svg" role="img" aria-label="Mapa de oportunidades por estado">
      {/* contorno real dos estados (silhueta do Brasil) */}
      {Object.entries(MAPA_UF).map(([uf, s]) => {
        const n = contagemUF[uf] || 0;
        const sel = ufSelecionada === uf;
        return (
          <path
            key={uf}
            d={s.d}
            className={`mapa-estado ${n ? "tem" : ""} ${sel ? "sel" : ""}`}
            onClick={() => onSelecionar(sel ? null : uf)}
            style={{ cursor: "pointer" }}
          >
            <title>{n ? `${uf} · ${n} processo(s)` : uf}</title>
          </path>
        );
      })}
      {/* conectores dos estados deslocados (desenhados antes das bolhas) */}
      {Object.entries(MAPA_UF).map(([uf, s]) => {
        const n = contagemUF[uf] || 0;
        const off = OFFSET_UF[uf];
        if (!n || !off) return null;
        return <line key={uf} x1={s.cx} y1={s.cy} x2={off[0]} y2={off[1]} className={`mapa-conector ${ufSelecionada === uf ? "sel" : ""}`} />;
      })}
      {/* bolhas: no centroide real, ou na posição deslocada quando definida */}
      {Object.entries(MAPA_UF).map(([uf, s]) => {
        const n = contagemUF[uf] || 0;
        if (!n) return null;
        const r = 1.7 + Math.sqrt(n / (max || 1)) * 5;
        const sel = ufSelecionada === uf;
        const off = OFFSET_UF[uf];
        const bx = off ? off[0] : s.cx;
        const by = off ? off[1] : s.cy;
        return (
          <g key={uf} className={`mapa-ponto ${sel ? "sel" : ""}`} onClick={() => onSelecionar(sel ? null : uf)} style={{ cursor: "pointer" }}>
            <circle cx={bx} cy={by} r={r} className="mapa-bolha" />
            <text x={bx} y={by + 0.7} className="mapa-num">{n}</text>
            {off
              ? <text x={bx - r - 1.2} y={by + 0.7} className="mapa-uf" style={{ textAnchor: "end" }}>{uf}</text>
              : <text x={bx} y={by + r + 2.4} className="mapa-uf">{uf}</text>}
          </g>
        );
      })}
    </svg>
  );
}

function GraficoBarras({ dados }) {
  const max = Math.max(1, ...dados.map((d) => d.valor));
  return (
    <div className="grafico-barras">
      {dados.map((d) => (
        <div key={d.rotulo} className="gb-linha">
          <span className="gb-rotulo">{d.rotulo}</span>
          <div className="gb-trilho"><div className="gb-barra" style={{ width: `${(d.valor / max) * 100}%`, background: d.cor }} /></div>
          <span className="gb-valor">{d.rotuloValor ?? d.valor}</span>
        </div>
      ))}
    </div>
  );
}

function GraficoDonut({ dados, titulo }) {
  const total = dados.reduce((s, d) => s + d.valor, 0) || 1;
  let acc = 0;
  return (
    <div className="grafico-circular">
      <svg viewBox="0 0 42 42" className="donut-svg">
        {dados.map((d) => {
          const frac = d.valor / total;
          const ini = acc * 360; acc += frac;
          const fim = acc * 360;
          if (frac <= 0) return null;
          return <path key={d.rotulo} d={arco(21, 21, 15.5, ini, fim === 360 ? 359.99 : fim)} fill="none" stroke={d.cor} strokeWidth="6.5" />;
        })}
        <text x="21" y="20" className="donut-total">{total}</text>
        <text x="21" y="25" className="donut-legenda-c">{titulo}</text>
      </svg>
      <ul className="grafico-legenda">
        {dados.filter((d) => d.valor > 0).slice(0, 8).map((d) => (
          <li key={d.rotulo}><span className="leg-cor" style={{ background: d.cor }} />{d.rotulo}<b>{d.valor}</b></li>
        ))}
      </ul>
    </div>
  );
}

function GraficoPizza({ dados, destaque }) {
  const total = dados.reduce((s, d) => s + d.valor, 0) || 1;
  let acc = 0;
  return (
    <div className="grafico-circular">
      <svg viewBox="0 0 42 42" className="donut-svg">
        {dados.map((d) => {
          const frac = d.valor / total;
          const ini = acc * 360; acc += frac;
          const fim = acc * 360;
          if (frac <= 0) return null;
          const on = destaque && d.rotulo === destaque;
          const apagado = destaque && !on;
          const r = on ? 21 : 20;
          return <path key={d.rotulo} d={fatia(21, 21, r, ini, fim === 360 ? 359.99 : fim)} fill={d.cor} stroke="var(--card)" strokeWidth={on ? 0.8 : 0.4} opacity={apagado ? 0.32 : 1} />;
        })}
      </svg>
      <ul className="grafico-legenda">
        {dados.filter((d) => d.valor > 0).slice(0, 10).map((d) => (
          <li key={d.rotulo} className={destaque && d.rotulo === destaque ? "leg-on" : ""}><span className="leg-cor" style={{ background: d.cor }} />{d.rotulo}<b>{d.valor}</b></li>
        ))}
      </ul>
    </div>
  );
}

function PaginaInicial({ base, interesses, temInteresses, onAbrir, onIrRadar, idsPipeline, onParticipar }) {
  const [fEntidade, setFEntidade] = useState("Todas");
  const [fStatus, setFStatus] = useState("Aberto"); // carrega em abertas
  const [ufSel, setUfSel] = useState(null);

  const editais = base?.editais || [];
  const entidades = base?.filtros?.entidades || [];
  const carregando = !base;

  const filtrados = useMemo(() => editais.filter((e) => {
    if (fEntidade !== "Todas" && !e.entidade.includes(fEntidade)) return false;
    if (fStatus !== "Todos" && e.status !== fStatus) return false;
    return true;
  }), [editais, fEntidade, fStatus]);

  const contagemUF = useMemo(() => {
    const m = {};
    for (const e of filtrados) if (e.uf) m[e.uf] = (m[e.uf] || 0) + 1;
    return m;
  }, [filtrados]);
  const maxUF = Math.max(1, ...Object.values(contagemUF));

  const destaques = useMemo(() => {
    if (!temInteresses) return [];
    return editais.filter((e) => e.status === "Aberto" && editalAderente(e, interesses)).slice(0, 12);
  }, [editais, interesses, temInteresses]);

  // quando um estado é selecionado, os gráficos passam a refletir só aquele estado
  const filtradosGraf = useMemo(() => (ufSel ? filtrados.filter((e) => e.uf === ufSel) : filtrados), [filtrados, ufSel]);
  const porStatus = ["Aberto", "Em andamento", "Encerrado"].map((s) => ({ rotulo: s, valor: filtradosGraf.filter((e) => e.status === s).length, cor: CORES_STATUS[s] }));
  const porEntidade = useMemo(() => {
    const m = {};
    for (const e of filtradosGraf) m[e.entidade] = (m[e.entidade] || 0) + 1;
    return Object.entries(m).map(([k, v]) => ({ rotulo: k, valor: v, cor: corEntidade(k) })).sort((a, b) => b.valor - a.valor);
  }, [filtradosGraf]);
  const porEstado = useMemo(() => {
    const paleta = ["#1b9e4b", "#2563eb", "#7c3aed", "#be185d", "#b45309", "#0f766e", "#c2410c", "#4d7c0f", "#0891b2", "#7c2d12"];
    const ordenado = Object.entries(contagemUF).sort((a, b) => b[1] - a[1]);
    const top = ordenado.slice(0, 9);
    const resto = ordenado.slice(9).reduce((s, [, v]) => s + v, 0);
    const arr = top.map(([k, v], i) => ({ rotulo: k, valor: v, cor: paleta[i % paleta.length] }));
    if (resto) arr.push({ rotulo: "Outros", valor: resto, cor: "#94a3b8" });
    return arr;
  }, [contagemUF]);

  const listaUF = ufSel ? filtrados.filter((e) => e.uf === ufSel).slice(0, 40) : [];

  return (
    <>
      <div className="header-row">
        <div>
          <h1 className="page-title"><Icon nome="home" size={19} style={{ marginRight: 8, verticalAlign: -2, color: "var(--green)" }} />Painel Nacional</h1>
          <div className="page-sub">Oportunidades do Sistema S e Correios em todo o Brasil</div>
        </div>
      </div>

      {carregando && <div className="cad-card" style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>Carregando o panorama nacional…</div>}

      {/* Banner de destaques para o perfil */}
      {temInteresses && destaques.length > 0 && (
        <div className="destaque-banner">
          <div className="destaque-head">
            <Icon nome="radar" size={15} /> <b>Destaques para o seu perfil</b>
            <span>{destaques.length} oportunidade(s) aberta(s) aderente(s) aos seus interesses</span>
          </div>
          <div className="destaque-scroll">
            {destaques.map((e) => (
              <button key={e.id} className="destaque-card" onClick={() => onAbrir(e)}>
                <span className={`chip ${chipEntidade(e.entidade)}`}>{e.entidade}</span>
                <span className="destaque-num">{e.numero} · {e.uf}</span>
                <span className="destaque-obj">{(e.titulo || e.objeto).slice(0, 80)}</span>
                {e.dataAbertura && <span className="destaque-data"><Icon nome="calendario" size={11} /> {new Date(e.dataAbertura + "T12:00:00").toLocaleDateString("pt-BR")}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Mapa + filtros laterais */}
      <div className="inicio-grid">
        <div className="mapa-card">
          <div className="mapa-titulo">
            <span>Oportunidades por estado{fStatus !== "Todos" ? ` · ${fStatus}` : ""}{fEntidade !== "Todas" ? ` · ${fEntidade}` : ""}</span>
            <span className="mapa-total">{filtrados.length} processos · {Object.keys(contagemUF).length} UFs</span>
          </div>
          <MapaBrasil contagemUF={contagemUF} ufSelecionada={ufSel} onSelecionar={setUfSel} max={maxUF} />
          <div className="mapa-dica">Clique em um estado para ver os processos ↓</div>
        </div>

        <aside className="inicio-filtros">
          <div className="if-bloco">
            <div className="if-titulo">Status</div>
            {["Aberto", "Em andamento", "Encerrado", "Todos"].map((s) => (
              <button key={s} className={`if-btn ${fStatus === s ? "on" : ""}`} onClick={() => setFStatus(s)}>
                {s !== "Todos" && <span className="if-dot" style={{ background: CORES_STATUS[s] }} />}{s}
                <span className="if-count">{s === "Todos" ? editais.filter((e) => fEntidade === "Todas" || e.entidade.includes(fEntidade)).length : editais.filter((e) => e.status === s && (fEntidade === "Todas" || e.entidade.includes(fEntidade))).length}</span>
              </button>
            ))}
          </div>
          <div className="if-bloco">
            <div className="if-titulo">Entidade</div>
            <button className={`if-btn ${fEntidade === "Todas" ? "on" : ""}`} onClick={() => setFEntidade("Todas")}>Todas<span className="if-count">{editais.length}</span></button>
            {entidades.map((ent) => (
              <button key={ent} className={`if-btn ${fEntidade === ent ? "on" : ""}`} onClick={() => setFEntidade(ent)}>
                <span className="if-dot" style={{ background: corEntidade(ent) }} />{ent}
                <span className="if-count">{editais.filter((e) => e.entidade.includes(ent)).length}</span>
              </button>
            ))}
          </div>
          <button className="btn-ia if-radar" onClick={() => onIrRadar({ entidade: fEntidade, status: fStatus, uf: ufSel })}>
            <Icon nome="tabela" size={14} /> Abrir no Radar completo
          </button>
        </aside>
      </div>

      {/* Tabela do estado selecionado */}
      {ufSel && (
        <div className="table-wrap uf-tabela">
          <div className="table-head">
            <span className="table-title">Processos em {ufSel}{fStatus !== "Todos" ? ` · ${fStatus}` : ""}</span>
            <span className="table-count">{listaUF.length}{filtrados.filter((e) => e.uf === ufSel).length > 40 ? "+ (mostrando 40)" : ""} · <button className="link-btn" onClick={() => setUfSel(null)}>fechar</button></span>
          </div>
          <table>
            <thead><tr><th></th><th>Processo / Objeto</th><th>Entidade</th><th>Modalidade</th><th>Sessão</th><th>Status</th></tr></thead>
            <tbody>
              {listaUF.map((e) => (
                <tr key={e.id} onClick={() => onAbrir(e)}>
                  <td>
                    <button className={`btn-participar-mini ${idsPipeline.has(e.id) ? "ativo" : ""}`} onClick={(ev) => { ev.stopPropagation(); idsPipeline.has(e.id) ? onIrRadar({ ir: "acompanhamento" }) : onParticipar(e); }} title="Participar">
                      <Icon nome={idsPipeline.has(e.id) ? "kanban" : "mais"} size={14} />
                    </button>
                  </td>
                  <td className="objeto-cell"><div className="objeto-num">{e.numero}</div>{(e.titulo && e.titulo !== e.numero ? e.titulo + " — " : "") + e.objeto.slice(0, 110)}{e.objeto.length > 110 ? "…" : ""}</td>
                  <td><span className={`chip ${chipEntidade(e.entidade)}`}>{e.entidade}</span></td>
                  <td style={{ fontSize: 12 }}>{e.modalidade}</td>
                  <td>{fmtData(e.dataAbertura)}</td>
                  <td><span className={`chip ${chipStatus(e.status)}`}>{e.status}</span></td>
                </tr>
              ))}
              {listaUF.length === 0 && <tr><td colSpan={6} className="empty-row">Nenhum processo em {ufSel} com esse filtro.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* Gráficos — refletem o estado selecionado no mapa quando houver */}
      <div className="graficos-grid">
        <div className="grafico-card">
          <div className="grafico-titulo"><Icon nome="tabela" size={13} /> Processos por status{ufSel ? <span className="grafico-uf">{ufSel}</span> : null}</div>
          <GraficoBarras dados={porStatus} />
        </div>
        <div className="grafico-card">
          <div className="grafico-titulo"><Icon nome="kanban" size={13} /> Processos por entidade{ufSel ? <span className="grafico-uf">{ufSel}</span> : null}</div>
          <GraficoDonut dados={porEntidade} titulo={ufSel || "total"} />
        </div>
        <div className="grafico-card">
          <div className="grafico-titulo"><Icon nome="radar" size={13} /> Processos por estado</div>
          <GraficoPizza dados={porEstado} destaque={ufSel} />
        </div>
      </div>
    </>
  );
}

/* ---------- Módulo de Acompanhamento (Kanban / Calendário / Tabela) ---------- */

function faseNome(id) { return FASES_PIPELINE.find((f) => f.id === id)?.nome || id; }
function faseIndex(id) { return FASES_PIPELINE.findIndex((f) => f.id === id); }

function progressoChecklist(p) {
  if (!p.checklist?.length) return 0;
  return Math.round((p.checklist.filter((c) => c.feito).length / p.checklist.length) * 100);
}

function CardProcesso({ p, onAbrir, onMover, compacto }) {
  const dias = diasAte(p.dataAbertura);
  const urgente = dias !== null && dias >= 0 && dias <= 7 && p.fase !== "finalizado";
  const prog = progressoChecklist(p);
  const i = faseIndex(p.fase);
  return (
    <div className="kb-card" onClick={() => onAbrir(p.id)}>
      <div className="kb-card-top">
        <span className={`chip ${chipEntidade(p.entidade)}`}>{p.entidade}</span>
        {p.resultado && p.resultado !== "Em andamento"
          ? <span className={`chip ${p.resultado.startsWith("Vencido") ? "chip-aberto" : "chip-erro"}`}>{p.resultado}</span>
          : urgente && <span className="chip chip-erro">{dias === 0 ? "sessão hoje" : `${dias}d`}</span>}
      </div>
      <div className="kb-num">{p.numero}</div>
      <div className="kb-obj">{(p.titulo && p.titulo !== p.numero ? p.titulo + " — " : "") + p.objeto.slice(0, 110)}{p.objeto.length > 110 ? "…" : ""}</div>
      <div className="kb-meta">
        <span title="Data da sessão"><Icon nome="calendario" size={12} /> {p.dataAbertura ? new Date(p.dataAbertura + "T12:00:00").toLocaleDateString("pt-BR") : "—"}</span>
        <span title="Sua proposta">{p.valorProposta ? `R$ ${p.valorProposta}` : (p.valorReferencia ? `ref. ${fmtBRL(p.valorReferencia)}` : "s/ valor")}</span>
      </div>
      <div className="kb-prog"><div className="kb-prog-bar" style={{ width: `${prog}%` }} /></div>
      <div className="kb-prog-label">{prog}% documentos · {(p.checklist || []).filter((c) => c.docId).length} anexo(s) · {p.uf}</div>
      {!compacto && (
        <div className="kb-mover" onClick={(e) => e.stopPropagation()}>
          <button disabled={i === 0} onClick={() => onMover(p.id, -1)} title="Fase anterior">‹</button>
          <span>{faseNome(p.fase)}</span>
          <button disabled={i === FASES_PIPELINE.length - 1} onClick={() => onMover(p.id, 1)} title="Próxima fase">›</button>
        </div>
      )}
    </div>
  );
}

function KanbanView({ pipeline, onAbrir, onMover }) {
  return (
    <div className="kanban-scroll">
      <div className="kanban">
        {FASES_PIPELINE.map((f) => {
          const cards = pipeline.filter((p) => p.fase === f.id);
          return (
            <div key={f.id} className="kb-coluna">
              <div className="kb-col-head">
                <Icon nome={f.icone} size={14} /> {f.nome}
                <span className="kb-col-count">{cards.length}</span>
              </div>
              <div className="kb-col-body">
                {cards.map((p) => <CardProcesso key={p.id} p={p} onAbrir={onAbrir} onMover={onMover} />)}
                {cards.length === 0 && <div className="kb-vazio">—</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TabelaPipeView({ pipeline, onAbrir }) {
  const ordenado = [...pipeline].sort((a, b) => faseIndex(a.fase) - faseIndex(b.fase) || (a.dataAbertura || "") < (b.dataAbertura || "") ? -1 : 1);
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr><th>Fase</th><th>Instituição</th><th>Processo / Objeto</th><th>Proposta</th><th>Sessão</th><th>Docs</th></tr>
        </thead>
        <tbody>
          {ordenado.map((p) => (
            <tr key={p.id} onClick={() => onAbrir(p.id)}>
              <td><span className="chip chip-andamento">{faseNome(p.fase)}</span></td>
              <td><span className={`chip ${chipEntidade(p.entidade)}`}>{p.entidade}</span> <span style={{ fontSize: 11, color: "var(--muted)" }}>{p.uf}</span></td>
              <td className="objeto-cell"><div className="objeto-num">{p.numero}</div>{p.objeto.slice(0, 120)}{p.objeto.length > 120 ? "…" : ""}</td>
              <td className="valor-cell">{p.valorProposta ? `R$ ${p.valorProposta}` : "—"}</td>
              <td>{p.dataAbertura ? new Date(p.dataAbertura + "T12:00:00").toLocaleDateString("pt-BR") : "—"}</td>
              <td>{progressoChecklist(p)}%</td>
            </tr>
          ))}
          {ordenado.length === 0 && <tr><td colSpan={6} className="empty-row">Nenhum processo em acompanhamento.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function CalendarioView({ pipeline, onAbrir }) {
  const [refMes, setRefMes] = useState(() => { const d = new Date(); return { ano: d.getFullYear(), mes: d.getMonth() }; });
  const primeiro = new Date(refMes.ano, refMes.mes, 1);
  const diaSemanaInicio = primeiro.getDay();
  const diasNoMes = new Date(refMes.ano, refMes.mes + 1, 0).getDate();
  const nomeMes = primeiro.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  const porDia = {};
  for (const p of pipeline) {
    if (!p.dataAbertura) continue;
    const d = new Date(p.dataAbertura + "T12:00:00");
    if (d.getFullYear() === refMes.ano && d.getMonth() === refMes.mes) {
      const k = d.getDate();
      (porDia[k] = porDia[k] || []).push(p);
    }
  }
  const celulas = [];
  for (let i = 0; i < diaSemanaInicio; i++) celulas.push(null);
  for (let d = 1; d <= diasNoMes; d++) celulas.push(d);
  const hoje = new Date();
  const ehHoje = (d) => hoje.getFullYear() === refMes.ano && hoje.getMonth() === refMes.mes && hoje.getDate() === d;

  return (
    <div className="cal-wrap">
      <div className="cal-nav">
        <button className="pag-btn" onClick={() => setRefMes((m) => ({ ano: m.mes === 0 ? m.ano - 1 : m.ano, mes: m.mes === 0 ? 11 : m.mes - 1 }))}>‹ Anterior</button>
        <span className="cal-mes">{nomeMes}</span>
        <button className="pag-btn" onClick={() => setRefMes((m) => ({ ano: m.mes === 11 ? m.ano + 1 : m.ano, mes: m.mes === 11 ? 0 : m.mes + 1 }))}>Próximo ›</button>
      </div>
      <div className="cal-grid">
        {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d) => <div key={d} className="cal-dow">{d}</div>)}
        {celulas.map((d, i) => (
          <div key={i} className={`cal-cel ${d === null ? "vazia" : ""} ${d && ehHoje(d) ? "hoje" : ""}`}>
            {d && <div className="cal-dia">{d}</div>}
            {d && (porDia[d] || []).map((p) => (
              <button key={p.id} className={`cal-ev chip ${chipEntidade(p.entidade)}`} onClick={() => onAbrir(p.id)} title={`${p.numero} — ${p.objeto.slice(0, 60)}`}>
                {p.entidade} {p.numero}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function PainelAcompanhamento({ pipeline, visao, onVisao, onAbrir, onMover, onIrRadar }) {
  const abertos = pipeline.filter((p) => p.fase !== "finalizado").length;
  const proximaSessao = pipeline
    .filter((p) => p.dataAbertura && diasAte(p.dataAbertura) >= 0 && p.fase !== "finalizado")
    .sort((a, b) => (a.dataAbertura < b.dataAbertura ? -1 : 1))[0];
  return (
    <>
      <div className="header-row">
        <div>
          <h1 className="page-title"><Icon nome="kanban" size={19} style={{ marginRight: 8, verticalAlign: -2, color: "var(--green)" }} />Gestão de Processos</h1>
          <div className="page-sub">Acompanhe e gerencie cada processo desde a análise até o contrato</div>
        </div>
        <div className="visao-switch">
          <button className={visao === "kanban" ? "on" : ""} onClick={() => onVisao("kanban")}><Icon nome="kanban" size={14} /> Kanban</button>
          <button className={visao === "calendario" ? "on" : ""} onClick={() => onVisao("calendario")}><Icon nome="calendario" size={14} /> Calendário</button>
          <button className={visao === "tabela" ? "on" : ""} onClick={() => onVisao("tabela")}><Icon nome="tabela" size={14} /> Tabela</button>
        </div>
      </div>

      {pipeline.length === 0 ? (
        <div className="cad-card" style={{ textAlign: "center", padding: 40 }}>
          <Icon nome="kanban" size={34} style={{ color: "var(--green)", opacity: 0.5 }} />
          <p style={{ margin: "14px 0 6px", fontWeight: 600 }}>Nenhum processo em acompanhamento ainda</p>
          <p className="cad-hint" style={{ marginBottom: 16 }}>No radar, clique em <b>Participar</b> em qualquer oportunidade para trazê-la ao painel de gestão.</p>
          <button className="btn-ia" onClick={onIrRadar} style={{ display: "inline-flex" }}><Icon nome="radar" size={14} /> Ir para o Radar de Editais</button>
        </div>
      ) : (
        <>
          <div className="stats stats-3">
            <div className="stat-card"><div className="stat-label">Em acompanhamento</div><div className="stat-value">{pipeline.length}</div><div className="stat-note text-muted">{abertos} em andamento</div></div>
            <div className="stat-card"><div className="stat-label">Finalizados</div><div className="stat-value text-green">{pipeline.filter((p) => p.fase === "finalizado").length}</div><div className="stat-note text-muted">concluídos</div></div>
            <div className="stat-card"><div className="stat-label">Próxima sessão</div><div className="stat-value text-amber" style={{ fontSize: 18 }}>{proximaSessao ? new Date(proximaSessao.dataAbertura + "T12:00:00").toLocaleDateString("pt-BR") : "—"}</div><div className="stat-note text-muted">{proximaSessao ? proximaSessao.numero : "sem datas futuras"}</div></div>
          </div>
          {visao === "kanban" && <KanbanView pipeline={pipeline} onAbrir={onAbrir} onMover={onMover} />}
          {visao === "calendario" && <CalendarioView pipeline={pipeline} onAbrir={onAbrir} />}
          {visao === "tabela" && <TabelaPipeView pipeline={pipeline} onAbrir={onAbrir} />}
        </>
      )}
    </>
  );
}

function ModalProcesso({ processo: p, empresa, onFechar, onCampo, onMover, onToggleItem, onAddItem, onRemoverItem, onAnexarItem, onRemoverItemDoc, onRemover }) {
  const [novoItem, setNovoItem] = useState("");
  const i = faseIndex(p.fase);
  const prog = progressoChecklist(p);
  // documentos disponíveis no cadastro da empresa (gerais + certidões com PDF)
  const docsCadastro = [
    ...((empresa?.documentos) || []).map((x) => ({ docId: x.docId, nome: x.nome, origem: "Cadastro" })),
    ...((empresa?.certidoes) || []).filter((c) => c.docId).map((c) => ({ docId: c.docId, nome: c.docNome || c.nome, origem: "Certidão" })),
  ];
  return (
    <>
      <div className="drawer-overlay no-print" onClick={onFechar} />
      <div className="drawer">
        <button className="drawer-close no-print" onClick={onFechar}>✕</button>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span className={`chip ${chipEntidade(p.entidade)}`}>{p.entidade}</span>
          <span className="chip chip-seg">{p.regional}</span>
          <span className="chip chip-andamento">{faseNome(p.fase)}</span>
        </div>
        <h2>{p.titulo || p.objeto.slice(0, 120)}</h2>
        <div className="objeto-num">{p.numero}</div>

        {/* barra de fases */}
        <div className="fase-linha">
          <button className="pag-btn" disabled={i === 0} onClick={() => onMover(p.id, -1)}>‹ Voltar</button>
          <div className="fase-esteira">
            {FASES_PIPELINE.map((f, k) => (
              <span key={f.id} className={`fase-pill ${k < i ? "done" : k === i ? "current" : ""}`}>{k + 1}. {f.nome}</span>
            ))}
          </div>
          <button className="pag-btn" disabled={i === FASES_PIPELINE.length - 1} onClick={() => onMover(p.id, 1)}>Avançar ›</button>
        </div>

        <div className="drawer-meta">
          <div className="meta-item"><b>Modalidade</b>{p.modalidade}</div>
          <div className="meta-item"><b>Segmento</b>{p.segmento}</div>
          <div className="meta-item"><b>Data da sessão</b>{p.dataAbertura ? new Date(p.dataAbertura + "T12:00:00").toLocaleDateString("pt-BR") : "—"}</div>
          <div className="meta-item"><b>Local</b>{p.cidade ? `${p.cidade}/` : ""}{p.uf}</div>
          {p.valorReferencia && <div className="meta-item"><b>Valor de referência</b>{fmtBRL(p.valorReferencia)}</div>}
        </div>

        {/* valor interno (proposta) */}
        <div className="cad-card" style={{ boxShadow: "none" }}>
          <label className="cad-campo">
            <span>Valor da sua proposta (controle interno)</span>
            <input type="text" placeholder="Ex.: 340.000,00" value={p.valorProposta} onChange={(e) => onCampo({ valorProposta: e.target.value })} />
          </label>
        </div>

        {/* checklist de documentos */}
        <div className="section">
          <h3><Icon nome="check" size={12} style={{ verticalAlign: -2, marginRight: 5 }} />Checklist de documentos — {prog}% concluído</h3>
          <div className="kb-prog" style={{ marginBottom: 10 }}><div className="kb-prog-bar" style={{ width: `${prog}%` }} /></div>
          <ul className="check-lista">
            {p.checklist.map((c, idx) => (
              <li key={idx} className={c.feito ? "feito" : ""}>
                <label><input type="checkbox" checked={c.feito} onChange={() => onToggleItem(idx)} /> {c.item}</label>
                <div className="check-anexo">
                  {c.docId ? (
                    <>
                      <button className="chip-anexo" onClick={() => baixarDoc(c.docId, c.docNome || "documento")} title="Baixar documento anexado">
                        <Icon nome="doc" size={11} /> {c.doCadastro ? "do cadastro" : "anexo"}
                      </button>
                      <button className="link-btn cert-remover" onClick={() => onRemoverItemDoc(idx)} title="Desvincular">✕</button>
                    </>
                  ) : (
                    <label className="check-upload" title="Anexar documento a este item">
                      <Icon nome="mais" size={12} /> anexar
                      <input type="file" accept="application/pdf,image/*" style={{ display: "none" }} onChange={(e) => onAnexarItem(idx, e.target.files?.[0])} />
                    </label>
                  )}
                  <button className="link-btn cert-remover" onClick={() => onRemoverItem(idx)} title="Remover item"><Icon nome="x" size={13} /></button>
                </div>
              </li>
            ))}
          </ul>
          <div className="check-add">
            <input type="text" placeholder="Adicionar exigência específica deste edital..." value={novoItem}
              onChange={(e) => setNovoItem(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { onAddItem(novoItem); setNovoItem(""); } }} />
            <button className="btn-secundario" onClick={() => { onAddItem(novoItem); setNovoItem(""); }}>+ Adicionar</button>
          </div>
        </div>

        {/* documentos disponíveis no cadastro */}
        {docsCadastro.length > 0 && (
          <div className="section">
            <h3><Icon nome="doc" size={12} style={{ verticalAlign: -2, marginRight: 5 }} />Documentos disponíveis no cadastro</h3>
            <p className="cad-hint" style={{ marginBottom: 8 }}>Baixe direto aqui os documentos já anexados no Cadastro da Empresa.</p>
            <ul className="docs-lista">
              {docsCadastro.map((doc, k) => (
                <li key={k}>
                  <button className="link-btn" onClick={() => baixarDoc(doc.docId, doc.nome)}>📎 {doc.nome}</button>
                  <span className="doc-tam">{doc.origem}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* desfecho e impugnação — alimentam o Relatório de Processos */}
        <div className="section">
          <h3><Icon nome="check" size={12} style={{ verticalAlign: -2, marginRight: 5 }} />Desfecho e impugnação</h3>
          <div className="cad-grid2">
            <label className="cad-campo">
              <span>Resultado do processo</span>
              <select value={p.resultado || "Em andamento"} onChange={(e) => onCampo({ resultado: e.target.value })}>
                {RESULTADOS.map((r) => <option key={r}>{r}</option>)}
              </select>
            </label>
            <label className="cad-campo">
              <span>Data do desfecho</span>
              <input type="date" value={p.dataDesfecho || ""} onChange={(e) => onCampo({ dataDesfecho: e.target.value })} />
            </label>
          </div>
          <label className="cad-check" style={{ marginTop: 12 }}>
            <input type="checkbox" checked={!!p.impugnacao?.apresentada} onChange={(e) => onCampo({ impugnacao: { ...(p.impugnacao || {}), apresentada: e.target.checked } })} />
            Impugnação / esclarecimento ao edital apresentado
          </label>
          {p.impugnacao?.apresentada && (
            <div className="cad-grid2" style={{ marginTop: 10 }}>
              <label className="cad-campo">
                <span>Data da impugnação</span>
                <input type="date" value={p.impugnacao?.data || ""} onChange={(e) => onCampo({ impugnacao: { ...p.impugnacao, data: e.target.value } })} />
              </label>
              <label className="cad-campo">
                <span>Resultado da impugnação</span>
                <select value={p.impugnacao?.resultado || "Pendente"} onChange={(e) => onCampo({ impugnacao: { ...p.impugnacao, resultado: e.target.value } })}>
                  {RESULTADO_IMPUGNACAO.map((r) => <option key={r}>{r}</option>)}
                </select>
              </label>
            </div>
          )}
        </div>

        {/* anotações */}
        <div className="section">
          <h3><Icon nome="chat" size={12} style={{ verticalAlign: -2, marginRight: 5 }} />Anotações do processo</h3>
          <textarea placeholder="Estratégia de lances, prazos de recurso, contatos, pendências..." value={p.anotacoes} onChange={(e) => onCampo({ anotacoes: e.target.value })} style={{ minHeight: 90 }} />
        </div>

        {p.portal && (
          <div className="section">
            <h3><Icon nome="fonte" size={12} style={{ verticalAlign: -2, marginRight: 5 }} />Portal de origem</h3>
            <a href={p.portal} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>abrir portal do processo ↗</a>
          </div>
        )}

        <div style={{ marginTop: 8 }}>
          <button className="btn-secundario cert-remover" onClick={onRemover} style={{ borderColor: "var(--red)" }}>
            <Icon nome="lixeira" size={14} /> Remover do acompanhamento
          </button>
        </div>
      </div>
    </>
  );
}

/* ---------- Módulo de Relatório de Processos ---------- */
function RelatorioProcessos({ pipeline, onAbrirProcesso, onIrRadar }) {
  const [fEnt, setFEnt] = useState("Todas");
  const [fResultado, setFResultado] = useState("Todos");

  const entidades = useMemo(() => [...new Set(pipeline.map((p) => p.entidade).filter(Boolean))].sort(), [pipeline]);
  const resultadoDe = (p) => p.resultado || "Em andamento";

  const lista = useMemo(() => pipeline.filter((p) => {
    if (fEnt !== "Todas" && p.entidade !== fEnt) return false;
    if (fResultado !== "Todos" && resultadoDe(p) !== fResultado) return false;
    return true;
  }), [pipeline, fEnt, fResultado]);

  const m = useMemo(() => {
    const total = lista.length;
    const emAndamento = lista.filter((p) => resultadoDe(p) === "Em andamento").length;
    const concluidos = total - emAndamento;
    const vitorias = lista.filter((p) => resultadoDe(p) === "Vencido / Contratado").length;
    const decididos = lista.filter((p) => RESULTADO_DECIDE.has(resultadoDe(p))).length;
    const taxa = decididos ? vitorias / decididos : null;
    const valorGanho = lista.filter((p) => resultadoDe(p) === "Vencido / Contratado").reduce((s, p) => s + valorProcesso(p), 0);
    const valorDisputa = lista.filter((p) => resultadoDe(p) === "Em andamento").reduce((s, p) => s + valorProcesso(p), 0);
    const comImpug = lista.filter((p) => p.impugnacao?.apresentada);
    const impugDeferidas = comImpug.filter((p) => /Deferida/.test(p.impugnacao?.resultado || "")).length;
    return { total, emAndamento, concluidos, vitorias, decididos, taxa, valorGanho, valorDisputa, comImpug: comImpug.length, impugDeferidas };
  }, [lista]);

  const porResultado = useMemo(() => {
    const c = {};
    for (const p of lista) { const r = resultadoDe(p); c[r] = (c[r] || 0) + 1; }
    return RESULTADOS.filter((r) => c[r]).map((r) => ({ rotulo: r, valor: c[r], cor: CORES_RESULTADO[r] }));
  }, [lista]);

  const porEntidade = useMemo(() => {
    const c = {};
    for (const p of lista) c[p.entidade] = (c[p.entidade] || 0) + 1;
    return Object.entries(c).map(([k, v]) => ({ rotulo: k, valor: v, cor: corEntidade(k) })).sort((a, b) => b.valor - a.valor);
  }, [lista]);

  const valorPorEntidade = useMemo(() => {
    const c = {};
    for (const p of lista) if (resultadoDe(p) === "Vencido / Contratado") c[p.entidade] = (c[p.entidade] || 0) + valorProcesso(p);
    return Object.entries(c).map(([k, v]) => ({ rotulo: k, valor: Math.round(v), cor: corEntidade(k) })).sort((a, b) => b.valor - a.valor);
  }, [lista]);

  function exportarCSV() {
    const cols = ["Número", "Título/Objeto", "Entidade", "Regional", "UF", "Segmento", "Modalidade", "Fase", "Resultado", "Data desfecho", "Valor proposta", "Valor referência", "Impugnação", "Resultado impugnação"];
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const linhas = lista.map((p) => [
      p.numero, p.titulo || p.objeto || "", p.entidade, p.regional || "", p.uf || "", p.segmento || "", p.modalidade || "",
      faseNome(p.fase), resultadoDe(p), p.dataDesfecho ? fmtData(p.dataDesfecho) : "",
      parseBRL(p.valorProposta) || "", parseBRL(p.valorReferencia) || "",
      p.impugnacao?.apresentada ? "Sim" : "Não", p.impugnacao?.apresentada ? (p.impugnacao?.resultado || "Pendente") : "",
    ].map(esc).join(";"));
    const csv = "﻿" + [cols.map(esc).join(";"), ...linhas].join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `relatorio-processos-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <>
      <div className="header-row">
        <div>
          <h1 className="page-title"><Icon nome="tabela" size={19} style={{ marginRight: 8, verticalAlign: -2, color: "var(--green)" }} />Relatório de Processos</h1>
          <div className="page-sub">Desempenho, valores e desfechos dos processos em gestão</div>
        </div>
        {pipeline.length > 0 && (
          <button className="btn-ia" onClick={exportarCSV} style={{ display: "inline-flex" }}><Icon nome="salvar" size={14} /> Exportar CSV</button>
        )}
      </div>

      {pipeline.length === 0 ? (
        <div className="cad-card" style={{ textAlign: "center", padding: 40 }}>
          <Icon nome="tabela" size={34} style={{ color: "var(--green)", opacity: 0.5 }} />
          <p style={{ margin: "14px 0 6px", fontWeight: 600 }}>Ainda não há processos para relatar</p>
          <p className="cad-hint" style={{ marginBottom: 16 }}>Adicione oportunidades em <b>Gestão de Processos</b> e registre o desfecho de cada uma para alimentar este relatório.</p>
          <button className="btn-ia" onClick={onIrRadar} style={{ display: "inline-flex" }}><Icon nome="radar" size={14} /> Ir para o Radar de Editais</button>
        </div>
      ) : (
        <>
          {/* filtros */}
          <div className="rel-filtros">
            <label className="rel-filtro">
              <span>Entidade</span>
              <select value={fEnt} onChange={(e) => setFEnt(e.target.value)}>
                <option>Todas</option>
                {entidades.map((x) => <option key={x}>{x}</option>)}
              </select>
            </label>
            <label className="rel-filtro">
              <span>Resultado</span>
              <select value={fResultado} onChange={(e) => setFResultado(e.target.value)}>
                <option>Todos</option>
                {RESULTADOS.map((x) => <option key={x}>{x}</option>)}
              </select>
            </label>
            {(fEnt !== "Todas" || fResultado !== "Todos") && (
              <button className="link-btn" onClick={() => { setFEnt("Todas"); setFResultado("Todos"); }}>limpar filtros</button>
            )}
          </div>

          {/* KPIs */}
          <div className="stats stats-rel">
            <div className="stat-card"><div className="stat-label">Processos</div><div className="stat-value">{m.total}</div><div className="stat-note text-muted">{m.emAndamento} em andamento · {m.concluidos} concluído(s)</div></div>
            <div className="stat-card"><div className="stat-label">Taxa de vitória</div><div className="stat-value text-green">{m.taxa == null ? "—" : `${Math.round(m.taxa * 100)}%`}</div><div className="stat-note text-muted">{m.vitorias} de {m.decididos} disputado(s)</div></div>
            <div className="stat-card"><div className="stat-label">Impugnações</div><div className="stat-value text-amber" style={{ fontSize: 22 }}>{m.comImpug}</div><div className="stat-note text-muted">{m.impugDeferidas} deferida(s)</div></div>
            <div className="stat-card"><div className="stat-label">Valor contratado</div><div className="stat-value text-green" style={{ fontSize: 20 }}>{fmtBRL(m.valorGanho)}</div><div className="stat-note text-muted">processos vencidos</div></div>
            <div className="stat-card"><div className="stat-label">Valor em disputa</div><div className="stat-value" style={{ fontSize: 20 }}>{fmtBRL(m.valorDisputa)}</div><div className="stat-note text-muted">em andamento</div></div>
            <div className="stat-card"><div className="stat-label">Ticket médio ganho</div><div className="stat-value" style={{ fontSize: 20 }}>{m.vitorias ? fmtBRL(Math.round(m.valorGanho / m.vitorias)) : "—"}</div><div className="stat-note text-muted">por processo vencido</div></div>
          </div>

          {/* gráficos */}
          <div className="graficos-grid">
            <div className="grafico-card">
              <div className="grafico-titulo"><Icon nome="check" size={13} /> Processos por desfecho</div>
              {porResultado.length ? <GraficoPizza dados={porResultado} /> : <p className="cad-hint">Sem dados.</p>}
            </div>
            <div className="grafico-card">
              <div className="grafico-titulo"><Icon nome="kanban" size={13} /> Processos por entidade</div>
              {porEntidade.length ? <GraficoDonut dados={porEntidade} titulo="total" /> : <p className="cad-hint">Sem dados.</p>}
            </div>
            <div className="grafico-card">
              <div className="grafico-titulo"><Icon nome="bolt" size={13} /> Valor contratado por entidade</div>
              {valorPorEntidade.length
                ? <GraficoBarras dados={valorPorEntidade.map((d) => ({ ...d, rotuloValor: fmtBRL(d.valor) }))} />
                : <p className="cad-hint">Nenhum processo vencido ainda.</p>}
            </div>
          </div>

          {/* tabela detalhada */}
          <div className="table-wrap">
            <div className="table-head">
              <span className="table-title">Detalhamento dos processos</span>
              <span className="table-count">{lista.length} processo(s)</span>
            </div>
            <table>
              <thead><tr><th>Processo / Objeto</th><th>Entidade</th><th>UF</th><th>Fase</th><th>Resultado</th><th>Impugnação</th><th style={{ textAlign: "right" }}>Valor</th></tr></thead>
              <tbody>
                {lista.map((p) => {
                  const r = resultadoDe(p);
                  const cls = r === "Vencido / Contratado" ? "chip-aberto" : r === "Em andamento" ? "chip-andamento" : "chip-erro";
                  return (
                    <tr key={p.id} onClick={() => onAbrirProcesso(p.id)}>
                      <td className="objeto-cell"><div className="objeto-num">{p.numero}</div>{(p.titulo && p.titulo !== p.numero ? p.titulo + " — " : "") + (p.objeto || "").slice(0, 90)}{(p.objeto || "").length > 90 ? "…" : ""}</td>
                      <td><span className={`chip ${chipEntidade(p.entidade)}`}>{p.entidade}</span></td>
                      <td>{p.uf || "—"}</td>
                      <td style={{ fontSize: 12 }}>{faseNome(p.fase)}</td>
                      <td><span className={`chip ${cls}`}>{r}</span>{p.dataDesfecho ? <div className="rel-data">{fmtData(p.dataDesfecho)}</div> : null}</td>
                      <td style={{ fontSize: 12 }}>{p.impugnacao?.apresentada ? (p.impugnacao?.resultado || "Pendente") : "—"}</td>
                      <td className="valor-cell" style={{ textAlign: "right" }}>{valorProcesso(p) ? fmtBRL(valorProcesso(p)) : "—"}</td>
                    </tr>
                  );
                })}
                {lista.length === 0 && <tr><td colSpan={7} className="empty-row">Nenhum processo com esse filtro.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="cad-hint" style={{ marginTop: 10 }}>Registre o <b>resultado</b>, a <b>data do desfecho</b> e eventuais <b>impugnações</b> em cada processo (Gestão de Processos → abrir o card → Desfecho e impugnação) para manter este relatório completo.</p>
        </>
      )}
    </>
  );
}

/* ---------- Cache local de análises (FASE 2) ----------
   Reabrir um edital já analisado é instantâneo e não gasta tokens.
   Chave = edital + hash do dossiê (mudou o cadastro → nova análise). */
function hashCurto(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
const CHAVE_ANALISES = "saggregator_analises";
function lerAnaliseCache(chave) {
  try {
    const m = JSON.parse(localStorage.getItem(CHAVE_ANALISES) || "{}");
    return m[chave]?.analise || null;
  } catch { return null; }
}
function salvarAnaliseCache(chave, analise) {
  try {
    const m = JSON.parse(localStorage.getItem(CHAVE_ANALISES) || "{}");
    m[chave] = { analise, quando: Date.now() };
    // guarda as 8 mais recentes (respeita a quota do localStorage)
    for (const k of Object.keys(m).sort((a, b) => m[b].quando - m[a].quando).slice(8)) delete m[k];
    localStorage.setItem(CHAVE_ANALISES, JSON.stringify(m));
  } catch { /* quota cheia — segue sem cache */ }
}

export default function Home() {
  const [view, setView] = useState("inicio");
  const [baseInicio, setBaseInicio] = useState(null);
  const [favOnly, setFavOnly] = useState(false);
  const [filtros, setFiltros] = useState(FILTRO_INICIAL);
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [selecionado, setSelecionado] = useState(null);
  const [analise, setAnalise] = useState(null);
  const [analisando, setAnalisando] = useState(false);
  const [etapaIA, setEtapaIA] = useState(null); // {id, label} — etapa real emitida pelo backend (SSE)
  const [progressoIA, setProgressoIA] = useState(0); // tokens aproximados já gerados
  const [analiseDoCache, setAnaliseDoCache] = useState(false);
  const [erroIA, setErroIA] = useState(null);
  const [perfil, setPerfil] = useState("");
  const [empresa, setEmpresa] = useState(EMPRESA_VAZIA);
  const [consultandoCnpj, setConsultandoCnpj] = useState(false);
  const [erroCnpj, setErroCnpj] = useState(null);
  const [empresaSalva, setEmpresaSalva] = useState(false);
  const [favoritos, setFavoritos] = useState([]);
  const [filtrosSalvos, setFiltrosSalvos] = useState([]);
  const [chatAberto, setChatAberto] = useState(false);
  const [documentosProcesso, setDocumentosProcesso] = useState([]);
  const [tema, setTema] = useState("claro");
  const [menuAberto, setMenuAberto] = useState(false);
  const [pipeline, setPipeline] = useState([]);
  const [visaoPipe, setVisaoPipe] = useState("kanban"); // kanban | calendario | tabela
  const [processoAberto, setProcessoAberto] = useState(null); // id do processo no modal de gestão

  // tema: lê o que o script inline já aplicou no <html> e permite alternar
  useEffect(() => {
    const atual = document.documentElement.getAttribute("data-tema") || "claro";
    setTema(atual);
  }, []);

  function alternarTema() {
    const novo = tema === "escuro" ? "claro" : "escuro";
    setTema(novo);
    document.documentElement.setAttribute("data-tema", novo);
    try { localStorage.setItem("saggregator_tema", novo); } catch { }
  }

  // anexos do processo: usa os do payload e resolve sob demanda (PNCP)
  useEffect(() => {
    if (!selecionado) return;
    setDocumentosProcesso(selecionado.documentos || []);
    if (!(selecionado.documentos || []).length) {
      fetch(`/api/documentos?editalId=${encodeURIComponent(selecionado.id)}`)
        .then((r) => r.json())
        .then((j) => setDocumentosProcesso(j.documentos || []))
        .catch(() => { });
    }
  }, [selecionado]);

  useEffect(() => {
    setPerfil(localStorage.getItem("saggregator_perfil") || "");
    try { setFavoritos(JSON.parse(localStorage.getItem("saggregator_favoritos") || "[]")); } catch { }
    try { setFiltrosSalvos(JSON.parse(localStorage.getItem("saggregator_filtros") || "[]")); } catch { }
    try {
      const emp = JSON.parse(localStorage.getItem("saggregator_empresa") || "null");
      if (emp) setEmpresa({ ...EMPRESA_VAZIA, ...emp, questionario: { ...EMPRESA_VAZIA.questionario, ...(emp.questionario || {}) }, interesses: { ...EMPRESA_VAZIA.interesses, ...(emp.interesses || {}) } });
      else {
        // migra o perfil de texto livre antigo, se houver
        const antigo = localStorage.getItem("saggregator_perfil");
        if (antigo) setEmpresa((e) => ({ ...e, textoLivre: antigo }));
      }
    } catch { }
    try { setPipeline(JSON.parse(localStorage.getItem("saggregator_pipeline") || "[]")); } catch { }
  }, []);

  // base completa (sem filtros) para a Página Inicial — reusa o cache de 30 min do servidor
  useEffect(() => {
    fetch("/api/editais").then((r) => r.json()).then(setBaseInicio).catch(() => { });
  }, []);

  // reconsulta o CNPJ na Receita a cada 30 min quando o cadastro está ativo
  useEffect(() => {
    if (!empresa.dados?.cnpjNumeros) return;
    const idade = Date.now() - new Date(empresa.dados.atualizadoEm || 0).getTime();
    if (idade > 30 * 60 * 1000) consultarCnpj(empresa.dados.cnpjNumeros, true);
    const timer = setInterval(() => consultarCnpj(empresa.dados.cnpjNumeros, true), 30 * 60 * 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresa.dados?.cnpjNumeros]);

  useEffect(() => {
    const params = new URLSearchParams();
    Object.entries(filtros).forEach(([k, v]) => v && params.set(k, v));
    setCarregando(true);
    fetch(`/api/editais?${params}`)
      .then((r) => r.json())
      .then(setDados)
      .catch(() => setDados(null))
      .finally(() => setCarregando(false));
  }, [filtros]);

  const [pagina, setPagina] = useState(1);
  const [soInteresses, setSoInteresses] = useState(false);

  const temInteresses = useMemo(() => {
    const i = empresa.interesses;
    return !!(i && (i.entidades?.length || i.segmentos?.length || i.ufs?.length));
  }, [empresa.interesses]);

  // conjunto de ids aderentes aos interesses declarados (para marcar e filtrar)
  const idsAderentes = useMemo(() => {
    if (!dados || !temInteresses) return new Set();
    return new Set(dados.editais.filter((e) => editalAderente(e, empresa.interesses)).map((e) => e.id));
  }, [dados, empresa.interesses, temInteresses]);

  // alerta: abertas aderentes ao interesse ainda não colocadas no acompanhamento
  const alertaInteresse = useMemo(() => {
    if (!dados || !temInteresses) return 0;
    return dados.editais.filter((e) => e.status === "Aberto" && idsAderentes.has(e.id)).length;
  }, [dados, idsAderentes, temInteresses]);

  const editaisVisiveis = useMemo(() => {
    if (!dados) return [];
    let lista = dados.editais;
    if (favOnly) lista = lista.filter((e) => favoritos.includes(e.id));
    if (soInteresses && temInteresses) lista = lista.filter((e) => idsAderentes.has(e.id));
    return lista;
  }, [dados, favOnly, favoritos, soInteresses, temInteresses, idsAderentes]);

  // volta à primeira página quando o conjunto muda
  useEffect(() => { setPagina(1); }, [filtros, favOnly, soInteresses, dados]);

  const totalPaginas = Math.max(1, Math.ceil(editaisVisiveis.length / PAGE_SIZE));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const editaisPagina = useMemo(
    () => editaisVisiveis.slice((paginaAtual - 1) * PAGE_SIZE, paginaAtual * PAGE_SIZE),
    [editaisVisiveis, paginaAtual]
  );

  const stats = useMemo(() => {
    if (!dados) return null;
    const abertos = editaisVisiveis.filter((e) => e.status === "Aberto");
    const urgentes = abertos.filter((e) => {
      const d = diasAte(e.dataAbertura);
      return d !== null && d >= 0 && d <= 7;
    });
    const fontesOk = (dados.fontes || []).filter((f) => f.ok).length;
    const fontesTotal = (dados.fontes || []).length;
    return { total: editaisVisiveis.length, abertos: abertos.length, urgentes: urgentes.length, fontesOk, fontesTotal };
  }, [dados, editaisVisiveis]);

  function toggleFavorito(id, ev) {
    ev?.stopPropagation();
    setFavoritos((prev) => {
      const novo = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      localStorage.setItem("saggregator_favoritos", JSON.stringify(novo));
      return novo;
    });
  }

  function salvarFiltroAtual() {
    const nome = window.prompt("Nome do filtro (ex.: TI abertos em PE):");
    if (!nome?.trim()) return;
    const novo = [...filtrosSalvos.filter((f) => f.nome !== nome.trim()), { nome: nome.trim(), filtros }];
    setFiltrosSalvos(novo);
    localStorage.setItem("saggregator_filtros", JSON.stringify(novo));
  }

  function removerFiltroSalvo(nome, ev) {
    ev.stopPropagation();
    const novo = filtrosSalvos.filter((f) => f.nome !== nome);
    setFiltrosSalvos(novo);
    localStorage.setItem("saggregator_filtros", JSON.stringify(novo));
  }

  function abrirEdital(e) {
    setSelecionado(e);
    setAnalise(null);
    setAnaliseDoCache(false);
    setErroIA(null);
    setChatAberto(false);
  }

  async function analisar(force = false) {
    if (!selecionado) return;
    // cache local: mesmo edital + mesmo cadastro → resultado instantâneo, custo zero
    const chaveCache = `${selecionado.id}|${hashCurto(JSON.stringify(dossieEmpresa() || "") + (perfil || ""))}`;
    if (!force) {
      const cacheada = lerAnaliseCache(chaveCache);
      if (cacheada) {
        setAnalise(cacheada);
        setAnaliseDoCache(true);
        setErroIA(null);
        return;
      }
    }
    setAnalisando(true);
    setErroIA(null);
    setAnalise(null);
    setAnaliseDoCache(false);
    setEtapaIA({ id: "conectando", label: "Preparando a análise" });
    setProgressoIA(0);
    try {
      const r = await fetch("/api/analisar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ editalId: selecionado.id, empresa: dossieEmpresa(), perfilEmpresa: perfil }),
      });
      if (!r.ok || !r.body) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `Erro ${r.status}`);
      }
      // consome o SSE: etapas reais do backend + progresso + resultado
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let recebido = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const blocos = buf.split("\n\n");
        buf = blocos.pop();
        for (const bloco of blocos) {
          const ev = bloco.match(/^event: (.+)$/m)?.[1];
          const dataRaw = bloco.match(/^data: (.+)$/m)?.[1];
          if (!ev || !dataRaw) continue;
          const dados = JSON.parse(dataRaw);
          if (ev === "etapa") setEtapaIA(dados);
          else if (ev === "progresso") setProgressoIA(dados.tokensAprox || 0);
          else if (ev === "resultado") {
            recebido = true;
            setAnalise(dados.analise);
            if (dados.analise && !dados.analise.demo) salvarAnaliseCache(chaveCache, dados.analise);
          } else if (ev === "erro") {
            throw new Error(dados.mensagem || "Falha na análise");
          }
        }
      }
      if (!recebido) throw new Error("A geração foi interrompida — tente novamente.");
    } catch (err) {
      setErroIA(err.message);
    } finally {
      setAnalisando(false);
      setEtapaIA(null);
    }
  }

  function imprimirRelatorio() {
    window.print();
  }

  // ---------- Módulo de acompanhamento (Kanban) ----------

  function persistirPipeline(next) {
    setPipeline(next);
    localStorage.setItem("saggregator_pipeline", JSON.stringify(next));
  }

  const idsPipeline = useMemo(() => new Set(pipeline.map((p) => p.id)), [pipeline]);

  function participar(edital) {
    if (idsPipeline.has(edital.id)) { setView("acompanhamento"); return; }
    // pré-marca no checklist as certidões que a empresa já tem regulares
    const regulares = new Set((empresa.certidoes || []).filter((c) => c.status === "Regular").map((c) => c.id));
    // mapeia item do checklist → certidão do cadastro (para pré-marcar e oferecer o anexo já existente)
    const certPorItem = (item) => {
      if (/CND.*Federal|Dívida Ativa/i.test(item)) return "cnd_federal";
      if (/CRF|FGTS/i.test(item)) return "crf_fgts";
      if (/CNDT|Trabalhista/i.test(item)) return "cndt";
      if (/Estaduais/i.test(item)) return "cnd_estadual";
      if (/Municipais/i.test(item)) return "cnd_municipal";
      if (/Falência/i.test(item)) return "falencia";
      return null;
    };
    const checklist = CHECKLIST_PADRAO.map((item) => {
      const cid = certPorItem(item);
      const cert = cid ? (empresa.certidoes || []).find((c) => c.id === cid) : null;
      // reaproveita o PDF já anexado no cadastro da certidão
      const anexoCadastro = cert?.docId ? { docId: cert.docId, docNome: cert.docNome, doCadastro: true } : {};
      return { item, feito: cid ? regulares.has(cid) : false, docId: null, docNome: null, ...anexoCadastro };
    });
    const novo = {
      id: edital.id,
      fase: "analise",
      entidade: edital.entidade,
      regional: edital.regional,
      numero: edital.numero,
      titulo: edital.titulo || null,
      objeto: (edital.objeto || "").slice(0, 400),
      uf: edital.uf,
      cidade: edital.cidade || null,
      segmento: edital.segmento,
      modalidade: edital.modalidade,
      dataAbertura: edital.dataAbertura || null,
      valorReferencia: edital.valorContratado || edital.valorEstimado || null,
      portal: edital.portal || null,
      // controle do usuário
      valorProposta: "",
      checklist,
      anotacoes: "",
      adicionadoEm: new Date().toISOString(),
      atualizadoEm: new Date().toISOString(),
    };
    persistirPipeline([novo, ...pipeline]);
    setView("acompanhamento");
  }

  function atualizarProcesso(id, patch) {
    persistirPipeline(pipeline.map((p) => (p.id === id ? { ...p, ...patch, atualizadoEm: new Date().toISOString() } : p)));
  }
  function moverFase(id, direcao) {
    const p = pipeline.find((x) => x.id === id);
    if (!p) return;
    const i = FASES_PIPELINE.findIndex((f) => f.id === p.fase);
    const j = Math.max(0, Math.min(FASES_PIPELINE.length - 1, i + direcao));
    if (i !== j) atualizarProcesso(id, { fase: FASES_PIPELINE[j].id });
  }
  function removerProcesso(id) {
    persistirPipeline(pipeline.filter((p) => p.id !== id));
    if (processoAberto === id) setProcessoAberto(null);
  }
  function toggleChecklist(id, idx) {
    const p = pipeline.find((x) => x.id === id);
    if (!p) return;
    atualizarProcesso(id, { checklist: p.checklist.map((c, k) => (k === idx ? { ...c, feito: !c.feito } : c)) });
  }
  function addChecklistItem(id, texto) {
    const p = pipeline.find((x) => x.id === id);
    if (!p || !texto.trim()) return;
    atualizarProcesso(id, { checklist: [...p.checklist, { item: texto.trim(), feito: false }] });
  }
  function removerChecklistItem(id, idx) {
    const p = pipeline.find((x) => x.id === id);
    if (!p) return;
    atualizarProcesso(id, { checklist: p.checklist.filter((_, k) => k !== idx) });
  }
  async function anexarChecklistDoc(id, idx, file) {
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) { alert("Arquivo acima de 15 MB."); return; }
    const p = pipeline.find((x) => x.id === id);
    if (!p) return;
    const docId = `chk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await salvarDoc(docId, file);
    atualizarProcesso(id, { checklist: p.checklist.map((c, k) => (k === idx ? { ...c, docId, docNome: file.name, doCadastro: false, feito: true } : c)) });
  }
  async function removerChecklistDoc(id, idx) {
    const p = pipeline.find((x) => x.id === id);
    if (!p) return;
    const c = p.checklist[idx];
    // não apaga o blob se o anexo veio do cadastro (é compartilhado)
    if (c?.docId && !c.doCadastro) await removerDoc(c.docId).catch(() => { });
    atualizarProcesso(id, { checklist: p.checklist.map((x, k) => (k === idx ? { ...x, docId: null, docNome: null, doCadastro: false } : x)) });
  }

  // ---------- Módulo de cadastro da empresa ----------

  function persistirEmpresa(next) {
    setEmpresa(next);
    // não guarda blobs no localStorage — só metadados
    const { cnpjInput, ...serializavel } = next;
    localStorage.setItem("saggregator_empresa", JSON.stringify(serializavel));
  }

  // dossiê enviado à IA (sem o campo de digitação)
  function dossieEmpresa() {
    const { cnpjInput, ...rest } = empresa;
    return rest;
  }

  async function consultarCnpj(cnpjArg, silencioso = false) {
    const alvo = limparCNPJ(cnpjArg ?? empresa.cnpjInput);
    if (alvo.length !== 14) { setErroCnpj("Digite os 14 dígitos do CNPJ."); return; }
    if (!silencioso) { setConsultandoCnpj(true); setErroCnpj(null); }
    try {
      const r = await fetch(`/api/cnpj?cnpj=${alvo}`);
      const j = await r.json();
      if (!r.ok || j.erro) throw new Error(j.erro || `Erro ${r.status}`);
      setEmpresa((prev) => {
        // mescla certidões novas mantendo status/validade já preenchidos
        const antigas = prev.certidoes || [];
        const certidoes = j.certidoes.map((c) => {
          const old = antigas.find((x) => x.id === c.id);
          return { ...c, status: old?.status || "Não informada", validade: old?.validade || "", docId: old?.docId || null, docNome: old?.docNome || null };
        });
        const next = { ...prev, dados: j.dados, certidoes, cnpjInput: formatarCNPJ(alvo) };
        const { cnpjInput, ...serializavel } = next;
        localStorage.setItem("saggregator_empresa", JSON.stringify(serializavel));
        return next;
      });
    } catch (err) {
      if (!silencioso) setErroCnpj(err.message);
    } finally {
      if (!silencioso) setConsultandoCnpj(false);
    }
  }

  function atualizarCertidao(id, campo, valor) {
    persistirEmpresa({
      ...empresa,
      certidoes: empresa.certidoes.map((c) => (c.id === id ? { ...c, [campo]: valor } : c)),
    });
  }

  function setQuestionario(campo, valor) {
    persistirEmpresa({ ...empresa, questionario: { ...empresa.questionario, [campo]: valor } });
  }

  function toggleInteresse(tipo, valor) {
    const atual = empresa.interesses?.[tipo] || [];
    const proximo = atual.includes(valor) ? atual.filter((x) => x !== valor) : [...atual, valor];
    persistirEmpresa({ ...empresa, interesses: { ...(empresa.interesses || { entidades: [], ufs: [], segmentos: [] }), [tipo]: proximo } });
  }

  function addAtestado() {
    persistirEmpresa({ ...empresa, atestados: [...empresa.atestados, { objeto: "", orgao: "", ano: "", valor: "" }] });
  }
  function setAtestado(i, campo, valor) {
    persistirEmpresa({ ...empresa, atestados: empresa.atestados.map((a, k) => (k === i ? { ...a, [campo]: valor } : a)) });
  }
  function removerAtestado(i) {
    persistirEmpresa({ ...empresa, atestados: empresa.atestados.filter((_, k) => k !== i) });
  }

  async function anexarDoc(tipo, file, certidaoId) {
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) { alert("Arquivo acima de 15 MB. Comprima ou anexe um menor."); return; }
    const id = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await salvarDoc(id, file);
    if (certidaoId) {
      atualizarCertidao(certidaoId, "docId", id);
      atualizarCertidao(certidaoId, "docNome", file.name);
    } else {
      persistirEmpresa({ ...empresa, documentos: [...empresa.documentos, { docId: id, nome: file.name, tipo, tamanho: file.size }] });
    }
  }
  async function removerDocAnexo(docId, ondeCertidaoId) {
    await removerDoc(docId).catch(() => { });
    if (ondeCertidaoId) {
      atualizarCertidao(ondeCertidaoId, "docId", null);
      atualizarCertidao(ondeCertidaoId, "docNome", null);
    } else {
      persistirEmpresa({ ...empresa, documentos: empresa.documentos.filter((d) => d.docId !== docId) });
    }
  }

  function salvarEmpresa() {
    persistirEmpresa({ ...empresa, textoLivre: empresa.textoLivre });
    setEmpresaSalva(true);
    setTimeout(() => setEmpresaSalva(false), 2500);
  }

  const f = dados?.filtros;
  const fontesComErro = (dados?.fontes || []).filter((x) => !x.ok);
  const faseIdx = selecionado
    ? selecionado.fase === "Em execução"
      ? 1
      : selecionado.fase === "Processo interrompido"
        ? -1
        : FASES.indexOf(selecionado.fase)
    : -1;

  function irPara(v, fav = false) {
    setView(v);
    setFavOnly(fav);
    setMenuAberto(false);
  }

  // navega da Página Inicial para o Radar aplicando os filtros escolhidos
  function irRadarComFiltro(opts = {}) {
    if (opts.ir === "acompanhamento") { setView("acompanhamento"); return; }
    setFiltros({
      ...FILTRO_INICIAL,
      entidade: opts.entidade || "Todas",
      status: opts.status && opts.status !== "Todos" ? opts.status : "Todos",
      uf: opts.uf || "Todos",
    });
    setFavOnly(false);
    setView("dashboard");
  }

  return (
    <div className="app">
      {/* Barra superior — só em mobile/tablet */}
      <header className="topbar no-print">
        <button className="topbar-menu" onClick={() => setMenuAberto(true)} aria-label="Abrir menu">
          <Icon nome="menu" size={20} />
        </button>
        <div className="logo" style={{ margin: 0 }}>
          <button className="logo-link" onClick={() => irPara("inicio")} title="Página inicial" aria-label="Ir para a página inicial">
            <LogoMark size={28} />
            <div className="logo-name" style={{ fontSize: 15 }}><span className="s-green">S</span>-Aggregator</div>
          </button>
        </div>
        <button className="tema-toggle" onClick={alternarTema} aria-label="Alternar tema" title={tema === "escuro" ? "Modo claro" : "Modo escuro"}>
          <Icon nome={tema === "escuro" ? "sol" : "lua"} size={18} />
        </button>
      </header>

      {menuAberto && <div className="menu-overlay no-print" onClick={() => setMenuAberto(false)} />}

      <aside className={`sidebar no-print ${menuAberto ? "aberto" : ""}`}>
        <div className="logo">
          <button className="logo-link" onClick={() => irPara("inicio")} title="Página inicial" aria-label="Ir para a página inicial">
            <LogoMark />
            <div className="logo-name"><span className="s-green">S</span>-Aggregator</div>
          </button>
          <button className="sidebar-fechar" onClick={() => setMenuAberto(false)} aria-label="Fechar menu"><Icon nome="x" size={16} /></button>
        </div>
        <div className="logo-tagline">Agregando oportunidades de negócios do Sistema S</div>

        <div className="nav-label">PRINCIPAL</div>
        <button className={`nav-item ${view === "inicio" ? "active" : ""}`} onClick={() => irPara("inicio")}>
          <Icon nome="home" /> Início
        </button>
        <button className={`nav-item ${view === "dashboard" && !favOnly ? "active" : ""}`} onClick={() => irPara("dashboard", false)}>
          <Icon nome="radar" /> Radar de Editais
          {stats && !favOnly && <span className="nav-badge">{stats.abertos}</span>}
        </button>
        <button className={`nav-item ${view === "dashboard" && favOnly ? "active" : ""}`} onClick={() => irPara("dashboard", true)}>
          <Icon nome="star" /> Favoritos
          {favoritos.length > 0 && <span className="nav-badge">{favoritos.length}</span>}
        </button>
        <button className={`nav-item ${view === "acompanhamento" ? "active" : ""}`} onClick={() => irPara("acompanhamento")}>
          <Icon nome="kanban" /> Gestão de Processos
          {pipeline.length > 0 && <span className="nav-badge">{pipeline.length}</span>}
        </button>
        <button className={`nav-item ${view === "relatorio" ? "active" : ""}`} onClick={() => irPara("relatorio")}>
          <Icon nome="tabela" /> Relatório de Processos
        </button>
        <button className={`nav-item ${view === "perfil" ? "active" : ""}`} onClick={() => irPara("perfil")}>
          <Icon nome="perfil" /> Cadastro da Empresa
        </button>
        <button className={`nav-item ${view === "fontes" ? "active" : ""}`} onClick={() => irPara("fontes")}>
          <Icon nome="fonte" /> Fontes de Dados
        </button>

        <div className="nav-label">APARÊNCIA</div>
        <button className="nav-item" onClick={alternarTema}>
          <Icon nome={tema === "escuro" ? "sol" : "lua"} /> {tema === "escuro" ? "Modo claro" : "Modo escuro"}
        </button>

        <div className="nav-label">ESCOPO</div>
        <div className="escopo-logos">
          {Object.entries(LOGOS).map(([nome, src]) => (
            <img key={nome} src={src} alt={nome} title={nome} />
          ))}
        </div>
        <div className="nav-item" style={{ cursor: "default", fontSize: 11 }}>
          Todos os 27 estados · SESI · SENAI · SESC · SENAC · SENAR · SEBRAE · SEST/SENAT · SESCOOP · Correios
        </div>
        <div className="sidebar-footer">
          Dados oficiais coletados dos<br />portais de transparência, PNCP e Correios<br />Atualização: a cada 30 min
        </div>
      </aside>

      <main className="main no-print">
        {view === "inicio" && (
          <PaginaInicial
            base={baseInicio}
            interesses={empresa.interesses}
            temInteresses={temInteresses}
            onAbrir={(e) => abrirEdital(e)}
            onIrRadar={irRadarComFiltro}
            idsPipeline={idsPipeline}
            onParticipar={participar}
          />
        )}

        {view === "perfil" && (
          <CadastroEmpresa
            empresa={empresa}
            consultando={consultandoCnpj}
            erroCnpj={erroCnpj}
            salva={empresaSalva}
            onCnpjInput={(v) => setEmpresa({ ...empresa, cnpjInput: v })}
            onConsultar={() => consultarCnpj()}
            onCertidao={atualizarCertidao}
            onQuestionario={setQuestionario}
            onInteresse={toggleInteresse}
            onAddAtestado={addAtestado}
            onSetAtestado={setAtestado}
            onRemoverAtestado={removerAtestado}
            onAnexar={anexarDoc}
            onRemoverDoc={removerDocAnexo}
            onTextoLivre={(v) => setEmpresa({ ...empresa, textoLivre: v })}
            onSalvar={salvarEmpresa}
          />
        )}

        {view === "fontes" && (
          <>
            <div className="header-row">
              <div>
                <h1 className="page-title"><Icon nome="fonte" size={19} style={{ marginRight: 8, verticalAlign: -2, color: "var(--green)" }} />Fontes de Dados</h1>
                <div className="page-sub">Coletores oficiais · atualização a cada 30 minutos</div>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Fonte / Regional</th><th>Status</th><th>Itens coletados</th></tr>
                </thead>
                <tbody>
                  {(dados?.fontes || []).map((ft, i) => (
                    <tr key={i} style={{ cursor: "default" }}>
                      <td>
                        {ft.nome}
                        {ft.link && (
                          <div><a href={ft.link} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>portal oficial ↗</a></div>
                        )}
                      </td>
                      <td>
                        <span className={`chip ${ft.ok ? "chip-aberto" : "chip-erro"}`}>
                          {ft.ok ? "ATIVA" : "INDISPONÍVEL"}
                        </span>
                        {!ft.ok && <div style={{ fontSize: 11, color: "var(--muted-2)", marginTop: 4 }}>{ft.erro}</div>}
                      </td>
                      <td>{ft.ok ? ft.itens : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {dados?.coletadoEm && (
              <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 12 }}>
                Última coleta: {new Date(dados.coletadoEm).toLocaleString("pt-BR")}
              </p>
            )}
          </>
        )}

        {view === "acompanhamento" && (
          <PainelAcompanhamento
            pipeline={pipeline}
            visao={visaoPipe}
            onVisao={setVisaoPipe}
            onAbrir={setProcessoAberto}
            onMover={moverFase}
            onIrRadar={() => irPara("dashboard", false)}
          />
        )}

        {view === "relatorio" && (
          <RelatorioProcessos
            pipeline={pipeline}
            onAbrirProcesso={setProcessoAberto}
            onIrRadar={() => irPara("dashboard", false)}
          />
        )}

        {view === "dashboard" && (
          <>
            <div className="header-row">
              <div>
                <h1 className="page-title">
                  <Icon nome={favOnly ? "star" : "radar"} size={19} style={{ marginRight: 8, verticalAlign: -2, color: "var(--green)" }} />
                  {favOnly ? "Meus Favoritos" : "Radar de Oportunidades"}
                </h1>
                <div className="page-sub">Dados oficiais · SESI · SENAI · SESC · SENAC · SENAR · SEBRAE</div>
              </div>
              {fontesComErro.length > 0 && (
                <div className="demo-banner">
                  ⚠ {fontesComErro.length} fonte(s) indisponível(is) — ver aba Fontes de Dados
                </div>
              )}
            </div>

            {alertaInteresse > 0 && !favOnly && (
              <button className={`alerta-interesse ${soInteresses ? "ativo" : ""}`} onClick={() => setSoInteresses((v) => !v)}>
                <Icon nome="radar" size={16} />
                <span><b>{alertaInteresse} oportunidade(s) aberta(s)</b> aderente(s) ao seu perfil de interesse</span>
                <span className="alerta-acao">{soInteresses ? "mostrar todas" : "ver só estas ›"}</span>
              </button>
            )}

            {stats && (
              <div className="stats">
                <div className="stat-card">
                  <div className="stat-label">{favOnly ? "Favoritos no filtro" : soInteresses ? "Aderentes ao interesse" : "Editais no filtro"}</div>
                  <div className="stat-value">{stats.total}</div>
                  <div className="stat-note text-muted">de {dados.totalBase} monitorados</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Abertos (recebendo propostas)</div>
                  <div className="stat-value text-green">{stats.abertos}</div>
                  <div className="stat-note text-muted">no filtro atual</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Prazo em até 7 dias</div>
                  <div className="stat-value text-amber">{stats.urgentes}</div>
                  <div className="stat-note text-amber">⚠ ação urgente</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Fontes ativas</div>
                  <div className="stat-value text-blue">{stats.fontesOk}/{stats.fontesTotal}</div>
                  <div className="stat-note text-muted">portais oficiais + PNCP</div>
                </div>
              </div>
            )}

            <div className="filters">
              <div className="filter-group">
                <label>Entidade</label>
                <select value={filtros.entidade} onChange={(e) => setFiltros({ ...filtros, entidade: e.target.value })}>
                  <option>Todas</option>
                  {f?.entidades.map((x) => <option key={x}>{x}</option>)}
                </select>
              </div>
              <div className="filter-group">
                <label>Estado (UF)</label>
                <select value={filtros.uf} onChange={(e) => setFiltros({ ...filtros, uf: e.target.value })}>
                  <option>Todos</option>
                  {f?.ufs.map((x) => <option key={x}>{x}</option>)}
                </select>
              </div>
              <div className="filter-group">
                <label>Tipo (modalidade)</label>
                <select value={filtros.modalidade} onChange={(e) => setFiltros({ ...filtros, modalidade: e.target.value })}>
                  <option>Todas</option>
                  {f?.modalidades.map((x) => <option key={x}>{x}</option>)}
                </select>
              </div>
              <div className="filter-group">
                <label>Segmento</label>
                <select value={filtros.segmento} onChange={(e) => setFiltros({ ...filtros, segmento: e.target.value })}>
                  <option>Todos</option>
                  {f?.segmentos.map((x) => <option key={x}>{x}</option>)}
                </select>
              </div>
              <div className="filter-group">
                <label>Status</label>
                <select value={filtros.status} onChange={(e) => setFiltros({ ...filtros, status: e.target.value })}>
                  <option>Todos</option>
                  {f?.status?.map((x) => <option key={x}>{x}</option>)}
                </select>
              </div>
              <div className="filter-group filter-search">
                <label>Busca livre</label>
                <input
                  type="text"
                  placeholder="Objeto, nº do edital, regional..."
                  value={filtros.busca}
                  onChange={(e) => setFiltros({ ...filtros, busca: e.target.value })}
                />
              </div>
              {temInteresses && (
                <button className={`btn-clear ${soInteresses ? "btn-clear-on" : ""}`} onClick={() => setSoInteresses((v) => !v)} title="Filtrar pelos seus interesses declarados">
                  🎯 Meus interesses
                </button>
              )}
              <button className="btn-clear" onClick={salvarFiltroAtual} title="Salvar a combinação atual de filtros">
                <Icon nome="salvar" size={13} style={{ verticalAlign: -2, marginRight: 4 }} />Salvar filtro
              </button>
              <button className="btn-clear" onClick={() => setFiltros(FILTRO_INICIAL)}>Limpar</button>
            </div>

            {filtrosSalvos.length > 0 && (
              <div className="filtros-salvos no-print">
                <span className="filtros-salvos-label"><Icon nome="salvar" size={12} style={{ verticalAlign: -2 }} /> Filtros salvos:</span>
                {filtrosSalvos.map((fs) => (
                  <button key={fs.nome} className="filtro-chip" onClick={() => setFiltros({ ...FILTRO_INICIAL, ...fs.filtros })} title="Aplicar filtro">
                    {fs.nome}
                    <span className="filtro-chip-x" onClick={(ev) => removerFiltroSalvo(fs.nome, ev)} title="Excluir">✕</span>
                  </button>
                ))}
              </div>
            )}

            <div className="table-wrap">
              <div className="table-head">
                <span className="table-title">{favOnly ? "Processos favoritos" : "Editais"}</span>
                <span className="table-count">
                  {carregando
                    ? "coletando dados dos portais..."
                    : dados
                      ? editaisVisiveis.length === 0
                        ? "0 resultado(s)"
                        : `${(paginaAtual - 1) * PAGE_SIZE + 1}–${Math.min(paginaAtual * PAGE_SIZE, editaisVisiveis.length)} de ${editaisVisiveis.length} · pág. ${paginaAtual}/${totalPaginas}`
                      : "falha ao carregar"}
                </span>
              </div>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 30 }}></th>
                    <th>Edital / Objeto</th>
                    <th>Entidade</th>
                    <th>UF</th>
                    <th>Segmento</th>
                    <th>Modalidade</th>
                    <th>Valor</th>
                    <th>Abertura / Prazo</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {editaisPagina.map((e) => {
                    const dias = diasAte(e.dataAbertura);
                    const urgente = e.status === "Aberto" && dias !== null && dias >= 0 && dias <= 7;
                    const fav = favoritos.includes(e.id);
                    const aderente = idsAderentes.has(e.id);
                    return (
                      <tr key={e.id} onClick={() => abrirEdital(e)} className={aderente ? "linha-aderente" : ""}>
                        <td>
                          {aderente && <span className="marca-interesse" title="Aderente aos seus interesses">🎯</span>}
                          <div className="acoes-linha">
                            <button className={`btn-fav ${fav ? "ativo" : ""}`} onClick={(ev) => toggleFavorito(e.id, ev)} title={fav ? "Remover dos favoritos" : "Adicionar aos favoritos"}>
                              <Icon nome="star" size={16} />
                            </button>
                            <button
                              className={`btn-participar-mini ${idsPipeline.has(e.id) ? "ativo" : ""}`}
                              onClick={(ev) => { ev.stopPropagation(); idsPipeline.has(e.id) ? setView("acompanhamento") : participar(e); }}
                              title={idsPipeline.has(e.id) ? "Em acompanhamento — abrir painel" : "Participar deste processo"}
                            >
                              <Icon nome={idsPipeline.has(e.id) ? "kanban" : "mais"} size={15} />
                            </button>
                          </div>
                        </td>
                        <td className="objeto-cell">
                          <div className="objeto-num">{e.numero} · {e.regional}</div>
                          {(e.titulo && e.titulo !== e.numero ? e.titulo + " — " : "") + e.objeto.slice(0, 150)}{e.objeto.length > 150 ? "…" : ""}
                        </td>
                        <td><span className={`chip ${chipEntidade(e.entidade)}`}>{e.entidade}</span></td>
                        <td>{e.uf}</td>
                        <td><span className="chip chip-seg">{e.segmento}</span></td>
                        <td style={{ fontSize: 12 }}>{e.modalidade}</td>
                        <td className="valor-cell">{e.valorContratado ? fmtBRL(e.valorContratado) : e.valorEstimado ? fmtBRL(e.valorEstimado) : "—"}</td>
                        <td className={urgente ? "prazo-urgente" : ""}>
                          {fmtData(e.dataAbertura)}
                          {urgente && <div style={{ fontSize: 10 }}>faltam {dias}d</div>}
                        </td>
                        <td><span className={`chip ${chipStatus(e.status)}`}>{e.status}</span></td>
                      </tr>
                    );
                  })}
                  {!carregando && dados && editaisVisiveis.length === 0 && (
                    <tr>
                      <td colSpan={9} className="empty-row">
                        {favOnly
                          ? "Você ainda não favoritou nenhum processo — clique na estrela de um edital para salvá-lo aqui."
                          : "Nenhum edital encontrado com esses filtros. Obs.: SESI/SENAI-RJ está em integração (portal Firjan); SENAC-RJ e SEBRAE-RJ já chegam via PNCP."}
                      </td>
                    </tr>
                  )}
                  {carregando && (
                    <tr><td colSpan={9} className="empty-row">Coletando dados dos portais oficiais…</td></tr>
                  )}
                </tbody>
              </table>

              {!carregando && editaisVisiveis.length > PAGE_SIZE && (
                <div className="paginacao">
                  <button className="pag-btn" disabled={paginaAtual === 1} onClick={() => setPagina(1)}>« Primeira</button>
                  <button className="pag-btn" disabled={paginaAtual === 1} onClick={() => setPagina(paginaAtual - 1)}>‹ Anterior</button>
                  <span className="pag-info">Página <b>{paginaAtual}</b> de {totalPaginas}</span>
                  <button className="pag-btn" disabled={paginaAtual === totalPaginas} onClick={() => setPagina(paginaAtual + 1)}>Próxima ›</button>
                  <button className="pag-btn" disabled={paginaAtual === totalPaginas} onClick={() => setPagina(totalPaginas)}>Última »</button>
                </div>
              )}
            </div>
          </>
        )}
      </main>

      {selecionado && (
        <>
          <div className="drawer-overlay no-print" onClick={() => setSelecionado(null)} />
          <div className="drawer">
            <button className="drawer-close no-print" onClick={() => setSelecionado(null)}>✕</button>

            <table className="print-table">
              <thead className="print-only"><tr><td><PrintHeader entidade={selecionado.entidade} /></td></tr></thead>
              <tfoot className="print-only"><tr><td><PrintFooter /></td></tr></tfoot>
              <tbody><tr><td>

            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <EntidadeLogo entidade={selecionado.entidade} altura={20} />
              <span className="chip chip-seg">{selecionado.regional}</span>
              <span className={`chip ${chipStatus(selecionado.status)}`}>{selecionado.statusOriginal || selecionado.status}</span>
              <button className={`btn-fav grande no-print ${favoritos.includes(selecionado.id) ? "ativo" : ""}`} onClick={(ev) => toggleFavorito(selecionado.id, ev)}>
                <Icon nome="star" size={18} />
                {favoritos.includes(selecionado.id) ? "Favorito" : "Favoritar"}
              </button>
            </div>
            <h2>{selecionado.titulo || selecionado.objeto.slice(0, 120)}</h2>
            {selecionado.numero !== (selecionado.titulo || "") && <div className="objeto-num">{selecionado.numero}</div>}

            <div className="drawer-meta">
              <div className="meta-item"><b>Modalidade</b>{selecionado.modalidadeOriginal || selecionado.modalidade}</div>
              <div className="meta-item"><b>Segmento</b>{selecionado.segmento}</div>
              {selecionado.criterioJulgamento && <div className="meta-item"><b>Julgamento</b>{selecionado.criterioJulgamento}</div>}
              {selecionado.dataPublicacao && <div className="meta-item"><b>Publicação</b>{fmtData(selecionado.dataPublicacao)}</div>}
              <div className="meta-item"><b>Abertura / Prazo</b>{fmtData(selecionado.dataAbertura)}</div>
              {selecionado.dataHomologacao && <div className="meta-item"><b>Homologação</b>{fmtData(selecionado.dataHomologacao)}</div>}
              <div className="meta-item"><b>UF</b>{selecionado.cidade ? `${selecionado.cidade}/` : ""}{selecionado.uf}</div>
            </div>

            {/* Sumário objetivo — imediato, montado com os dados coletados */}
            <div className="sumario-box section">
              <h3><Icon nome="doc" size={12} style={{ verticalAlign: -2, marginRight: 5 }} />Resumo do processo</h3>
              <dl className="sumario-grid">
                <dt>Objeto da contratação</dt>
                <dd>{selecionado.objeto.slice(0, 220)}{selecionado.objeto.length > 220 ? "…" : ""}</dd>
                <dt>Órgão contratante</dt>
                <dd>{selecionado.regional} ({selecionado.cidade ? `${selecionado.cidade}/` : ""}{selecionado.uf})</dd>
                <dt>Modalidade</dt>
                <dd>{selecionado.modalidadeOriginal || selecionado.modalidade}</dd>
                <dt>Tipo de julgamento</dt>
                <dd>{selecionado.criterioJulgamento || "Não identificado nos dados coletados"}</dd>
                <dt>Valor</dt>
                <dd>{selecionado.valorContratado ? `${fmtBRL(selecionado.valorContratado)} (contratado/homologado)` : selecionado.valorEstimado ? `${fmtBRL(selecionado.valorEstimado)} (referência)` : "Não divulgado no portal"}</dd>
                <dt>Data da sessão / prazo</dt>
                <dd>{fmtData(selecionado.dataAbertura)}{selecionado.dataPublicacao ? ` · publicado em ${fmtData(selecionado.dataPublicacao)}` : ""}</dd>
                <dt>Situação</dt>
                <dd>{selecionado.statusOriginal || selecionado.status} — {selecionado.fase}</dd>
                <dt>Plataforma / fonte</dt>
                <dd>{selecionado.fonte}</dd>
              </dl>
            </div>

            {/* Resultado — processos encerrados */}
            {selecionado.status === "Encerrado" && (
              <div className="resultado-box section">
                <h3><Icon nome="check" size={12} style={{ verticalAlign: -2, marginRight: 5 }} />Resultado do processo</h3>
                {selecionado.valorContratado && (
                  <p style={{ fontSize: 14, marginBottom: 10 }}>
                    Valor contratado/homologado: <b style={{ color: "var(--green-dark)" }}>{fmtBRL(selecionado.valorContratado)}</b>
                  </p>
                )}
                {selecionado.vencedores?.length > 0 && selecionado.vencedores.map((v, i) => (
                  <div className="vencedor-linha" key={i}>
                    <div>
                      <div className="vencedor-nome">🏆 {v.nome}</div>
                      {v.cnpj && <div className="vencedor-cnpj">CNPJ: {v.cnpj}</div>}
                    </div>
                    {v.valor && <div className="vencedor-valor">{fmtBRL(v.valor)}</div>}
                  </div>
                ))}
                {selecionado.lotes?.filter((l) => l.valorHomologado).length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    {selecionado.lotes.filter((l) => l.valorHomologado).map((l, i) => (
                      <div className="vencedor-linha" key={i}>
                        <div className="vencedor-nome">{l.lote}</div>
                        <div className="vencedor-valor">{fmtBRL(l.valorHomologado)}</div>
                      </div>
                    ))}
                  </div>
                )}
                {selecionado.participantes?.length > 0 ? (
                  <>
                    <h3 style={{ marginTop: 14 }}>Participantes ({selecionado.participantes.length})</h3>
                    <table className="part-table">
                      <thead>
                        <tr><th>Empresa</th><th>CNPJ</th><th style={{ textAlign: "right" }}>Proposta</th></tr>
                      </thead>
                      <tbody>
                        {selecionado.participantes.map((p, i) => (
                          <tr key={i}>
                            <td>{p.nome}{p.vencedor && <span className="badge-vencedor">VENCEDORA</span>}</td>
                            <td style={{ color: "var(--muted)" }}>{p.cnpj || "—"}</td>
                            <td style={{ textAlign: "right", fontWeight: 600 }}>{p.valorProposta ? fmtBRL(p.valorProposta) : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                ) : (
                  !selecionado.vencedores?.length && (
                    <p style={{ fontSize: 12.5, color: "var(--muted-2)" }}>
                      Resultado detalhado não divulgado na API pública — consulte os documentos no portal de origem.
                    </p>
                  )
                )}
              </div>
            )}

            {/* Fases — processos abertos e em andamento */}
            {selecionado.status !== "Encerrado" && (
              <div className="fase-box section">
                <h3><Icon nome="radar" size={12} style={{ verticalAlign: -2, marginRight: 5 }} />Andamento do processo</h3>
                <div className="fase-atual">{selecionado.fase}</div>
                <div className="fase-timeline">
                  {FASES.map((fs, i) => (
                    <span key={fs} className={`fase-step ${faseIdx > i ? "done" : faseIdx === i ? "current" : ""}`}>
                      {i + 1}. {fs}
                    </span>
                  ))}
                </div>
                {selecionado.statusOriginal && (
                  <p style={{ fontSize: 12, color: "var(--muted-2)", marginTop: 10 }}>
                    Situação divulgada pelo portal: <b>{selecionado.statusOriginal}</b>
                    {selecionado.dataAbertura && selecionado.status === "Aberto" && ` · propostas até ${fmtData(selecionado.dataAbertura)}`}
                  </p>
                )}
              </div>
            )}

            {/* Ações de IA */}
            <div className="acoes-ia no-print">
              <button className="btn-ia" onClick={() => analisar(false)} disabled={analisando}>
                {analisando
                  ? <><span className="spinner" /> Gerando relatório…</>
                  : <><Icon nome="bolt" size={14} /> Gerar Relatório Executivo</>}
              </button>
              {analise && !analise.demo && (
                <button className="btn-secundario" onClick={imprimirRelatorio}>
                  <Icon nome="pdf" size={14} /> Baixar PDF
                </button>
              )}
              {analise && !analise.demo && !analisando && analiseDoCache && (
                <button className="btn-secundario" onClick={() => analisar(true)} title="A análise exibida veio do cache local — gerar novamente com IA">
                  ↻ Reanalisar
                </button>
              )}
              <button className={`btn-secundario ${chatAberto ? "ativo" : ""}`} onClick={() => setChatAberto(!chatAberto)}>
                <Icon nome="chat" size={14} /> Pergunte ao Edital
              </button>
              {idsPipeline.has(selecionado.id) ? (
                <button className="btn-participar em-acompanhamento" onClick={() => { setSelecionado(null); setView("acompanhamento"); }}>
                  <Icon nome="kanban" size={14} /> Em acompanhamento — abrir painel
                </button>
              ) : (
                <button className="btn-participar" onClick={() => { participar(selecionado); setSelecionado(null); }}>
                  <Icon nome="mais" size={14} /> Participar deste processo
                </button>
              )}
            </div>
            {analisando && <LoadingAnalise etapa={etapaIA} tokens={progressoIA} />}
            {erroIA && <div className="ia-erro">✕ {erroIA}</div>}

            {chatAberto && <ChatEdital edital={selecionado} perfil={perfil} empresa={dossieEmpresa()} />}

            {analise && <RelatorioExecutivo analise={analise} numero={selecionado.numero} />}

            <div className="section" style={{ marginTop: 18 }}>
              <h3>Objeto completo</h3>
              <div className="edital-texto">{selecionado.objeto}</div>
            </div>

            <div className="section">
              <h3><Icon nome="doc" size={12} style={{ verticalAlign: -2, marginRight: 5 }} />Documentos do processo</h3>
              {documentosProcesso.length > 0 ? (
                <ul>
                  {documentosProcesso.map((d, i) => (
                    <li key={i}>
                      <a href={d.url} target="_blank" rel="noreferrer">{d.descricao} ↗</a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p style={{ fontSize: 12.5, color: "var(--muted-2)" }}>
                  O órgão não disponibiliza os anexos via API pública nesta fonte
                  {selecionado.portal ? <> — <a href={selecionado.portal} target="_blank" rel="noreferrer">acessar no portal de origem ↗</a></> : "."}
                </p>
              )}
            </div>

            {regulamentoDe(selecionado.entidade) && (
              <div className="section">
                <h3><Icon nome="doc" size={12} style={{ verticalAlign: -2, marginRight: 5 }} />Regulamento da entidade</h3>
                <ul>
                  <li>
                    <a href={regulamentoDe(selecionado.entidade).pdf} target="_blank" rel="noreferrer">
                      {regulamentoDe(selecionado.entidade).nome} ↗
                    </a>
                  </li>
                </ul>
                <p style={{ fontSize: 12, color: "var(--muted-2)", marginTop: 6 }}>
                  O Relatório Executivo e o Pergunte ao Edital consultam este regulamento automaticamente,
                  inclusive para verificar conformidades entre o edital e as regras da entidade.
                </p>
              </div>
            )}

            <div className="section">
              <h3><Icon nome="fonte" size={12} style={{ verticalAlign: -2, marginRight: 5 }} />Fonte oficial</h3>
              <p style={{ fontSize: 12, color: "var(--muted-2)" }}>
                {selecionado.fonte}
                {selecionado.portal && (
                  <>
                    {" · "}
                    <a href={selecionado.portal} target="_blank" rel="noreferrer">abrir portal de origem ↗</a>
                  </>
                )}
              </p>
            </div>

              </td></tr></tbody>
            </table>
          </div>
        </>
      )}

      {processoAberto && (() => {
        const p = pipeline.find((x) => x.id === processoAberto);
        if (!p) return null;
        return (
          <ModalProcesso
            processo={p}
            empresa={empresa}
            onFechar={() => setProcessoAberto(null)}
            onCampo={(patch) => atualizarProcesso(p.id, patch)}
            onMover={moverFase}
            onToggleItem={(idx) => toggleChecklist(p.id, idx)}
            onAddItem={(t) => addChecklistItem(p.id, t)}
            onRemoverItem={(idx) => removerChecklistItem(p.id, idx)}
            onAnexarItem={(idx, file) => anexarChecklistDoc(p.id, idx, file)}
            onRemoverItemDoc={(idx) => removerChecklistDoc(p.id, idx)}
            onRemover={() => { if (confirm("Remover este processo do acompanhamento?")) removerProcesso(p.id); }}
          />
        );
      })()}
    </div>
  );
}
