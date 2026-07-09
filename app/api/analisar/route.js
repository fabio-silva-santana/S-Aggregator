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

// O relatório é gerado em 2 chamadas PARALELAS (FASE 2 de performance):
// extração (dados objetivos) e análise/parecer. Cada uma produz metade dos
// tokens de saída — o gargalo medido — cortando o tempo total quase pela metade.
// A 2ª chamada dispara após o 1º evento do stream da 1ª p/ reutilizar o cache.
const CAMPOS_EXTRACAO = [
  "resumo_executivo", "dados_gerais", "objeto_descricao", "objeto_escopo", "objeto_obrigacoes",
  "perfil_empresa_ideal", "valores", "cronograma", "condicoes_participacao", "documentacao_exigida",
  "execucao_contrato", "garantias", "penalidades", "como_participar",
];
const CAMPOS_ANALISE = SCHEMA.required.filter((c) => !CAMPOS_EXTRACAO.includes(c));
function subSchema(campos) {
  return {
    type: "object",
    properties: Object.fromEntries(campos.map((c) => [c, SCHEMA.properties[c]])),
    required: campos,
    additionalProperties: false,
  };
}
const SCHEMA_EXTRACAO = subSchema(CAMPOS_EXTRACAO);
const SCHEMA_ANALISE = subSchema(CAMPOS_ANALISE);

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

  // Resposta em SSE: o cliente recebe etapas reais + progresso + resultado.
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event, data) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch { /* cliente desconectou */ }
      };
      const tInicio = Date.now();
      try {
        // ---- etapa 1: localizar o processo ----
        send("etapa", { id: "lendo", label: "Lendo o edital" });
        const { editais } = await coletarEditais();
        const edital = editais.find((e) => e.id === editalId);
        if (!edital) {
          send("erro", { mensagem: "Edital não encontrado (a base é atualizada a cada 30 min — recarregue a página)" });
          return;
        }
        if (!process.env.ANTHROPIC_API_KEY) {
          send("resultado", { analise: analiseDemo(edital) });
          return;
        }

        // ---- etapa 2: regulamento + anexos (com pré-checagem de URL) ----
        send("etapa", { id: "anexos", label: "Carregando regulamento e anexos do processo" });
        const [regBlock, documentos] = await Promise.all([
          blocoRegulamento(edital.entidade),
          resolverDocumentos(edital),
        ]);
        const docsPdf = documentos
          .filter((d) => /\.pdf(\?|$)/i.test(d.url) || d.url.includes("pncp.gov.br"))
          .slice(0, 2);
        const nomeReg = regulamentoDaEntidade(edital.entidade)?.nomeOficial;

        const userTexto =
          `${dossie || "PERFIL DA EMPRESA DO USUÁRIO: (não informado)"}\n\n` +
          `PROCESSO PARA ANÁLISE (dados estruturados do portal oficial):\n${montarTextoEdital(edital)}` +
          (nomeReg ? `\n\nRegulamento aplicável anexado: ${nomeReg}` : "");

        const client = new Anthropic();

        const conteudo = (instrucao, comDocs) => [
          ...(regBlock ? [regBlock] : []), // cache_control: prefixo system+regulamento é reutilizado entre as 2 chamadas
          ...(comDocs
            ? docsPdf.map((d) => ({
                type: "document",
                source: { type: "url", url: d.url },
                title: d.descricao?.slice(0, 100) || "Documento do edital",
              }))
            : []),
          { type: "text", text: `${userTexto}\n\n${instrucao}` },
        ];

        // Pré-voo (grátis): mede o prompt COM anexos; PDFs gigantes estouram o
        // contexto de 200k do modelo — antes isso custava uma geração inteira
        // desperdiçada (400 → retry). Se não couber, seguimos sem os anexos.
        let usarDocs = docsPdf.length > 0;
        let promptTokens = null;
        if (usarDocs) {
          try {
            const ct = await client.messages.countTokens({
              model: "claude-haiku-4-5",
              system: SYSTEM,
              messages: [{ role: "user", content: conteudo("", true) }],
            });
            promptTokens = ct.input_tokens;
            if (ct.input_tokens > 185000) usarDocs = false; // reserva p/ instrução + saída
          } catch {
            usarDocs = false; // anexo inacessível na prática — segue sem
          }
        }
        let caracteres = 0;
        let ultimoProgresso = 0;
        const onDelta = (texto) => {
          caracteres += texto.length;
          const agora = Date.now();
          if (agora - ultimoProgresso > 600) {
            ultimoProgresso = agora;
            send("progresso", { caracteres, tokensAprox: Math.round(caracteres / 3.5) });
          }
        };

        const chamarStream = (schema, instrucao) => {
          const s = client.messages.stream({
            model: "claude-haiku-4-5",
            max_tokens: 10000,
            system: SYSTEM,
            output_config: { format: { type: "json_schema", schema } },
            messages: [{ role: "user", content: conteudo(instrucao, usarDocs) }],
          });
          s.on("text", onDelta);
          return s;
        };

        const finalizar = async (s) => {
          const msg = await s.finalMessage();
          const u = msg.usage || {};
          const texto = msg.content.find((b) => b.type === "text")?.text || "{}";
          return {
            dados: JSON.parse(texto),
            usage: {
              inputTokens: u.input_tokens,
              outputTokens: u.output_tokens,
              cacheWriteTokens: u.cache_creation_input_tokens,
              cacheReadTokens: u.cache_read_input_tokens,
            },
          };
        };

        // ---- etapa 3: 2 chamadas paralelas (extração ‖ análise) ----
        send("etapa", { id: "extraindo", label: "Extraindo dados, prazos e exigências" });
        const streamA = chamarStream(
          SCHEMA_EXTRACAO,
          "NESTA CHAMADA, produza SOMENTE os campos de EXTRAÇÃO do relatório (dados objetivos do processo: resumo, valores, cronograma, condições, documentação, execução, garantias, penalidades, como participar). Cada item de lista deve ser UMA linha objetiva — sem parágrafos."
        );
        // aguarda o 1º evento do stream A (cache do regulamento passa a ser legível) e dispara B
        await Promise.race([
          new Promise((resolve) => streamA.on("streamEvent", resolve)),
          new Promise((resolve) => setTimeout(resolve, 4000)),
        ]);
        send("etapa", { id: "analisando", label: "Analisando compatibilidade e conformidade com o regulamento" });
        const streamB = chamarStream(
          SCHEMA_ANALISE,
          "NESTA CHAMADA, produza SOMENTE os campos de ANÁLISE E PARECER do relatório (matriz de riscos, conformidade com o regulamento, oportunidades, pontos de atenção, checklist, graus, pareceres, recomendação e score de aderência). Itens de lista em UMA linha objetiva; pareceres em no máximo 3 frases cada."
        );

        // seções de extração ficam prontas antes — o cliente pode exibi-las
        const pParcial = finalizar(streamA).then((r) => {
          send("parcial", { campos: sanearTexto(r.dados) });
          return r;
        });
        const [resA, resB] = await Promise.all([pParcial, finalizar(streamB)]);
        send("etapa", { id: "redigindo", label: "Consolidando o relatório executivo" });

        const analise = sanearTexto({ ...resA.dados, ...resB.dados });
        const meta = {
          duracaoMs: Date.now() - tInicio,
          extracao: resA.usage,
          parecer: resB.usage,
          outputTokens: (resA.usage.outputTokens || 0) + (resB.usage.outputTokens || 0),
          cacheReadTokens: (resA.usage.cacheReadTokens || 0) + (resB.usage.cacheReadTokens || 0),
          anexosLidos: usarDocs ? docsPdf.length : 0,
          anexosDescartados: usarDocs ? 0 : docsPdf.length,
          promptTokens,
        };
        console.log("[analisar] métricas:", JSON.stringify(meta));
        send("resultado", { analise: { ...analise, demo: false }, meta });
      } catch (err) {
        console.error("Erro na análise IA:", err);
        send("erro", { mensagem: `Falha na análise com IA: ${err?.message || "erro desconhecido"}` });
      } finally {
        try { controller.close(); } catch { /* já fechado */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
