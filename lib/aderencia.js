// Aderência edital × perfil de interesses — compartilhado entre o app (radar,
// destaques) e o servidor (digest diário de notificações). Regra: grupos não
// vazios funcionam em AND entre si e OR dentro do grupo.
export function editalAderente(e, interesses) {
  if (!interesses) return false;
  const ent = interesses.entidades || [], seg = interesses.segmentos || [], ufs = interesses.ufs || [];
  if (!ent.length && !seg.length && !ufs.length) return false;
  if (ent.length && !ent.some((x) => (e.entidade || "").includes(x))) return false;
  if (seg.length && !seg.includes(e.segmento)) return false;
  if (ufs.length && !ufs.includes(e.uf)) return false;
  return true;
}

export function temInteresses(interesses) {
  if (!interesses) return false;
  return Boolean((interesses.entidades || []).length || (interesses.segmentos || []).length || (interesses.ufs || []).length);
}
