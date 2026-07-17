// Template do e-mail do resumo diário — módulo PURO (sem acesso a banco ou
// rede), para poder ser renderizado e revisado isoladamente.
const APP_URL = process.env.AUTH_URL || "https://s-aggregator-lemon.vercel.app";
const MAX_EMAIL = 40;   // processos listados no e-mail
const VERDE = "#1b9e4b";

function fmtData(iso) {
  if (!iso) return "a confirmar";
  const [a, m, d] = iso.split("-");
  return d && m && a ? `${d}/${m}/${a}` : iso;
}

function diasAte(iso) {
  if (!iso) return null;
  const hoje = new Date(new Date().toISOString().slice(0, 10));
  return Math.round((new Date(iso) - hoje) / 86400000);
}


function escapar(s) {
  return String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

export function montarEmailHTML(lista, nomeOrg) {
  const hoje = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  const linhas = lista.slice(0, MAX_EMAIL).map((e) => {
    const d = diasAte(e.dataAbertura);
    const urgente = d !== null && d >= 0 && d <= 3;
    const prazo = d === null ? "" : d < 0 ? "" : d === 0 ? "encerra hoje" : d === 1 ? "encerra amanhã" : `faltam ${d} dias`;
    return `
      <tr><td style="padding:0 0 14px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e3e9e5;border-radius:10px;border-left:4px solid ${urgente ? "#d97706" : VERDE}">
          <tr><td style="padding:14px 16px;font-family:Arial,Helvetica,sans-serif">
            <div style="font-size:11px;color:#5b6b62;margin-bottom:5px">
              <strong style="color:${VERDE}">${escapar(e.entidade)}</strong>
              &nbsp;·&nbsp;${escapar(e.uf || "")}
              &nbsp;·&nbsp;${escapar(e.modalidade || "")}
              ${prazo ? `&nbsp;·&nbsp;<strong style="color:${urgente ? "#b45309" : "#5b6b62"}">${prazo}</strong>` : ""}
            </div>
            <div style="font-size:14px;font-weight:bold;color:#16201b;margin-bottom:4px">${escapar(e.numero)}</div>
            <div style="font-size:13px;color:#3d4a43;line-height:1.5;margin-bottom:8px">${escapar((e.objeto || "").slice(0, 260))}${(e.objeto || "").length > 260 ? "…" : ""}</div>
            <div style="font-size:11px;color:#5b6b62">
              <strong>Órgão:</strong> ${escapar(e.regional || e.entidade)}<br>
              <strong>Abertura/sessão:</strong> ${fmtData(e.dataAbertura)}
              ${e.segmento ? `<br><strong>Segmento:</strong> ${escapar(e.segmento)}` : ""}
            </div>
            ${e.portal ? `<div style="margin-top:10px"><a href="${escapar(e.portal)}" style="font-size:11px;color:${VERDE};font-weight:bold;text-decoration:none">Ver no portal oficial →</a></div>` : ""}
          </td></tr>
        </table>
      </td></tr>`;
  }).join("");

  const resto = lista.length > MAX_EMAIL ? `<p style="font-size:12px;color:#5b6b62;font-family:Arial,Helvetica,sans-serif">+ ${lista.length - MAX_EMAIL} outras oportunidades no radar.</p>` : "";

  // <head> com charset é obrigatório: sem ele os clientes de e-mail assumem
  // latin1 e a acentuação chega corrompida ("AquisiÃ§Ã£o").
  return `<!doctype html><html lang="pt-BR"><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Oportunidades abertas no seu perfil</title>
  </head><body style="margin:0;padding:0;background:#f2f6f3">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f6f3;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e3e9e5">
        <tr><td style="background:linear-gradient(135deg,#1b9e4b,#0e7a34);padding:22px 24px;font-family:Arial,Helvetica,sans-serif">
          <div style="font-size:19px;font-weight:bold;color:#ffffff;letter-spacing:-0.4px">S-Aggregator</div>
          <div style="font-size:11px;color:#cdeed9;margin-top:2px">Agregando oportunidades de negócios do Sistema S</div>
        </td></tr>
        <tr><td style="padding:24px 24px 8px;font-family:Arial,Helvetica,sans-serif">
          <div style="font-size:17px;font-weight:bold;color:#16201b">${lista.length} ${lista.length === 1 ? "oportunidade aberta" : "oportunidades abertas"} no seu perfil</div>
          <div style="font-size:12px;color:#5b6b62;margin-top:4px">${escapar(nomeOrg || "Sua empresa")} · ${hoje}</div>
        </td></tr>
        <tr><td style="padding:18px 24px 0">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${linhas}</table>
          ${resto}
        </td></tr>
        <tr><td style="padding:6px 24px 26px" align="center">
          <a href="${APP_URL}" style="display:inline-block;background:${VERDE};color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;text-decoration:none;padding:12px 26px;border-radius:9px">Abrir o radar completo</a>
        </td></tr>
        <tr><td style="background:#f7faf8;border-top:1px solid #e3e9e5;padding:16px 24px;font-family:Arial,Helvetica,sans-serif">
          <div style="font-size:10.5px;color:#7b8b82;line-height:1.6">
            Você recebe este resumo diário porque cadastrou interesses no S-Aggregator.
            Os processos listados permanecem no resumo enquanto estiverem abertos.<br>
            Para alterar entidades, estados, segmentos ou desativar os alertas, acesse
            <a href="${APP_URL}" style="color:${VERDE}">Cadastro da Empresa → Notificações</a>.
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}

export function montarEmailTexto(lista) {
  return lista.slice(0, MAX_EMAIL).map((e, i) =>
    `${i + 1}. ${e.numero} — ${e.entidade}/${e.uf}\n   Órgão: ${e.regional || e.entidade}\n   Abertura: ${fmtData(e.dataAbertura)}\n   Objeto: ${(e.objeto || "").slice(0, 200)}\n   ${e.portal || ""}`
  ).join("\n\n");
}
