// ============================================================
// Regulamentos oficiais de licitações e contratos por entidade.
// PDFs servidos em /regulamentos/*.pdf (download do usuário);
// versões .txt extraídas alimentam a IA (custo ~10x menor que
// enviar o PDF). O RLC do SENAR é digitalizado sem camada de
// texto — para ele a IA lê o próprio PDF (base64).
// ============================================================
import fs from "fs/promises";
import path from "path";

const REGULAMENTOS = {
  SESI: {
    nomeOficial: "Regulamento para Contratação e Alienação (RCA) — SESI",
    pdf: "rca-sesi.pdf",
    txt: "rca-sesi.txt",
  },
  SENAI: {
    nomeOficial: "Regulamento para Contratação e Alienação (RCA) — SENAI",
    pdf: "rca-senai.pdf",
    txt: "rca-senai.txt",
  },
  SESC: {
    nomeOficial: "Regulamento de Licitações e Contratos do Sesc (Resolução Sesc nº 1.593/2024)",
    pdf: "rlc-sesc-senac.pdf",
    txt: "rlc-sesc-senac.txt",
  },
  SENAC: {
    nomeOficial: "Regulamento de Licitações e Contratos do Senac (Resolução Senac nº 1.270/2024)",
    pdf: "rlc-sesc-senac.pdf",
    txt: "rlc-sesc-senac.txt",
  },
  SENAR: {
    nomeOficial: "Regulamento de Licitações e Contratos do SENAR (2023)",
    pdf: "rlc-senar.pdf",
    txt: null, // PDF digitalizado sem camada de texto — IA lê o PDF
  },
  SEBRAE: {
    nomeOficial: "Regulamento de Licitações e Contratos do Sistema Sebrae (Resolução CDN nº 493/2024)",
    pdf: "rlc-sebrae.pdf",
    txt: "rlc-sebrae.txt",
  },
  "SEST/SENAT": {
    nomeOficial: "Regulamento de Licitações e Contratos do SEST e do SENAT (Resolução Normativa CN nº 002/2024)",
    pdf: "rlc-sest-senat.pdf",
    txt: "rlc-sest-senat.txt",
  },
  SESCOOP: {
    nomeOficial: "Regulamento de Licitações e Contratos do SESCOOP (Resolução nº 2.056/2023)",
    pdf: "rlc-sescoop.pdf",
    txt: "rlc-sescoop.txt",
  },
  CORREIOS: {
    nomeOficial: "Regulamento de Licitações e Contratações dos Correios — RLCC",
    pdf: "rlcc-correios.pdf",
    txt: "rlcc-correios.txt",
  },
};

// entidades compostas herdam o RCA da indústria
export function regulamentoDaEntidade(entidade) {
  const e = (entidade || "").toUpperCase();
  if (REGULAMENTOS[e]) return REGULAMENTOS[e];
  if (e.includes("CORREIOS")) return REGULAMENTOS.CORREIOS;
  if (e.includes("SESCOOP")) return REGULAMENTOS.SESCOOP;
  if (e.includes("SEST") || e.includes("SENAT")) return REGULAMENTOS["SEST/SENAT"];
  if (e.includes("SENAI")) return REGULAMENTOS.SENAI;
  if (e.includes("SESI") || e.includes("SISTEMA IND")) return REGULAMENTOS.SESI;
  return null;
}

function dirRegulamentos() {
  return path.join(process.cwd(), "public", "regulamentos");
}

// Bloco de documento para a API do Claude: texto extraído quando há
// camada de texto; senão o PDF em base64.
export async function blocoRegulamento(entidade, cacheControl = true) {
  const reg = regulamentoDaEntidade(entidade);
  if (!reg) return null;
  try {
    if (reg.txt) {
      const data = await fs.readFile(path.join(dirRegulamentos(), reg.txt), "utf-8");
      return {
        type: "document",
        source: { type: "text", media_type: "text/plain", data },
        title: reg.nomeOficial,
        ...(cacheControl ? { cache_control: { type: "ephemeral" } } : {}),
      };
    }
    const pdf = await fs.readFile(path.join(dirRegulamentos(), reg.pdf));
    return {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: pdf.toString("base64") },
      title: reg.nomeOficial,
      ...(cacheControl ? { cache_control: { type: "ephemeral" } } : {}),
    };
  } catch (err) {
    console.error("Regulamento indisponível no bundle:", entidade, err?.message);
    return null;
  }
}
