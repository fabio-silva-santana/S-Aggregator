// Auth.js v5 (NextAuth) — configuração central de autenticação (FASE 4).
// Lê automaticamente AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET e AUTH_SECRET do ambiente.
// FASE 4a: sessão via JWT (sem banco). E-mail/senha e magic link entram na 4b,
// quando houver Supabase para guardar usuários e tokens de verificação.
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  session: { strategy: "jwt" },
  callbacks: {
    // expõe o id do provedor na sessão do cliente (útil para escopar dados por usuário)
    session({ session, token }) {
      if (session.user && token.sub) session.user.id = token.sub;
      return session;
    },
  },
  // confia no host de deploy (Vercel) sem exigir AUTH_URL em produção
  trustHost: true,
});
