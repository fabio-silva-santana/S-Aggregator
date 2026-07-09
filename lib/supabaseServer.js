// Cliente Supabase para uso EXCLUSIVO no servidor (Route Handlers).
// Usa a service key — ignora RLS — então NUNCA importe isto em código de cliente.
// O isolamento por organização é garantido filtrando toda query por org_id.
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

// Node < 22 não tem WebSocket global; o supabase-js inicia o Realtime na
// construção do cliente. Polyfill evita o erro (não usamos Realtime aqui).
if (typeof globalThis.WebSocket === "undefined") globalThis.WebSocket = WebSocket;

let _client = null;

export function supabaseAdmin() {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase não configurado (defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY).");
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}

// true se as variáveis do Supabase estão presentes (permite degradar sem banco)
export function supabaseConfigurado() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
