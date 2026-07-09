import { NextResponse } from "next/server";
import { consultarCNPJ, certidoesModelo } from "@/lib/empresa";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const cnpj = searchParams.get("cnpj");
  if (!cnpj) return NextResponse.json({ erro: "Informe o CNPJ" }, { status: 400 });

  const dados = await consultarCNPJ(cnpj);
  if (dados.erro) return NextResponse.json(dados, { status: 422 });

  const certidoes = certidoesModelo(dados.uf, dados.municipio);
  return NextResponse.json({ dados, certidoes });
}
