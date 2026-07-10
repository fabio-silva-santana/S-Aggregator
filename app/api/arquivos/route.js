// Upload/download/remoção de arquivos da organização no Supabase Storage (FASE 6).
// Todo acesso é autenticado (Auth.js) e escopado por org_id no servidor.
// O bucket é privado: só se lê o arquivo por esta rota, nunca por URL pública.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { supabaseAdmin, supabaseConfigurado } from "@/lib/supabaseServer";
import { garantirUsuarioEOrg } from "@/lib/orgServer";
import { garantirBucket, caminhoDoc, BUCKET } from "@/lib/storageServer";

export const dynamic = "force-dynamic";

const LIMITE = 20 * 1024 * 1024; // 20 MB

// Resolve a org do usuário logado; devolve { orgId } ou { erro: Response }.
async function orgDaSessao() {
  const session = await auth();
  if (!session?.user) return { erro: NextResponse.json({ error: "não autenticado" }, { status: 401 }) };
  const { orgId } = await garantirUsuarioEOrg(session.user);
  return { orgId };
}

// GET /api/arquivos?docId=X → baixa o arquivo da organização.
export async function GET(request) {
  if (!supabaseConfigurado()) return NextResponse.json({ error: "storage indisponível" }, { status: 503 });
  const { orgId, erro } = await orgDaSessao();
  if (erro) return erro;
  const docId = new URL(request.url).searchParams.get("docId");
  if (!docId) return NextResponse.json({ error: "docId ausente" }, { status: 400 });
  try {
    await garantirBucket();
    const sb = supabaseAdmin();
    const { data, error } = await sb.storage.from(BUCKET).download(caminhoDoc(orgId, docId));
    if (error || !data) return NextResponse.json({ error: "não encontrado" }, { status: 404 });
    const buf = Buffer.from(await data.arrayBuffer());
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": data.type || "application/octet-stream",
        "Content-Length": String(buf.length),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("[arquivos][GET]", err);
    return NextResponse.json({ error: err.message || "falha ao baixar" }, { status: 500 });
  }
}

// POST /api/arquivos (multipart: docId, file) → salva/substitui o arquivo.
export async function POST(request) {
  if (!supabaseConfigurado()) return NextResponse.json({ error: "storage indisponível" }, { status: 503 });
  const { orgId, erro } = await orgDaSessao();
  if (erro) return erro;
  try {
    const form = await request.formData();
    const docId = form.get("docId");
    const file = form.get("file");
    if (!docId || !file || typeof file === "string") {
      return NextResponse.json({ error: "docId/file ausente" }, { status: 400 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length > LIMITE) return NextResponse.json({ error: "arquivo acima de 20 MB" }, { status: 413 });
    await garantirBucket();
    const sb = supabaseAdmin();
    const { error } = await sb.storage.from(BUCKET).upload(caminhoDoc(orgId, String(docId)), buf, {
      contentType: file.type || "application/octet-stream",
      upsert: true,
    });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[arquivos][POST]", err);
    return NextResponse.json({ error: err.message || "falha ao salvar" }, { status: 500 });
  }
}

// DELETE /api/arquivos?docId=X → remove o arquivo da organização.
export async function DELETE(request) {
  if (!supabaseConfigurado()) return NextResponse.json({ error: "storage indisponível" }, { status: 503 });
  const { orgId, erro } = await orgDaSessao();
  if (erro) return erro;
  const docId = new URL(request.url).searchParams.get("docId");
  if (!docId) return NextResponse.json({ error: "docId ausente" }, { status: 400 });
  try {
    await garantirBucket();
    const sb = supabaseAdmin();
    const { error } = await sb.storage.from(BUCKET).remove([caminhoDoc(orgId, docId)]);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[arquivos][DELETE]", err);
    return NextResponse.json({ error: err.message || "falha ao remover" }, { status: 500 });
  }
}
