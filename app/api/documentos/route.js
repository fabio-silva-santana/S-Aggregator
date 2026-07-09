import { NextResponse } from "next/server";
import { coletarEditais, resolverDocumentos, diagnosticoCorreios } from "@/lib/coletores";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
export const preferredRegion = "gru1";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get("diag") === "correios") {
    return NextResponse.json(await diagnosticoCorreios());
  }
  const editalId = searchParams.get("editalId");
  const { editais } = await coletarEditais();
  const edital = editais.find((e) => e.id === editalId);
  if (!edital) return NextResponse.json({ error: "Edital não encontrado" }, { status: 404 });
  const documentos = await resolverDocumentos(edital);
  return NextResponse.json({ documentos });
}
