// Adaptadores de envio das notificações diárias.
//   E-mail    → Resend (RESEND_API_KEY + RESEND_FROM)
//   WhatsApp  → WhatsApp Business Cloud API da Meta
//               (WHATSAPP_TOKEN + WHATSAPP_PHONE_ID + WHATSAPP_TEMPLATE)
// Sem credencial, devolvem { ok:false, motivo:"sem_credencial" } — o cron
// registra isso no log e segue, sem quebrar nada.
//
// Por que a API oficial da Meta: bibliotecas não-oficiais (Baileys e afins)
// levam ao banimento do número. Mensagens iniciadas pela empresa fora da
// janela de 24h EXIGEM template aprovado — por isso o WhatsApp leva um
// resumo curto + link, e o detalhamento completo vai no e-mail.

const RESEND_URL = "https://api.resend.com/emails";

export function credenciaisEmail() {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM);
}
export function credenciaisWhatsApp() {
  return Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID && process.env.WHATSAPP_TEMPLATE);
}

export async function enviarEmail({ para, assunto, html, texto }) {
  if (!credenciaisEmail()) return { ok: false, motivo: "sem_credencial" };
  try {
    const r = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: process.env.RESEND_FROM, to: [para], subject: assunto, html, text: texto }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, motivo: j.message || `HTTP ${r.status}` };
    return { ok: true, id: j.id };
  } catch (err) {
    return { ok: false, motivo: err.message || "falha de rede" };
  }
}

// Normaliza para E.164 sem "+" (formato aceito pela Cloud API).
// "(81) 99999-8888" → "5581999998888"
export function normalizarTelefone(tel) {
  const d = String(tel || "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("55")) return d.length >= 12 ? d : null;
  if (d.length === 10 || d.length === 11) return `55${d}`; // DDD + número
  return d.length >= 12 ? d : null;
}

// Envia o template aprovado. Variáveis do corpo na ordem {{1}}, {{2}}, ...
export async function enviarWhatsApp({ para, variaveis }) {
  if (!credenciaisWhatsApp()) return { ok: false, motivo: "sem_credencial" };
  const numero = normalizarTelefone(para);
  if (!numero) return { ok: false, motivo: "telefone inválido" };
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: numero,
        type: "template",
        template: {
          name: process.env.WHATSAPP_TEMPLATE,
          language: { code: process.env.WHATSAPP_TEMPLATE_LANG || "pt_BR" },
          components: [{ type: "body", parameters: variaveis.map((v) => ({ type: "text", text: String(v) })) }],
        },
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, motivo: j.error?.message || `HTTP ${r.status}` };
    return { ok: true, id: j.messages?.[0]?.id };
  } catch (err) {
    return { ok: false, motivo: err.message || "falha de rede" };
  }
}
