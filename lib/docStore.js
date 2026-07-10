// Armazenamento de documentos anexados (contrato social, certidões, atestados).
// FASE 6: os arquivos passam a ser persistidos no Supabase Storage (no servidor,
// escopados por organização) — antes ficavam presos ao IndexedDB de um único
// navegador. As assinaturas são mantidas, então o restante do app não muda.
// A leitura tem fallback no IndexedDB para blobs salvos localmente antes da
// migração (nenhum documento local é perdido).

const DB = "saggregator";
const STORE = "documentos";

// ---------- Fallback: IndexedDB local (leitura de blobs antigos) ----------
function abrirIDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("sem indexedDB"));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function lerIDB(id) {
  return abrirIDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      })
  );
}

function removerIDB(id) {
  return abrirIDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      })
  );
}

// ---------- Padrão: Supabase Storage via rota autenticada ----------
export async function salvarDoc(id, file) {
  const fd = new FormData();
  fd.append("docId", id);
  fd.append("file", file, file.name || String(id));
  const r = await fetch("/api/arquivos", { method: "POST", body: fd });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.error || `falha ao salvar documento (${r.status})`);
  }
  return id;
}

export async function lerDoc(id) {
  // 1) servidor (fonte única a partir da FASE 6)
  try {
    const r = await fetch(`/api/arquivos?docId=${encodeURIComponent(id)}`);
    if (r.ok) return await r.blob();
  } catch {
    /* rede indisponível → tenta local */
  }
  // 2) fallback: blob local salvo antes da migração
  return lerIDB(id).catch(() => null);
}

export async function removerDoc(id) {
  await fetch(`/api/arquivos?docId=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
  await removerIDB(id).catch(() => {});
}

export async function baixarDoc(id, nome) {
  const blob = await lerDoc(id);
  if (!blob) return false;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome || "documento";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
