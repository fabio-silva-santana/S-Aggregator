// Preferências de notificação da organização + envio de teste.
//   GET  /api/notificacoes        → { prefs, credenciais }
//   POST /api/notificacoes        → salva { email, telefone, canalEmail, canalWhatsapp, ativo }
//   POST /api/notificacoes?teste=1→ envia o digest de hoje só para esta org
// Autenticado (Auth.js) e escopado por org_id.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { supabaseAdmin, supabaseConfigurado } from "@/lib/supabaseServer";
import { garantirUsuarioEOrg } from "@/lib/orgServer";
import { coletarEditais } from "@/lib/coletores";
import { montarDigest, montarEmailHTML, montarEmailTexto } from "@/lib/digest";
import { enviarEmail, enviarWhatsApp, credenciaisEmail, credenciaisWhatsApp } from "@/lib/notificar";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function orgDaSessao() {
  const session = await auth();
  if (!session?.user) return { erro: NextResponse.json({ error: "não autenticado" }, { status: 401 }) };
  const { orgId } = await garantirUsuarioEOrg(session.user);
  return { orgId, user: session.user };
}

function tabelaAusente(err) {
  return /notificacao_prefs/i.test(`${err?.message}`) && /exist|schema cache|relation/i.test(`${err?.message}`);
}

export async function GET() {
  if (!supabaseConfigurado()) return NextResponse.json({ prefs: null });
  const { orgId, erro } = await orgDaSessao();
  if (erro) return erro;
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb.from("notificacao_prefs").select("*").eq("org_id", orgId).maybeSingle();
    if (error) throw error;
    return NextResponse.json({
      prefs: data || null,
      credenciais: { email: credenciaisEmail(), whatsapp: credenciaisWhatsApp() },
    });
  } catch (err) {
    if (tabelaAusente(err)) return NextResponse.json({ prefs: null, semTabela: true });
    console.error("[notificacoes][GET]", err);
    return NextResponse.json({ prefs: null });
  }
}

export async function POST(request) {
  if (!supabaseConfigurado()) return NextResponse.json({ error: "sem banco" }, { status: 503 });
  const { orgId, user, erro } = await orgDaSessao();
  if (erro) return erro;
  const teste = new URL(request.url).searchParams.get("teste");

  // ---- envio de teste: monta o digest de hoje e manda só para esta org ----
  if (teste) {
    try {
      const sb = supabaseAdmin();
      const [{ data: prefs }, { data: perfil }, { data: org }] = await Promise.all([
        sb.from("notificacao_prefs").select("*").eq("org_id", orgId).maybeSingle(),
        sb.from("company_profile").select("data").eq("org_id", orgId).maybeSingle(),
        sb.from("organizations").select("name").eq("id", orgId).maybeSingle(),
      ]);
      if (!prefs) return NextResponse.json({ error: "salve suas preferências antes de testar" }, { status: 400 });
      const { editais } = await coletarEditais();
      const lista = montarDigest(editais, perfil?.data?.interesses);
      if (!lista.length) {
        return NextResponse.json({ ok: false, vazio: true, mensagem: "Nenhuma oportunidade aberta bate com os seus interesses agora — nada seria enviado hoje." });
      }
      const resultados = {};
      if (prefs.canal_email && prefs.email) {
        resultados.email = await enviarEmail({
          para: prefs.email,
          assunto: `[teste] ${lista.length} oportunidades abertas no seu perfil`,
          html: montarEmailHTML(lista, org?.name),
          texto: montarEmailTexto(lista),
        });
      }
      if (prefs.canal_whatsapp && prefs.telefone) {
        const p0 = lista[0];
        resultados.whatsapp = await enviarWhatsApp({
          para: prefs.telefone,
          variaveis: [String(lista.length), `${p0.entidade}/${p0.uf}`, (p0.objeto || "").slice(0, 60), process.env.AUTH_URL || ""],
        });
      }
      return NextResponse.json({ ok: true, qtd: lista.length, resultados });
    } catch (err) {
      console.error("[notificacoes][teste]", err);
      return NextResponse.json({ error: err.message || "falha no teste" }, { status: 500 });
    }
  }

  // ---- salvar preferências ----
  const body = await request.json().catch(() => ({}));
  try {
    const sb = supabaseAdmin();
    const linha = {
      org_id: orgId,
      email: body.email === "" ? null : (body.email ?? user.email ?? null),
      telefone: body.telefone === "" ? null : (body.telefone ?? null),
      canal_email: Boolean(body.canalEmail),
      canal_whatsapp: Boolean(body.canalWhatsapp),
      ativo: body.ativo !== false,
      updated_at: new Date().toISOString(),
    };
    const { error } = await sb.from("notificacao_prefs").upsert(linha, { onConflict: "org_id" });
    if (error) throw error;
    return NextResponse.json({ ok: true, prefs: linha });
  } catch (err) {
    if (tabelaAusente(err)) return NextResponse.json({ ok: false, semTabela: true });
    console.error("[notificacoes][POST]", err);
    return NextResponse.json({ error: err.message || "falha ao salvar" }, { status: 500 });
  }
}
