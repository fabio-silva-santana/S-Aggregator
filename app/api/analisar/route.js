import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { coletarEditais, montarTextoEdital, resolverDocumentos } from "@/lib/coletores";
import { blocoRegulamento, regulamentoDaEntidade } from "@/lib/regulamentos";
import { montarDossieEmpresa } from "@/lib/empresa";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const lista = { type: "array", items: { type: "string" } };

// Listas em formato "Campo: valor" para manter a gramática do structured
// output compacta (schemas muito aninhados são rejeitados pela API).
const SCHEMA = {
  type: "object",
  properties: {
    resumo_executivo: {
      type: "array",
      description: "Pares 'Campo: valor' — Objeto da contratação, Órgão contratante, Modalidade, Tipo de julgamento, Valor estimado, Prazo contratual, Data da sessão, Cidade/Estado, Plataforma, Avaliação preliminar sobre atratividade",
      items: { type: "string" },
    },
    dados_gerais: { ...lista, description: "Pares 'Campo: valor' — número do edital, processo, forma de disputa, critério de julgamento, regime de execução, fonte de recursos, vigência, prorrogação, lotes" },
    objeto_descricao: { type: "string" },
    objeto_escopo: lista,
    objeto_obrigacoes: lista,
    perfil_empresa_ideal: { type: "string" },
    valores: { ...lista, description: "Pares 'Campo: valor' — valor global, forma de remuneração, pagamento, reajuste, orçamento sigiloso" },
    cronograma: { ...lista, description: "Pares 'Etapa: prazo/data'" },
    condicoes_participacao: { ...lista, description: "Pares 'Campo: valor' — quem pode participar, impedimentos, consórcios, ME/EPP, visita técnica" },
    documentacao_exigida: { ...lista, description: "Itens agrupados com prefixo da categoria, ex.: 'Habilitação Jurídica: contrato social registrado'" },
    execucao_contrato: { ...lista, description: "Pares 'Campo: valor' — local, prazo, obrigações, fiscalização" },
    garantias: { type: "string" },
    penalidades: lista,
    matriz_riscos: { ...lista, description: "Formato 'Risco — Grau', onde Grau ∈ Baixo | Médio | Médio/Alto | Alto" },
    conformidade_regulamento: { ...lista, description: "Análise de conformidade do edital frente ao regulamento oficial da entidade anexado: aponte inconformidades, cláusulas atípicas ou divergências de prazo/procedimento; se estiver conforme, liste os pontos-chave verificados" },
    oportunidades: lista,
    pontos_atencao: lista,
    checklist_participacao: lista,
    como_participar: { ...lista, description: "Pares 'Campo: valor' — plataforma/ferramenta onde a disputa ocorre (portal de compras da entidade, Compras.gov, e-mail etc.), link/endereço de cadastro de fornecedor, como obter o edital completo, canal de esclarecimentos. Use o link do portal de origem fornecido; quando não identificado, indique o caminho típico da entidade." },
    grau_dificuldade: { type: "string" },
    atratividade_financeira: { type: "string" },
    complexidade_operacional: { type: "string" },
    risco_juridico: { type: "string" },
    competitividade_esperada: { type: "string" },
    parecer_vantagens: { type: "string" },
    parecer_desvantagens: { type: "string" },
    parecer_riscos: { type: "string" },
    parecer_perfil_adequado: { type: "string" },
    recomendacao: { type: "string", enum: ["PARTICIPAR", "AVALIAR_COM_CAUTELA", "NAO_PARTICIPAR"] },
    justificativa_recomendacao: { type: "string" },
    score_aderencia: { type: "integer", description: "0 a 100: aderência entre o perfil da empresa do usuário e o edital; se perfil não informado, atratividade geral" },
    justificativa_score: { type: "string" },
  },
  required: [
    "resumo_executivo", "dados_gerais", "objeto_descricao", "objeto_escopo", "objeto_obrigacoes",
    "perfil_empresa_ideal", "valores", "cronograma", "condicoes_participacao", "documentacao_exigida",
    "execucao_contrato", "garantias", "penalidades", "matriz_riscos", "oportunidades", "pontos_atencao",
    "checklist_participacao", "como_participar", "conformidade_regulamento", "grau_dificuldade", "atratividade_financeira", "complexidade_operacional",
    "risco_juridico", "competitividade_esperada", "parecer_vantagens", "parecer_desvantagens",
    "parecer_riscos", "parecer_perfil_adequado", "recomendacao", "justificativa_recomendacao",
    "score_aderencia", "justificativa_score",
  ],
  additionalProperties: false,
};

const SYSTEM = `Você é o analista de licitações do S-Aggregator, especialista nos regulamentos de licitações e contratos das entidades do Sistema S (SESI, SENAI, SESC, SENAC, SENAR, SEBRAE).
Produza um RELATÓRIO EXECUTIVO DE ANÁLISE completo e objetivo do processo fornecido, em português do Brasil, no padrão de consultoria de licitações.

Fontes anexadas nesta ordem: (1) o REGULAMENTO OFICIAL da entidade; (2) os DOCUMENTOS DO EDITAL quando publicados pelo órgão; (3) os dados estruturados do portal. EXTRAIA as informações diretamente desses anexos — número do processo, prazos, exigências de habilitação, garantias, penalidades, plataforma de disputa, link de cadastro. Cite a origem quando relevante (ex.: "item 5.2 do edital", "art. 12 do RCA").

Regras:
- PROIBIDO usar as expressões "consulte o edital", "verificar edital", "ver edital", "confirmar no edital", "edital completo" como encaminhamento ao leitor — você é o especialista que já leu os documentos anexados; a leitura é SEU trabalho. Quando uma informação realmente não constar nos anexos nem nos dados, use exatamente a fórmula "Não divulgado pelo órgão nos documentos publicados" e complemente com o que o regulamento da entidade determina para o caso (com o artigo).
- Nunca invente número de processo, valores ou prazos.
- A seção "conformidade_regulamento" é obrigatória com NO MÍNIMO 4 itens: confronte o edital com o regulamento oficial anexado (modalidade, prazos de divulgação, critério de julgamento, garantias, recursos/impugnação) citando o artigo do regulamento em cada item; aponte inconformidades ou cláusulas atípicas quando existirem, e registre como "Conforme" os pontos verificados (ex.: "Prazo de divulgação: conforme art. 15 do RCA").
- No cronograma, use as datas reais dos documentos; complemente com etapas previstas no regulamento (impugnação, recursos) indicando o artigo.
- A matriz de riscos deve ter 4 a 6 riscos concretos com grau.
- O checklist de participação deve ser acionável (6 a 10 itens).
- Se o DOSSIÊ DA EMPRESA foi informado, calcule o score de aderência cruzando os dados reais da empresa (situação cadastral na Receita, porte, enquadramento tributário, CNAE, capital social, sócios, certidões e sua validade, atestados de capacidade técnica, estados atendidos) COM as exigências do edital e as regras do regulamento; personalize o parecer, o checklist e os pontos de atenção. Sinalize explicitamente: se o CNPJ não estiver ATIVO (impedimento); certidões vencidas ou não informadas que travariam a habilitação; incompatibilidade de CNAE/objeto; porte que afeta benefícios ME/EPP; falta de atestado exigido; e se a empresa não atende a UF de execução. Se o dossiê não foi informado, o score reflete a atratividade geral e diga que seria mais preciso com o cadastro da empresa preenchido.
- Seja direto, denso em informação e sem redundância.
- TODAS as datas devem estar no padrão brasileiro DD/MM/AAAA (ex.: 03/07/2026), inclusive no cronograma e no resumo executivo — converta qualquer data em outro formato.
- Formato dos campos de lista: itens "Campo: valor" (ex.: "Modalidade: Pregão Eletrônico"); na matriz de riscos, "Risco — Grau" com Grau ∈ Baixo, Médio, Médio/Alto, Alto (ex.: "Prazo curto para habilitação — Médio/Alto").
- Na seção "como_participar", informe a ferramenta/plataforma onde a disputa acontece, o link/caminho de cadastro de fornecedor e o canal de esclarecimentos, extraídos dos documentos; complemente com o link do portal de origem fornecido nos dados.`;

// Garantia determinística de tom: nenhuma variação de "consulte o edital"
// chega à tela, independentemente do que o modelo gerar.
const RX_DELEGACAO = /\b(consulte|consultar|verifique|verificar|confira|conferir|checar|cheque)\s+(?:n?o\s+|a\s+)?(?:edital|instrumento convocatório)(?:\s+(?:completo|na íntegra|original))?\b/gi;
function sanearTexto(v) {
  if (typeof v === "string") {
    return v.replace(RX_DELEGACAO, "informação não divulgada pelo órgão nos documentos publicados");
  }
  if (Array.isArray(v)) return v.map(sanearTexto);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sanearTexto(x)]));
  }
  return v;
}

function analiseDemo(edital) {
  return {
    demo: true,
    resumo_executivo: [
      `Objeto da contratação: ${edital.objeto.slice(0, 200)}`,
      `Órgão contratante: ${edital.regional}`,
      `Modalidade: ${edital.modalidadeOriginal || edital.modalidade}`,
      `Data da sessão: ${edital.dataAbertura || "—"}`,
      "Avaliação: [MODO DEMO — configure ANTHROPIC_API_KEY para o relatório completo]",
    ],
    dados_gerais: [`Número do edital: ${edital.numero}`],
    objeto_descricao: edital.objeto.slice(0, 300),
    objeto_escopo: [],
    objeto_obrigacoes: [],
    perfil_empresa_ideal: "—",
    valores: [],
    cronograma: edital.dataAbertura ? [`Abertura: ${edital.dataAbertura}`] : [],
    condicoes_participacao: [],
    documentacao_exigida: [],
    execucao_contrato: [],
    garantias: "—",
    penalidades: [],
    matriz_riscos: [],
    oportunidades: [],
    pontos_atencao: [],
    checklist_participacao: ["Configurar a ANTHROPIC_API_KEY para gerar o relatório completo"],
    como_participar: [],
    conformidade_regulamento: [],
    grau_dificuldade: "—",
    atratividade_financeira: "—",
    complexidade_operacional: "—",
    risco_juridico: "—",
    competitividade_esperada: "—",
    parecer_vantagens: "—",
    parecer_desvantagens: "—",
    parecer_riscos: "—",
    parecer_perfil_adequado: "—",
    recomendacao: "AVALIAR_COM_CAUTELA",
    justificativa_recomendacao: "Análise de demonstração — sem chave da API.",
    score_aderencia: 50,
    justificativa_score: "Score ilustrativo (modo demo).",
  };
}

export async function POST(request) {
  const { editalId, perfilEmpresa, empresa } = await request.json();
  // dossiê estruturado (novo módulo) tem prioridade; texto livre é fallback
  const dossie = montarDossieEmpresa(empresa) || (perfilEmpresa?.trim() ? `PERFIL DA EMPRESA DO USUÁRIO:\n${perfilEmpresa.trim()}` : null);
  const { editais } = await coletarEditais();
  const edital = editais.find((e) => e.id === editalId);
  if (!edital) {
    return NextResponse.json({ error: "Edital não encontrado (a base é atualizada a cada 30 min — recarregue a página)" }, { status: 404 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ analise: analiseDemo(edital) });
  }

  const client = new Anthropic();

  // anexos: regulamento oficial da entidade (com cache) + até 2 PDFs do edital
  const [regBlock, documentos] = await Promise.all([
    blocoRegulamento(edital.entidade),
    resolverDocumentos(edital),
  ]);
  const docsPdf = documentos.filter((d) => /\.pdf(\?|$)/i.test(d.url) || d.url.includes("pncp.gov.br")).slice(0, 2);
  const nomeReg = regulamentoDaEntidade(edital.entidade)?.nomeOficial;

  const userTexto =
    `${dossie || "PERFIL DA EMPRESA DO USUÁRIO: (não informado)"}\n\n` +
    `PROCESSO PARA ANÁLISE (dados estruturados do portal oficial):\n${montarTextoEdital(edital)}` +
    (nomeReg ? `\n\nRegulamento aplicável anexado: ${nomeReg}` : "");

  const montarConteudo = (comDocs) => [
    ...(regBlock ? [regBlock] : []),
    ...(comDocs
      ? docsPdf.map((d) => ({
          type: "document",
          source: { type: "url", url: d.url },
          title: d.descricao?.slice(0, 100) || "Documento do edital",
        }))
      : []),
    { type: "text", text: userTexto },
  ];

  async function chamar(comDocs) {
    const response = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 16000,
      system: SYSTEM,
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content: montarConteudo(comDocs) }],
    });
    const textBlock = response.content.find((b) => b.type === "text");
    return sanearTexto(JSON.parse(textBlock.text));
  }

  try {
    let analise;
    try {
      analise = await chamar(true);
    } catch (err) {
      // PDFs do portal podem estar fora do ar/pesados — refaz sem os anexos do edital
      if (docsPdf.length && err?.status === 400) analise = await chamar(false);
      else throw err;
    }
    return NextResponse.json({ analise: { ...analise, demo: false } });
  } catch (err) {
    console.error("Erro na análise IA:", err);
    const status = err?.status >= 400 && err?.status < 600 ? err.status : 500;
    return NextResponse.json(
      { error: `Falha na análise com IA: ${err?.message || "erro desconhecido"}` },
      { status }
    );
  }
}
