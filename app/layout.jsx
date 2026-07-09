import "./globals.css";

export const metadata = {
  title: "S-Aggregator — Radar de Licitações do Sistema S",
  description: "Radar nacional de licitações do Sistema S e Correios com análise por IA",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1b9e4b",
};

// Aplica o tema salvo (ou a preferência do sistema) antes da 1ª pintura — evita flash
const themeScript = `(function(){try{var t=localStorage.getItem('saggregator_tema');if(!t){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'escuro':'claro';}document.documentElement.setAttribute('data-tema',t);}catch(e){}})();`;

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
