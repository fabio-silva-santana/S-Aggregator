// Digest diário de oportunidades abertas (módulo de notificações).
// Monta, por organização, a lista de processos ABERTOS aderentes aos interesses
// declarados no cadastro e dispara por e-mail e/ou WhatsApp.
//
// Regra de negócio (definida com o usuário): o disparo é diário e ACUMULADO —
// um processo aparece todo dia enquanto estiver aberto, junto com os que
// abriram desde então. Não há "só novidades".
import { supabaseAdmin, supabaseConfigurado } from "@/lib/supabaseServer";
import { editalAderente, temInteresses } from "@/lib/aderencia";
import { enviarEmail, enviarWhatsApp, credenciaisEmail, credenciaisWhatsApp } from "@/lib/notificar";
import { montarEmailHTML, montarEmailTexto } from "@/lib/emailTemplate";

const APP_URL = process.env.AUTH_URL || "https://s-aggregator-lemon.vercel.app";

// Seleciona e ordena os processos do dia para uma organização.
export function montarDigest(editais, interesses) {
  if (!temInteresses(interesses)) return [];
  return editais
    .filter((e) => e.status === "Aberto" && editalAderente(e, interesses))
    .sort((a, b) => {
      // quem fecha primeiro aparece primeiro; sem data, por último
      const da = a.dataAbertura || "9999-12-31";
      const db = b.dataAbertura || "9999-12-31";
      return da < db ? -1 : da > db ? 1 : 0;
    });
}

// Dispara o digest para todas as organizações com notificação ativa.
// Idempotente por dia: notificacao_log tem índice único (org_id, dia, canal).
export async function enviarDigestsDiarios(editais) {
  if (!supabaseConfigurado()) return { ok: false, erro: "supabase não configurado" };
  const sb = supabaseAdmin();
  const dia = new Date().toISOString().slice(0, 10);

  const { data: prefs, error } = await sb
    .from("notificacao_prefs")
    .select("org_id, email, telefone, canal_email, canal_whatsapp, ativo")
    .eq("ativo", true);
  if (error) {
    if (/notificacao_prefs/i.test(error.message)) return { ok: false, erro: "tabela notificacao_prefs ausente — rode docs/supabase-schema.sql" };
    throw error;
  }
  if (!prefs?.length) return { ok: true, orgs: 0, enviados: 0, nota: "nenhuma organização com notificação ativa" };

  const resumo = { orgs: prefs.length, enviados: 0, pulados: 0, erros: [], semCredencial: 0 };

  for (const p of prefs) {
    // já enviado hoje? (o índice único também protege em corrida)
    const { data: jaFoi } = await sb.from("notificacao_log").select("canal").eq("org_id", p.org_id).eq("dia", dia);
    const feitos = new Set((jaFoi || []).map((x) => x.canal));

    const [{ data: perfil }, { data: org }] = await Promise.all([
      sb.from("company_profile").select("data").eq("org_id", p.org_id).maybeSingle(),
      sb.from("organizations").select("name").eq("id", p.org_id).maybeSingle(),
    ]);
    const interesses = perfil?.data?.interesses;
    const lista = montarDigest(editais, interesses);
    if (!lista.length) { resumo.pulados++; continue; } // não enviamos e-mail vazio

    const registrar = async (canal, r) => {
      const status = r.ok ? "enviado" : r.motivo === "sem_credencial" ? "sem_credencial" : "erro";
      if (status === "enviado") resumo.enviados++;
      if (status === "sem_credencial") resumo.semCredencial++;
      if (status === "erro") resumo.erros.push(`${canal}/${p.org_id}: ${r.motivo}`);
      await sb.from("notificacao_log").upsert(
        { org_id: p.org_id, dia, canal, status, qtd: lista.length, detalhe: r.ok ? null : String(r.motivo).slice(0, 200) },
        { onConflict: "org_id,dia,canal" }
      );
    };

    if (p.canal_email && p.email && !feitos.has("email")) {
      const r = await enviarEmail({
        para: p.email,
        assunto: `${lista.length} ${lista.length === 1 ? "oportunidade aberta" : "oportunidades abertas"} no seu perfil — ${new Date().toLocaleDateString("pt-BR")}`,
        html: montarEmailHTML(lista, org?.name),
        texto: montarEmailTexto(lista),
      });
      await registrar("email", r);
    }

    if (p.canal_whatsapp && p.telefone && !feitos.has("whatsapp")) {
      // template curto + link (mensagem iniciada pela empresa exige template aprovado)
      const primeiro = lista[0];
      const r = await enviarWhatsApp({
        para: p.telefone,
        variaveis: [
          String(lista.length),
          `${primeiro.entidade}/${primeiro.uf}`,
          (primeiro.objeto || "").slice(0, 60),
          APP_URL,
        ],
      });
      await registrar("whatsapp", r);
    }
  }

  return { ok: resumo.erros.length === 0, ...resumo, credEmail: credenciaisEmail(), credWhatsApp: credenciaisWhatsApp() };
}

export { montarEmailHTML, montarEmailTexto };
