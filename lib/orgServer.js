// Lógica de organização no servidor (FASE 4b). Sempre via service key.
import { supabaseAdmin } from "@/lib/supabaseServer";

// Garante que o usuário logado exista e pertença a uma organização.
// Novo usuário → cria users + organizations + organization_members(owner) + company_profile.
// Retorna { orgId, role, novoUsuario }.
export async function garantirUsuarioEOrg(user) {
  const sb = supabaseAdmin();
  const userId = user.id || user.sub;
  if (!userId) throw new Error("sessão sem id de usuário");

  // upsert do usuário (id = sub do Google)
  await sb.from("users").upsert({
    id: userId,
    email: user.email || null,
    name: user.name || null,
    image: user.image || null,
  }, { onConflict: "id" });

  // já é membro de alguma org?
  const { data: membros, error: eMembro } = await sb
    .from("organization_members")
    .select("org_id, role")
    .eq("user_id", userId)
    .limit(1);
  if (eMembro) throw eMembro;

  if (membros && membros.length) {
    return { orgId: membros[0].org_id, role: membros[0].role, novoUsuario: false };
  }

  // cria a organização inicial do usuário
  const nome = user.name ? `Empresa de ${user.name.split(" ")[0]}` : "Minha empresa";
  const { data: org, error: eOrg } = await sb
    .from("organizations")
    .insert({ name: nome })
    .select("id")
    .single();
  if (eOrg) throw eOrg;

  const { error: eVinc } = await sb.from("organization_members").insert({
    org_id: org.id, user_id: userId, role: "owner",
  });
  if (eVinc) throw eVinc;

  await sb.from("company_profile").insert({ org_id: org.id, data: {} });

  return { orgId: org.id, role: "owner", novoUsuario: true };
}

// Carrega o snapshot completo da organização (perfil + processos).
export async function carregarDadosOrg(orgId) {
  const sb = supabaseAdmin();
  const [org, perfil, procs] = await Promise.all([
    sb.from("organizations").select("*").eq("id", orgId).single(),
    sb.from("company_profile").select("data").eq("org_id", orgId).maybeSingle(),
    sb.from("processes").select("id, data").eq("org_id", orgId),
  ]);
  if (org.error) throw org.error;
  return {
    organizacao: org.data,
    empresa: perfil.data?.data || null,
    pipeline: (procs.data || []).map((r) => r.data),
  };
}
