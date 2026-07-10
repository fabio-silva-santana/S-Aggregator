"use client";
// Landing page pública (FASE 8) — mostrada antes do login.
// Design próprio seguindo a arte-mãe da marca (constelação verde):
// fundo espacial escuro fixo (independente do tema do app), brilhos verdes,
// mockups reais da plataforma e carrosséis das entidades do Sistema S.
import { useEffect, useId, useRef } from "react";
import { signIn } from "next-auth/react";
import { MAPA_UF } from "@/lib/mapaBrasil";

/* ---------- marca (local para não acoplar ao page.jsx) ---------- */
function LdLogo({ size = 30 }) {
  const gid = `ldgrad-${useId()}`;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="S-Aggregator">
      <defs>
        <linearGradient id={gid} x1="10" y1="4" x2="40" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3DBB4E" /><stop offset="1" stopColor="#0E7A34" />
        </linearGradient>
      </defs>
      <path d="M38 12.5C38 8.4 34.6 5 30.5 5H24c-6.6 0-12 5.4-12 12 0 6.6 5.4 11 12 11h3.5c2.5 0 4.5 1.8 4.5 4s-2 4-4.5 4H14c-2.8 0-5 2.2-5 5s2.2 4 5 4h13.5c6.6 0 12-5.4 12-12 0-6.6-5.4-11-12-11H24c-2.5 0-4.5-1.8-4.5-4s2-4 4.5-4h9c2.8 0 5-2.2 5-4.5z" fill={`url(#${gid})`} />
      <rect x="2" y="19" width="4" height="4" rx="1" fill="#2FA746" />
      <rect x="8" y="24" width="3" height="3" rx="0.8" fill="#3DBB4E" />
      <rect x="4" y="28" width="3" height="3" rx="0.8" fill="#6FCF6F" />
    </svg>
  );
}

/* ---------- dados de apresentação ---------- */
const LOGOS_TIRA = [
  { src: "/logos/sesi.png", alt: "SESI" },
  { src: "/logos/senai.png", alt: "SENAI" },
  { src: "/logos/sesc.png", alt: "SESC" },
  { src: "/logos/senac.png", alt: "SENAC" },
  { src: "/logos/senar.png", alt: "SENAR" },
  { src: "/logos/sebrae.jpg", alt: "SEBRAE" },
  { src: "/logos/sest-senat.jpg", alt: "SEST SENAT" },
  { src: "/logos/sescoop.jpg", alt: "SESCOOP" },
];

const ENTIDADES_LP = [
  { img: "/landing/ent-sesi.jpg", nome: "SESI", area: "Indústria", desc: "Saúde, segurança do trabalho e bem-estar para o trabalhador da indústria." },
  { img: "/landing/ent-senai.jpg", nome: "SENAI", area: "Indústria", desc: "Educação profissional e serviços de tecnologia e inovação para a indústria." },
  { img: "/landing/ent-sesc.jpg", nome: "SESC", area: "Comércio", desc: "Cultura, lazer, turismo, saúde e alimentação para o setor do comércio." },
  { img: "/landing/ent-senac.jpg", nome: "SENAC", area: "Comércio e serviços", desc: "Formação profissional para comércio de bens, serviços e turismo." },
  { img: "/landing/ent-senar.jpg", nome: "SENAR", area: "Agronegócio", desc: "Capacitação, assistência técnica e promoção social para o campo." },
  { img: "/landing/ent-sebrae.jpg", nome: "SEBRAE", area: "Micro e pequenas empresas", desc: "Consultoria, capacitação e fomento ao empreendedorismo." },
  { img: "/landing/ent-sest-senat.jpg", nome: "SEST/SENAT", area: "Transporte", desc: "Saúde e desenvolvimento profissional para o setor de transporte." },
  { img: "/landing/ent-sescoop.jpg", nome: "SESCOOP", area: "Cooperativismo", desc: "Ensino, monitoramento e fomento às cooperativas brasileiras." },
];

const RADAR_LINHAS = [
  { ent: "SESI", cor: "#2563eb", objeto: "Serviços de saúde ocupacional e exames periódicos", uf: "PE", status: "Aberto" },
  { ent: "SENAI", cor: "#7c3aed", objeto: "Aquisição de equipamentos para laboratório de mecatrônica", uf: "SP", status: "Aberto" },
  { ent: "SENAC", cor: "#be185d", objeto: "Plataforma EAD para cursos de gastronomia e hotelaria", uf: "RJ", status: "Aberto" },
  { ent: "SEBRAE", cor: "#b45309", objeto: "Consultoria em transformação digital para pequenos negócios", uf: "DF", status: "Em andamento" },
  { ent: "SESC", cor: "#0f766e", objeto: "Fornecimento de gêneros alimentícios para unidades de turismo", uf: "RS", status: "Aberto" },
];

const UFS_BOLHA = [
  ["SP", 3.2], ["PE", 2.4], ["DF", 2.0], ["RS", 2.4], ["BA", 2.1], ["PA", 1.7], ["RJ", 2.2], ["AM", 1.5],
];

/* ---------- página ---------- */
export default function Landing() {
  const raizRef = useRef(null);

  // revelação suave ao rolar (sem dependências)
  useEffect(() => {
    const els = raizRef.current?.querySelectorAll(".ld-rev") || [];
    const io = new IntersectionObserver(
      (entradas) => entradas.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("on"); io.unobserve(en.target); } }),
      { threshold: 0.12 }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const entrar = () => signIn("google");

  return (
    <div className="ld-root" ref={raizRef}>
      {/* ---------- topo ---------- */}
      <header className="ld-header">
        <div className="ld-wrap ld-header-in">
          <a className="ld-brand" href="#" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
            <LdLogo size={30} />
            <span className="ld-brand-txt">S<i>-</i>Aggregator</span>
          </a>
          <nav className="ld-nav">
            <a href="#plataforma">Plataforma</a>
            <a href="#entidades">Entidades</a>
            <a href="#como-funciona">Como funciona</a>
          </nav>
          <div className="ld-header-acoes">
            <button className="ld-btn ld-btn-primaria" onClick={entrar}>Entrar</button>
          </div>
        </div>
      </header>

      {/* ---------- hero ---------- */}
      <section className="ld-hero">
        <div className="ld-glow ld-glow-a" aria-hidden="true" />
        <div className="ld-glow ld-glow-b" aria-hidden="true" />
        <div className="ld-wrap ld-hero-grid">
          <div className="ld-hero-txt">
            <div className="ld-kicker"><span className="ld-pulse" />Radar nacional de licitações do Sistema S</div>
            <h1>Todas as oportunidades do <em>Sistema S</em>, em um único radar.</h1>
            <p className="ld-lead">
              O S-Aggregator monitora continuamente os portais de compras do SESI, SENAI, SESC, SENAC,
              SENAR, SEBRAE, SEST/SENAT, SESCOOP e Correios — e usa inteligência artificial para mostrar,
              em segundos, quais editais valem a participação da sua empresa.
            </p>
            <div className="ld-cta-row">
              <button className="ld-btn ld-btn-primaria ld-btn-grande" onClick={entrar}>
                Começar agora
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
              <a className="ld-btn ld-btn-fantasma ld-btn-grande" href="#plataforma">Conhecer a plataforma</a>
            </div>
            <dl className="ld-stats">
              <div><dt>1.400+</dt><dd>processos monitorados</dd></div>
              <div><dt>27</dt><dd>unidades da federação</dd></div>
              <div><dt>21</dt><dd>fontes oficiais</dd></div>
              <div><dt>9</dt><dd>entidades cobertas</dd></div>
            </dl>
          </div>
          <figure className="ld-hero-arte">
            <img src="/landing/hero-constelacao.jpg" alt="Constelação das entidades do Sistema S conectadas ao S-Aggregator" />
          </figure>
        </div>

        {/* tira de logos em movimento */}
        <div className="ld-tira" aria-label="Entidades monitoradas">
          <div className="ld-tira-faixa">
            {[...LOGOS_TIRA, ...LOGOS_TIRA].map((l, i) => (
              <span className="ld-tira-item" key={i}><img src={l.src} alt={i < LOGOS_TIRA.length ? l.alt : ""} aria-hidden={i >= LOGOS_TIRA.length} /></span>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- plataforma (mockups) ---------- */}
      <section className="ld-sec" id="plataforma">
        <div className="ld-wrap">
          <div className="ld-sec-head ld-rev">
            <span className="ld-etiqueta">A plataforma</span>
            <h2>Do edital publicado à proposta entregue,<br />tudo em uma tela.</h2>
            <p>Monitoramento em tempo real, mapa nacional, análise executiva com IA e gestão completa de cada participação.</p>
          </div>

          <div className="ld-bento">
            {/* radar */}
            <article className="ld-cel ld-cel-radar ld-rev">
              <div className="ld-janela">
                <div className="ld-janela-top">
                  <span className="ld-dots"><i /><i /><i /></span>
                  <span className="ld-janela-titulo">Radar de Oportunidades</span>
                  <span className="ld-vivo"><span className="ld-pulse" />monitorando</span>
                </div>
                <div className="ld-filtros">
                  <span className="ld-fchip on">Todas</span><span className="ld-fchip">Abertas</span><span className="ld-fchip">Meus interesses 🎯</span>
                  <span className="ld-fbusca">🔍 manutenção predial…</span>
                </div>
                <div className="ld-tabela">
                  {RADAR_LINHAS.map((r, i) => (
                    <div className="ld-linha" key={i} style={{ animationDelay: `${i * 0.4}s` }}>
                      <span className="ld-echip" style={{ background: r.cor }}>{r.ent}</span>
                      <span className="ld-obj">{r.objeto}</span>
                      <span className="ld-uf">{r.uf}</span>
                      <span className={`ld-schip ${r.status === "Aberto" ? "ab" : "an"}`}>{r.status}</span>
                    </div>
                  ))}
                </div>
              </div>
              <h3>Radar em tempo real</h3>
              <p>Coleta direta das fontes oficiais das entidades, com filtros por entidade, estado, segmento, modalidade e status.</p>
            </article>

            {/* mapa */}
            <article className="ld-cel ld-cel-mapa ld-rev">
              <div className="ld-mapa-quadro">
                <svg viewBox="0 0 100 99" className="ld-mapa-svg" aria-label="Mapa do Brasil com oportunidades por estado">
                  {Object.entries(MAPA_UF).map(([uf, m]) => <path key={uf} d={m.d} className="ld-mapa-uf" />)}
                  {UFS_BOLHA.map(([uf, r], i) => (
                    <g key={uf} className="ld-mapa-bolha" style={{ animationDelay: `${i * 0.5}s` }}>
                      <circle cx={MAPA_UF[uf].cx} cy={MAPA_UF[uf].cy} r={r} />
                    </g>
                  ))}
                </svg>
              </div>
              <h3>Mapa nacional interativo</h3>
              <p>Contornos reais dos 27 estados. Clique em uma UF e veja os processos dela na hora.</p>
            </article>

            {/* relatório IA */}
            <article className="ld-cel ld-cel-ia ld-rev">
              <div className="ld-ia-quadro">
                <div className="ld-ia-top">
                  <div className="ld-score"><span>88</span></div>
                  <div>
                    <div className="ld-ia-rotulo">SCORE DE ADERÊNCIA</div>
                    <span className="ld-ia-badge">✓ RECOMENDAÇÃO: PARTICIPAR</span>
                  </div>
                </div>
                {["Resumo executivo", "Matriz de riscos", "Checklist de habilitação", "Decisão estratégica"].map((s, i) => (
                  <div className="ld-ia-sec" key={i}>
                    <span className="ld-ia-num">{i + 1}</span><span className="ld-ia-nome">{s}</span>
                    <span className="ld-ia-barra" style={{ width: `${78 - i * 14}%` }} />
                  </div>
                ))}
              </div>
              <h3>Relatório executivo com IA</h3>
              <p>18 seções: valores, cronograma, riscos, conformidade com o regulamento da entidade e parecer final — com data de geração e pronto em PDF.</p>
            </article>

            {/* kanban */}
            <article className="ld-cel ld-cel-kb ld-rev">
              <div className="ld-kb-quadro">
                {[["Análise", 2], ["Documentos", 2], ["Lances", 1]].map(([col, n], i) => (
                  <div className="ld-kb-col" key={col}>
                    <span className="ld-kb-titulo">{col}</span>
                    {Array.from({ length: n }).map((_, j) => (
                      <div className="ld-kb-card" key={j}>
                        <span className="ld-kb-b1" /><span className="ld-kb-b2" />
                        <span className="ld-kb-prog"><i style={{ width: `${35 + i * 22 + j * 12}%` }} /></span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <h3>Gestão até a homologação</h3>
              <p>Kanban, calendário, checklist de documentos com anexos e alertas de certidões vencendo.</p>
            </article>

            {/* chat */}
            <article className="ld-cel ld-cel-chat ld-rev">
              <div className="ld-chat-quadro">
                <div className="ld-chat-msg user">Qual o prazo para impugnação?</div>
                <div className="ld-chat-msg ia">O edital fixa o prazo em até 5 dias úteis antes da sessão, conforme o item 9.1 e o regulamento da entidade.</div>
                <div className="ld-chat-msg user dig"><i /><i /><i /></div>
              </div>
              <h3>Pergunte ao edital</h3>
              <p>A IA lê o edital, os anexos e o regulamento de compras da entidade — e responde citando os artigos.</p>
            </article>
          </div>

          {/* selos rápidos */}
          <div className="ld-selos ld-rev">
            <span>⚡ Alertas por perfil de interesse</span>
            <span>🧾 PDF timbrado por processo</span>
            <span>🏢 Cadastro automático via CNPJ</span>
            <span>📅 Certidões com alerta de validade</span>
            <span>🔒 Dados isolados por organização</span>
          </div>
        </div>
      </section>

      {/* ---------- entidades (carrossel de fotos) ---------- */}
      <section className="ld-sec ld-sec-ent" id="entidades">
        <div className="ld-wrap">
          <div className="ld-sec-head ld-rev">
            <span className="ld-etiqueta">Cobertura</span>
            <h2>Todo o Sistema S. E os Correios também.</h2>
            <p>Cada entidade compra de um jeito, em um portal diferente, com um regulamento próprio. O S-Aggregator unifica tudo — e a IA conhece o regulamento de cada uma.</p>
          </div>
        </div>
        <div className="ld-carrossel ld-rev">
          <div className="ld-carrossel-faixa">
            {[...ENTIDADES_LP, ...ENTIDADES_LP].map((e, i) => (
              <figure className="ld-ecard" key={i} aria-hidden={i >= ENTIDADES_LP.length}>
                <img src={e.img} alt={i < ENTIDADES_LP.length ? `${e.nome} — ${e.area}` : ""} loading="lazy" />
                <figcaption>
                  <span className="ld-ecard-area">{e.area}</span>
                  <strong>{e.nome}</strong>
                  <p>{e.desc}</p>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- como funciona ---------- */}
      <section className="ld-sec" id="como-funciona">
        <div className="ld-wrap">
          <div className="ld-sec-head ld-rev">
            <span className="ld-etiqueta">Como funciona</span>
            <h2>Da conta criada à primeira oportunidade<br />em três passos.</h2>
          </div>
          <ol className="ld-passos">
            <li className="ld-rev">
              <span className="ld-passo-num">1</span>
              <h3>Conecte sua empresa</h3>
              <p>Entre com o Google e informe o CNPJ. Buscamos automaticamente a situação cadastral, o porte e as atividades — e montamos o painel de certidões.</p>
            </li>
            <li className="ld-rev">
              <span className="ld-passo-num">2</span>
              <h3>Receba o que é aderente</h3>
              <p>Marque entidades, estados e segmentos de interesse. O radar destaca as oportunidades com o seu perfil e a IA pontua a aderência de cada edital.</p>
            </li>
            <li className="ld-rev">
              <span className="ld-passo-num">3</span>
              <h3>Participe e acompanhe</h3>
              <p>Relatório executivo, checklist de habilitação, kanban de fases e registro do desfecho — inclusive impugnações — em um só lugar.</p>
            </li>
          </ol>
        </div>
      </section>

      {/* ---------- chamada final ---------- */}
      <section className="ld-fim">
        <div className="ld-glow ld-glow-c" aria-hidden="true" />
        <div className="ld-wrap ld-fim-in ld-rev">
          <LdLogo size={52} />
          <h2>Pronto para agregar oportunidades?</h2>
          <p>Crie sua conta em segundos e veja o radar nacional funcionando com dados oficiais.</p>
          <button className="ld-btn ld-btn-primaria ld-btn-grande" onClick={entrar}>
            <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true"><path fill="#fff" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/><path fill="#fff" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" opacity=".8"/><path fill="#fff" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" opacity=".6"/><path fill="#fff" d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.47.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" opacity=".9"/></svg>
            Entrar com o Google
          </button>
        </div>
      </section>

      {/* ---------- rodapé ---------- */}
      <footer className="ld-rodape">
        <div className="ld-wrap ld-rodape-in">
          <div className="ld-rodape-marca">
            <LdLogo size={26} />
            <div>
              <span className="ld-brand-txt">S<i>-</i>Aggregator</span>
              <p>Agregando oportunidades de negócios do Sistema S.</p>
            </div>
          </div>
          <nav className="ld-rodape-nav">
            <a href="#plataforma">Plataforma</a>
            <a href="#entidades">Entidades</a>
            <a href="#como-funciona">Como funciona</a>
            <a href="#" onClick={(e) => { e.preventDefault(); entrar(); }}>Entrar</a>
          </nav>
        </div>
        <div className="ld-wrap ld-rodape-base">
          <span>© {new Date().getFullYear()} S-Aggregator. Todos os direitos reservados.</span>
          <span className="ld-disclaimer">
            SESI, SENAI, SESC, SENAC, SENAR, SEBRAE, SEST, SENAT, SESCOOP e Correios são marcas de suas
            respectivas instituições, citadas apenas para identificar as fontes públicas monitoradas.
          </span>
        </div>
      </footer>
    </div>
  );
}
