import { NextResponse } from "next/server";
import { coletarEditais, filtrarEditais, UFS, MODALIDADES, SEGMENTOS, ENTIDADES } from "@/lib/coletores";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
// São Paulo — IP brasileiro passa pelo WAF do portal dos Correios
export const preferredRegion = "gru1";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const { editais, fontes, coletadoEm } = await coletarEditais();

  const filtrados = filtrarEditais(editais, {
    entidade: searchParams.get("entidade") || undefined,
    uf: searchParams.get("uf") || undefined,
    modalidade: searchParams.get("modalidade") || undefined,
    segmento: searchParams.get("segmento") || undefined,
    status: searchParams.get("status") || undefined,
    busca: searchParams.get("busca") || undefined,
  });

  return NextResponse.json({
    total: filtrados.length,
    totalBase: editais.length,
    coletadoEm,
    fontes,
    filtros: {
      entidades: ENTIDADES,
      ufs: UFS,
      modalidades: MODALIDADES,
      segmentos: SEGMENTOS,
      status: ["Aberto", "Em andamento", "Encerrado"],
    },
    editais: filtrados,
  });
}
