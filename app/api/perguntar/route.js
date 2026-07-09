import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { coletarEditais, montarTextoEdital, resolverDocumentos } from "@/lib/coletores";
import { blocoRegulamento, regulamentoDaEntidade } from "@/lib/regulamentos";
import { montarDossieEmpresa } from "@/lib/empresa";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SYSTEM = `Você é o assistente "Pergunte ao Edital" do S-Aggregator, especialista em licitações do Sistema S (SESI, SENAI, SESC, SENAC, SENAR, SEBRAE).
Responda às perguntas do usuário sobre o processo licitatório, em português do Brasil.

Fontes anexadas nesta ordem: (1) o REGULAMENTO OFICIAL de licitações da entidade; (2) os DOCUMENTOS DO EDITAL quando publicados; (3) os dados estruturados do portal. Responda extraindo a informação diretamente desses anexos e cite a origem ("item 5.2 do edital", "art. 12 do regulamento").

Regras:
- NUNCA responda "consulte o edital", "verifique no edital" ou variações — o edital anexado é SEU trabalho de leitura: procure a informação nele (busque nas seções de disposições gerais, condições, prazos e anexos) e responda com o item/página. Só depois de esgotar os anexos, se realmente não constar, diga "o órgão não divulgou essa informação nos documentos publicados" e complemente com o que o regulamento oficial da entidade determina para o caso.
- Use o regulamento para verificar conformidade: se a pergunta tocar em prazo, recurso, impugnação, garantia ou procedimento, confronte o que o edital diz com o que o regulamento prevê e aponte divergências.
- TODAS as datas no padrão DD/MM/AAAA.
- Respostas objetivas e práticas (3 a 10 frases ou lista curta). Sem juridiquês desnecessário.
- Escreva em TEXTO SIMPLES, sem markdown: nada de ##, **, ou tabelas. Para listas, use traço simples ("- item"). Links podem aparecer como URL pura.`;

export async function POST(request) {
  const { editalId, mensagens, perfilEmpresa, empresa } = await request.json();
  const dossie = montarDossieEmpresa(empresa) || (perfilEmpresa?.trim() ? `PERFIL DA EMPRESA DO USUÁRIO:\n${perfilEmpresa.trim()}` : "PERFIL DA EMPRESA DO USUÁRIO: (não informado)");
  const { editais } = await coletarEditais();
  const edital = editais.find((e) => e.id === editalId);
  if (!edital) {
    return NextResponse.json({ error: "Edital não encontrado (a base é atualizada a cada 30 min — recarregue a página)" }, { status: 404 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({
      resposta:
        "Modo demonstração: configure a ANTHROPIC_API_KEY para conversar com o edital. " +
        `Sobre o processo ${edital.numero}: ${edital.objeto.slice(0, 200)}...`,
    });
  }
  if (!Array.isArray(mensagens) || mensagens.length === 0) {
    return NextResponse.json({ error: "Envie ao menos uma pergunta" }, { status: 400 });
  }

  const client = new Anthropic();

  const [regBlock, documentos] = await Promise.all([
    blocoRegulamento(edital.entidade),
    resolverDocumentos(edital),
  ]);
  const docsPdf = documentos
    .filter((d) => /\.pdf(\?|$)/i.test(d.url) || d.url.includes("pncp.gov.br"))
    .slice(0, 2);
  const nomeReg = regulamentoDaEntidade(edital.entidade)?.nomeOficial;

  const contexto =
    `DADOS DO PROCESSO (portal oficial):\n${montarTextoEdital(edital)}\n\n` +
    dossie +
    (nomeReg ? `\n\nRegulamento aplicável anexado: ${nomeReg}` : "");

  const montarPrimeira = (comDocs) => [
    ...(regBlock ? [regBlock] : []),
    ...(comDocs
      ? docsPdf.map((d) => ({
          type: "document",
          source: { type: "url", url: d.url },
          title: d.descricao?.slice(0, 100) || "Documento do edital",
        }))
      : []),
    { type: "text", text: `${contexto}\n\nPERGUNTA: ${mensagens[0].texto}` },
  ];

  const restante = mensagens.slice(1).map((m) => ({
    role: m.autor === "usuario" ? "user" : "assistant",
    content: m.texto,
  }));

  async function chamar(comDocs) {
    const response = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 2000,
      system: SYSTEM,
      messages: [{ role: "user", content: montarPrimeira(comDocs) }, ...restante],
    });
    return response.content.find((b) => b.type === "text")?.text || "";
  }

  try {
    let resposta;
    try {
      resposta = await chamar(true);
    } catch (err) {
      if (docsPdf.length && err?.status === 400) {
        resposta = await chamar(false);
        resposta += "\n\n(Obs.: os anexos do portal estavam indisponíveis nesta consulta — resposta baseada no regulamento e nos dados coletados.)";
      } else {
        throw err;
      }
    }
    return NextResponse.json({
      resposta,
      documentosLidos: [...(nomeReg ? [nomeReg] : []), ...docsPdf.map((d) => d.descricao)],
    });
  } catch (err) {
    console.error("Erro no chat do edital:", err);
    const status = err?.status >= 400 && err?.status < 600 ? err.status : 500;
    return NextResponse.json({ error: `Falha na consulta: ${err?.message || "erro desconhecido"}` }, { status });
  }
}
