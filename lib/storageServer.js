// Supabase Storage no servidor (FASE 6). Guarda os arquivos anexados pela
// organização (contrato social, certidões, anexos de checklist) num bucket
// privado. O isolamento por organização é garantido pelo prefixo do caminho
// ({orgId}/...), sempre derivado da sessão no servidor — nunca do cliente.
import { supabaseAdmin } from "@/lib/supabaseServer";

export const BUCKET = "documentos";

let _bucketOk = false;

// Cria o bucket privado na primeira vez (idempotente) — evita passo manual no deploy.
export async function garantirBucket() {
  if (_bucketOk) return;
  const sb = supabaseAdmin();
  const { data } = await sb.storage.getBucket(BUCKET);
  if (!data) {
    const { error } = await sb.storage.createBucket(BUCKET, {
      public: false,
      fileSizeLimit: "20MB",
    });
    // "already exists" (corrida entre instâncias) não é erro real
    if (error && !/exist/i.test(error.message || "")) throw error;
  }
  _bucketOk = true;
}

// Caminho do arquivo dentro do bucket, escopado por organização.
export function caminhoDoc(orgId, docId) {
  const safe = String(docId).replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${orgId}/${safe}`;
}
