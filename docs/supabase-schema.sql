-- ============================================================
-- S-Aggregator — Schema Postgres (Supabase) — FASE 4b
-- Rode este bloco UMA vez no Supabase → SQL Editor → New query → Run.
--
-- Modelo: User → Organization (1:N) com role (owner/member).
-- Isolamento: RLS ligado em TODAS as tabelas, SEM policies para os papéis
-- anon/authenticated → o navegador (chave publishable) não lê/escreve nada
-- direto. Todo acesso passa pelo servidor Next.js autenticado (Auth.js),
-- que usa a service key (ignora RLS) e SEMPRE filtra por org_id.
-- ============================================================

-- Usuários (espelho do login Auth.js; id = "sub" do Google)
create table if not exists public.users (
  id          text primary key,
  email       text,
  name        text,
  image       text,
  created_at  timestamptz not null default now()
);

-- Organizações (a empresa do usuário). Campos de onboarding alimentam o scoring.
create table if not exists public.organizations (
  id               uuid primary key default gen_random_uuid(),
  name             text not null default 'Minha empresa',
  cnpj             text,
  cnaes            text[]  not null default '{}',   -- CNAEs de atuação
  regioes          text[]  not null default '{}',   -- UFs de atuação
  faixa_valor      text,                            -- faixa de valor de interesse
  onboarding_done  boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Vínculo User↔Organization (1:N) com papel
create table if not exists public.organization_members (
  org_id     uuid references public.organizations(id) on delete cascade,
  user_id    text references public.users(id) on delete cascade,
  role       text not null default 'owner',          -- owner | member
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

-- Cadastro completo da empresa (objeto 'empresa' do app) — 1:1 com a org
create table if not exists public.company_profile (
  org_id     uuid primary key references public.organizations(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,      -- empresa inteira (certidões meta, interesses, atestados...)
  updated_at timestamptz not null default now()
);

-- Pipeline de processos (Gestão de Processos) — 1:N com a org
create table if not exists public.processes (
  org_id     uuid references public.organizations(id) on delete cascade,
  id         text not null,                           -- edital.id (mesmo id do app)
  data       jsonb not null,                          -- card inteiro do pipeline
  updated_at timestamptz not null default now(),
  primary key (org_id, id)
);

-- Cache de IA por organização (FASE 6b) — economiza tokens:
--  kind='analise' → relatório executivo já gerado (key = editalId|hashCadastro)
--  kind='chat'    → histórico do "Pergunte ao Edital" (key = editalId)
-- Reaproveitado em qualquer dispositivo/navegador da mesma organização.
create table if not exists public.ia_cache (
  org_id     uuid references public.organizations(id) on delete cascade,
  kind       text not null,                            -- 'analise' | 'chat'
  key        text not null,                            -- editalId (+ variante)
  data       jsonb not null,                           -- relatório ou lista de mensagens
  updated_at timestamptz not null default now(),
  primary key (org_id, kind, key)
);

-- Registro de órgãos do Sistema S no PNCP (colheita profunda por CNPJ).
-- Semeado por lib/orgaosPNCP.js; o cron /api/cron/coleta completa UFs e
-- acrescenta órgãos descobertos.
create table if not exists public.orgaos_pncp (
  cnpj       text primary key,
  nome       text,
  entidade   text not null,
  uf         text,
  updated_at timestamptz not null default now()
);

-- Editais colhidos do PNCP (gravados pelo cron; lidos pelo /api/editais).
create table if not exists public.editais_pncp (
  id         text primary key,                      -- pncp-<numero_controle>
  uf         text,
  entidade   text,
  status     text,
  data       jsonb not null,                        -- edital normalizado completo
  updated_at timestamptz not null default now()
);
create index if not exists editais_pncp_uf_ent on public.editais_pncp (uf, entidade);

-- Notificações diárias (módulo de alertas): contato e canais por organização.
-- O QUE é enviado vem dos interesses já declarados em company_profile.data.interesses.
create table if not exists public.notificacao_prefs (
  org_id     uuid primary key references public.organizations(id) on delete cascade,
  email      text,
  telefone   text,                                   -- E.164 (ex.: 5581999998888) p/ WhatsApp
  canal_email    boolean not null default true,
  canal_whatsapp boolean not null default false,
  ativo      boolean not null default true,
  updated_at timestamptz not null default now()
);

-- Log de envios — garante 1 disparo por org/canal/dia (idempotência do cron)
create table if not exists public.notificacao_log (
  id         bigint generated always as identity primary key,
  org_id     uuid references public.organizations(id) on delete cascade,
  dia        date not null,
  canal      text not null,                          -- email | whatsapp
  status     text not null,                          -- enviado | erro | sem_credencial
  qtd        int,                                    -- processos no digest
  detalhe    text,
  created_at timestamptz not null default now()
);
create unique index if not exists notificacao_log_unico on public.notificacao_log (org_id, dia, canal);

-- Saúde dos conectores (FASE 7) — histórico do health-check diário das fontes
-- (Django, STW, PNCP, Correios). Escrito só pelo cron /api/cron/saude.
create table if not exists public.api_health (
  id          bigint generated always as identity primary key,
  fonte       text not null,                         -- id da fonte (ex.: django-pe)
  nome        text,                                  -- nome de exibição
  status      text not null,                         -- ok | degradado | bloqueado | falha
  http_status int,
  latencia_ms int,
  detalhe     text,
  checked_at  timestamptz not null default now()
);
create index if not exists api_health_fonte_data on public.api_health (fonte, checked_at desc);

-- ---- RLS: liga em tudo; sem policies = deny-all p/ anon/authenticated ----
alter table public.users                enable row level security;
alter table public.organizations        enable row level security;
alter table public.organization_members enable row level security;
alter table public.company_profile      enable row level security;
alter table public.processes            enable row level security;
alter table public.ia_cache             enable row level security;
alter table public.api_health           enable row level security;
alter table public.orgaos_pncp          enable row level security;
alter table public.editais_pncp         enable row level security;
alter table public.notificacao_prefs    enable row level security;
alter table public.notificacao_log      enable row level security;

-- (A service key usada pelo servidor ignora RLS por definição; o navegador
--  com a chave publishable fica bloqueado de ler/escrever qualquer linha.)
