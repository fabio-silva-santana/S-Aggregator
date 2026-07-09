"use client";
// Provê a sessão do Auth.js para os componentes cliente (useSession/signIn/signOut).
import { SessionProvider } from "next-auth/react";

export default function Providers({ children }) {
  return <SessionProvider>{children}</SessionProvider>;
}
