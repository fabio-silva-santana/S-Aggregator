// ============================================================
// S-Aggregator — Dados cadastrais da empresa do usuário
//
// Consulta CNPJ na base da Receita Federal via BrasilAPI (dados
// públicos do CNPJ). Cache de 30 min por CNPJ.
//
// Certidões de habilitação (CND, CRF/FGTS, CNDT, estaduais e
// municipais): os órgãos oficiais exigem captcha e não têm API
// pública gratuita — o app fornece link oficial de emissão,
// controle de status/validade e upload, com alerta automático de
// vencimento. Consulta 100% automática exige um conector premium
// (ex.: Infosimples), previsto mas não obrigatório.
// ============================================================

const REVALIDATE = 1800; // 30 min

export function limparCNPJ(cnpj) {
  return String(cnpj || "").replace(/\D/g, "");
}

export function formatarCNPJ(cnpj) {
  const c = limparCNPJ(cnpj).padStart(14, "0");
  if (c.length !== 14) return cnpj;
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
}

export function cnpjValido(cnpj) {
  const c = limparCNPJ(cnpj);
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const calc = (base) => {
    let soma = 0;
    let pos = base.length - 7;
    for (let i = 0; i < base.length; i++) {
      soma += parseInt(base[i], 10) * pos--;
      if (pos < 2) pos = 9;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(c.slice(0, 12));
  const d2 = calc(c.slice(0, 12) + d1);
  return c.slice(12) === `${d1}${d2}`;
}

function enquadramentoTributario(d) {
  if (d.opcao_pelo_mei === true || /MICRO EMPREENDEDOR|MEI/i.test(d.porte || "")) return "MEI — Microempreendedor Individual";
  if (d.opcao_pelo_simples === true) return "Simples Nacional";
  const porte = (d.porte || "").toUpperCase();
  if (porte.includes("MICRO")) return "Microempresa (ME) — regime a confirmar";
  if (porte.includes("PEQUENO")) return "Empresa de Pequeno Porte (EPP) — regime a confirmar";
  return "Lucro Presumido/Real (demais) — não optante pelo Simples";
}

export async function consultarCNPJ(cnpjBruto) {
  const cnpj = limparCNPJ(cnpjBruto);
  if (!cnpjValido(cnpj)) {
    return { erro: "CNPJ inválido — verifique os 14 dígitos." };
  }
  try {
    const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
      headers: { Accept: "application/json", "User-Agent": "S-Aggregator/1.0" },
      next: { revalidate: REVALIDATE },
    });
    if (r.status === 404) return { erro: "CNPJ não encontrado na base da Receita Federal." };
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();

    const socios = (d.qsa || []).map((s) => ({
      nome: s.nome_socio || s.nome || "—",
      qualificacao: s.qualificacao_socio || s.codigo_qualificacao_socio || null,
      entrada: s.data_entrada_sociedade || null,
      faixaEtaria: s.faixa_etaria || null,
    }));

    const situacao = (d.descricao_situacao_cadastral || "").toUpperCase();
    return {
      atualizadoEm: new Date().toISOString(),
      cnpj: formatarCNPJ(cnpj),
      cnpjNumeros: cnpj,
      razaoSocial: d.razao_social || null,
      nomeFantasia: d.nome_fantasia || null,
      situacao: d.descricao_situacao_cadastral || "—",
      situacaoRegular: situacao === "ATIVA",
      dataSituacao: d.data_situacao_cadastral || null,
      motivoSituacao: d.descricao_motivo_situacao_cadastral || null,
      dataAbertura: d.data_inicio_atividade || null,
      porte: d.porte || "—",
      naturezaJuridica: d.natureza_juridica || null,
      capitalSocial: d.capital_social ?? null,
      enquadramentoTributario: enquadramentoTributario(d),
      optanteSimples: d.opcao_pelo_simples ?? null,
      optanteMei: d.opcao_pelo_mei ?? null,
      cnaePrincipal: d.cnae_fiscal ? `${d.cnae_fiscal} — ${d.cnae_fiscal_descricao || ""}`.trim() : null,
      cnaesSecundarios: (d.cnaes_secundarios || []).map((c) => `${c.codigo} — ${c.descricao}`),
      endereco: [d.logradouro, d.numero, d.complemento, d.bairro].filter(Boolean).join(", "),
      municipio: d.municipio || null,
      uf: d.uf || null,
      cep: d.cep || null,
      telefone: d.ddd_telefone_1 || null,
      email: d.email || null,
      socios,
      fonte: "Receita Federal (via BrasilAPI) — dados públicos do CNPJ",
    };
  } catch (e) {
    return { erro: `Falha na consulta à Receita: ${e?.message || "erro desconhecido"}` };
  }
}

// Certidões de habilitação típicas em licitações do Sistema S.
// Cada uma com link OFICIAL de emissão. Estaduais/municipais dependem
// da UF/município — o link é resolvido a partir do cadastro.
export function certidoesModelo(uf, municipio) {
  const ufSefaz = LINKS_SEFAZ[(uf || "").toUpperCase()] || null;
  return [
    {
      id: "cnd_federal",
      nome: "CND — Certidão Negativa de Débitos Federais e Dívida Ativa da União",
      orgao: "Receita Federal / PGFN",
      esfera: "Federal",
      link: "https://servicos.receita.fazenda.gov.br/servicos/certidaointernet/pj/emitir",
      obrigatoria: true,
    },
    {
      id: "crf_fgts",
      nome: "CRF — Certificado de Regularidade do FGTS",
      orgao: "Caixa Econômica Federal",
      esfera: "Federal",
      link: "https://consulta-crf.caixa.gov.br/consultacrf/pages/consultaEmpregador.jsf",
      obrigatoria: true,
    },
    {
      id: "cndt",
      nome: "CNDT — Certidão Negativa de Débitos Trabalhistas",
      orgao: "Tribunal Superior do Trabalho (TST)",
      esfera: "Federal",
      link: "https://cndt-certidao.tst.jus.br/inicio.faces",
      obrigatoria: true,
    },
    {
      id: "cnd_estadual",
      nome: `Certidão Negativa de Débitos Estaduais${uf ? ` (${uf})` : ""}`,
      orgao: uf ? `SEFAZ-${uf}` : "Secretaria de Fazenda Estadual",
      esfera: "Estadual",
      link: ufSefaz,
      obrigatoria: true,
    },
    {
      id: "cnd_municipal",
      nome: `Certidão Negativa de Débitos Municipais${municipio ? ` (${municipio})` : ""}`,
      orgao: municipio ? `Prefeitura de ${municipio}` : "Prefeitura Municipal",
      esfera: "Municipal",
      link: null,
      obrigatoria: true,
    },
    {
      id: "falencia",
      nome: "Certidão Negativa de Falência e Recuperação Judicial",
      orgao: uf ? `Tribunal de Justiça (TJ-${uf})` : "Tribunal de Justiça",
      esfera: "Judicial",
      link: null,
      obrigatoria: false,
    },
  ];
}

// Portais de emissão de certidão estadual por UF (SEFAZ)
const LINKS_SEFAZ = {
  AC: "https://sefaznet.ac.gov.br/sefazonline/servicos/certidao/emitir_certidao.xhtml",
  AL: "https://sefaz.al.gov.br/servico/emissao-de-certidao-negativa-de-debitos",
  AM: "https://online.sefaz.am.gov.br/certidao/",
  AP: "https://www.sefaz.ap.gov.br/",
  BA: "http://www.sefaz.ba.gov.br/scripts/certidao/certidaonegativa.asp",
  CE: "https://servicos.sefaz.ce.gov.br/internet/certidaonegativa/",
  DF: "https://ww1.receita.fazenda.df.gov.br/cidadao/certidoes/Certidao",
  ES: "https://internet.sefaz.es.gov.br/agenciavirtual/area_publica/certidoes/",
  GO: "https://www.sefaz.go.gov.br/certidao/emissao/",
  MA: "https://sistemas1.sefaz.ma.gov.br/certidaonegativa/",
  MG: "https://www2.fazenda.mg.gov.br/sol/",
  MS: "https://www.dfe.ms.gov.br/certidao/",
  MT: "https://www.sefaz.mt.gov.br/certidao/",
  PA: "https://app.sefa.pa.gov.br/certidoes/",
  PB: "https://www.receita.pb.gov.br/ser/servico/48-certidoes",
  PE: "https://efisco.sefaz.pe.gov.br/sfi_trb_gcc/PREmitirCertidaoRegularidadeFiscal",
  PI: "https://webas.sefaz.pi.gov.br/",
  PR: "https://www.fazenda.pr.gov.br/servicos/Certidao-negativa",
  RJ: "https://www4.fazenda.rj.gov.br/certidao-fiscal-web/",
  RN: "https://uvt2.set.rn.gov.br/#/certidao-negativa",
  RO: "https://certidao.sefin.ro.gov.br/",
  RR: "https://www.sefaz.rr.gov.br/",
  RS: "https://www.sefaz.rs.gov.br/certidao/emissao",
  SC: "https://certidoes.sef.sc.gov.br/",
  SE: "https://www.sefaz.se.gov.br/",
  SP: "https://www.dividaativa.pge.sp.gov.br/da-ic-web/inicio.do",
  TO: "https://apoio.sefaz.to.gov.br/",
};

// Monta o dossiê estruturado da empresa em texto — consumido pela IA
// no relatório executivo e na análise de aderência.
export function montarDossieEmpresa(empresa) {
  if (!empresa || (!empresa.dados && !empresa.textoLivre)) return null;
  const linhas = ["DOSSIÊ DA EMPRESA DO USUÁRIO (para cruzar com o edital):"];
  const d = empresa.dados;
  if (d) {
    linhas.push(
      `Razão social: ${d.razaoSocial || "—"}${d.nomeFantasia ? ` (${d.nomeFantasia})` : ""}`,
      `CNPJ: ${d.cnpj} — Situação cadastral: ${d.situacao}${d.dataSituacao ? ` desde ${d.dataSituacao}` : ""}`,
      `Porte: ${d.porte} · Enquadramento tributário: ${d.enquadramentoTributario}`,
      `Natureza jurídica: ${d.naturezaJuridica || "—"} · Capital social: ${d.capitalSocial != null ? "R$ " + Number(d.capitalSocial).toLocaleString("pt-BR") : "—"}`,
      `Abertura: ${d.dataAbertura || "—"} · Localização: ${d.municipio || ""}/${d.uf || ""}`,
      `Atividade principal (CNAE): ${d.cnaePrincipal || "—"}`,
      d.cnaesSecundarios?.length ? `Atividades secundárias: ${d.cnaesSecundarios.slice(0, 12).join("; ")}` : null,
      d.socios?.length ? `Sócios/QSA: ${d.socios.map((s) => `${s.nome}${s.qualificacao ? ` (${s.qualificacao})` : ""}`).join("; ")}` : null,
    );
  }
  if (empresa.certidoes?.length) {
    linhas.push("Situação de certidões de habilitação:");
    for (const c of empresa.certidoes) {
      const st = c.status || "não informada";
      const val = c.validade ? ` — válida até ${c.validade}` : "";
      linhas.push(`  • ${c.nome}: ${st}${val}`);
    }
  }
  if (empresa.questionario) {
    const q = empresa.questionario;
    const map = {
      segmentosAtuacao: "Segmentos de atuação",
      estadosAtendidos: "Estados que atende presencialmente",
      atendeRemoto: "Atende remoto (nacional)",
      faturamentoAnual: "Faturamento anual",
      numeroFuncionarios: "Nº de funcionários",
      possuiCapacidadeTecnica: "Possui atestados de capacidade técnica",
      participouLicitacoesS: "Já participou de licitações no Sistema S",
      certidoesEmDia: "Declara certidões em dia",
      observacoes: "Observações",
    };
    linhas.push("Perfil declarado:");
    for (const [k, rot] of Object.entries(map)) {
      const v = q[k];
      if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)) continue;
      linhas.push(`  • ${rot}: ${Array.isArray(v) ? v.join(", ") : v === true ? "Sim" : v === false ? "Não" : v}`);
    }
  }
  if (empresa.interesses && (empresa.interesses.entidades?.length || empresa.interesses.ufs?.length || empresa.interesses.segmentos?.length)) {
    const i = empresa.interesses;
    linhas.push("Interesses de participação declarados:");
    if (i.entidades?.length) linhas.push(`  • Entidades: ${i.entidades.join(", ")}`);
    if (i.ufs?.length) linhas.push(`  • Estados: ${i.ufs.join(", ")}`);
    if (i.segmentos?.length) linhas.push(`  • Segmentos: ${i.segmentos.join(", ")}`);
  }
  if (empresa.atestados?.length) {
    linhas.push("Atestados de capacidade técnica:");
    for (const a of empresa.atestados) {
      linhas.push(`  • ${a.objeto || "—"}${a.orgao ? ` — ${a.orgao}` : ""}${a.ano ? ` (${a.ano})` : ""}${a.valor ? ` — R$ ${a.valor}` : ""}`);
    }
  }
  if (empresa.documentos?.length) {
    linhas.push(`Documentos anexados: ${empresa.documentos.map((x) => x.nome).join("; ")}`);
  }
  if (empresa.textoLivre?.trim()) {
    linhas.push(`Informações adicionais: ${empresa.textoLivre.trim()}`);
  }
  return linhas.filter(Boolean).join("\n");
}
