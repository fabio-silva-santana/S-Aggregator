# AUDITORIA TÉCNICA — S-Aggregator

Data: 07/07/2026 · Escopo: `s-aggregator-app/` · Deploy: https://s-aggregator-lemon.vercel.app

---

## 1. Stack

| Item | Valor |
|---|---|
| Framework | **Next.js ^14.2.15 — App Router** |
| Linguagem | **JavaScript** (sem TypeScript; `jsconfig.json` só define alias `@/*`) |
| React | 18.3.1 |
| Gerenciador | **npm** (package-lock.json) |
| UI | **Nenhuma biblioteca** — CSS artesanal em `app/globals.css` (959 linhas), tokens via CSS custom properties, tema claro/escuro por atributo `data-tema` no `<html>` |
| Fonte/identidade | **Inter** + verde `#1b9e4b` (claro) / `#35c66a` (escuro). ⚠️ Diverge do brief (Space Grotesk + neon #C8FF00) — decidir qual identidade vale |
| Única dependência extra | `@anthropic-ai/sdk ^0.90.0` |
| Dev server | porta 3040 |
| Deploy | Vercel CLI direto (`vercel deploy --prod`), projeto `s-aggregator`, `vercel.json` = `{"framework":"nextjs"}` |

## 2. Estrutura

```
s-aggregator-app/
├── app/
│   ├── page.jsx          ← 2.670 linhas — TODO o frontend (SPA client-side, "use client")
│   ├── layout.jsx        ← html shell + script anti-flash de tema
│   ├── globals.css       ← todo o CSS
│   └── api/              ← 5 rotas (abaixo)
├── components/           ← ⚠️ VAZIA (todo componente vive em page.jsx)
├── lib/
│   ├── coletores.js      ← 749 l — coleta de editais das fontes externas + cache
│   ├── empresa.js        ← CNPJ (BrasilAPI), certidões, dossiê p/ IA
│   ├── regulamentos.js   ← mapeia entidade → PDF/txt do regulamento (document block p/ Claude)
│   ├── docStore.js       ← IndexedDB p/ blobs de documentos anexados
│   └── mapaBrasil.js     ← contornos SVG reais dos 27 estados (gerado de GeoJSON)
└── public/
    ├── logos/            ← 8 logos oficiais das entidades
    └── regulamentos/     ← 9 regulamentos oficiais (PDF + txt extraído)
```

## 3. Rotas de API

| Rota | Método | O que faz | Chama por fora |
|---|---|---|---|
| `/api/editais` | GET | Agrega editais de todas as fontes (filtros via query). Cache 30 min por fonte. `maxDuration=120`, região `gru1` | APIs Django, STW, PNCP, Correios |
| `/api/analisar` | POST | **Gerador do Relatório Executivo** (detalhe na seção 7). `maxDuration=300` | Anthropic + PDFs dos portais |
| `/api/perguntar` | POST | Chat "Pergunte ao Edital" — `claude-haiku-4-5`, `max_tokens=2000`, anexa regulamento + até 2 PDFs | Anthropic + PDFs dos portais |
| `/api/documentos` | GET | Resolve lista de anexos de um edital (API de arquivos do PNCP); `?diag=correios` = diagnóstico do scraper | PNCP |
| `/api/cnpj` | GET | Proxy da BrasilAPI (dados da Receita por CNPJ) | BrasilAPI |

## 4. Integrações externas

| Integração | Uso | Env documentada? |
|---|---|---|
| **Anthropic API** (`claude-haiku-4-5`) | Relatório + chat | `ANTHROPIC_API_KEY` em `.env.local` e na Vercel. **Não há `.env.example`**. ⚠️ Chave foi exposta em texto plano em conversa — **rotacionar**. ⚠️ Conta **sem créditos** hoje (HTTP 400 "credit balance too low") |
| APIs Django "Transparência" | SESI/SENAI DF, PE, RO, AL | — (URLs hardcoded em `coletores.js`) |
| API Sistema Transparência Web | SESI/SENAI SP, RN, RS, BA | — |
| PNCP (search + arquivos) | Catch-all nacional + SESC/SENAC/SENAR/SEBRAE/SEST-SENAT/SESCOOP | — |
| Correios (scraping HTML) | Portal do Fornecedor | ⚠️ **Bloqueado por WAF F5 em qualquer IP de nuvem** — degradação graciosa implementada (funciona só de IP residencial) |
| BrasilAPI | CNPJ → Receita | — |
| ~40 URLs de SEFAZs estaduais | Apenas links de emissão de certidão (não são chamadas) | — |

Única variável de ambiente usada no código: `process.env.ANTHROPIC_API_KEY` (2 ocorrências).

## 5. Persistência

**Não existe banco de dados.** Estado 100% no navegador do usuário:

- `localStorage`: `saggregator_empresa`, `saggregator_pipeline` (gestão de processos), `saggregator_favoritos`, `saggregator_filtros`, `saggregator_tema`, `saggregator_perfil` (legado)
- `IndexedDB` (`lib/docStore.js`): blobs de documentos anexados (certidões, contrato social)
- Servidor: apenas cache do `fetch` do Next (revalidate 1800s) + `unstable_cache` p/ Correios

Consequências: dado preso a 1 navegador/dispositivo, sem backup, sem multiusuário, limpar o navegador = perder tudo.

## 6. Autenticação

**Nenhuma.** App é público; qualquer visitante vê tudo e cria seus próprios dados locais.

## 7. Gerador de relatórios (o alvo da FASE 2)

Arquivo: `app/api/analisar/route.js` (213 linhas).

- **1 chamada única** a `claude-haiku-4-5` com `max_tokens: 16000` e **structured output** (`output_config.format json_schema`) — schema achatado com 32 campos obrigatórios (schemas aninhados foram rejeitados pela API: "compiled grammar too large").
- Anexos na mensagem: regulamento oficial da entidade (document block, **já com `cache_control: ephemeral`** em `lib/regulamentos.js`) + até 2 PDFs do edital via `source: {type:"url"}` (a API da Anthropic baixa os PDFs dos portais — fonte de latência imprevisível).
- Fallback: se a chamada com PDFs der 400, refaz sem os PDFs.
- **Sem streaming, sem job assíncrono, sem cache de resultado** — o usuário espera a resposta inteira (~60–90 s observados) numa única requisição HTTP.
- Sanitizador determinístico (`sanearTexto`) remove qualquer "consulte o edital".
- Modo demo quando falta a API key.
- System prompt: ~700 palavras, estático (cacheável, hoje **não** marcado com cache_control).

Latência decomposta (estimativa a confirmar com instrumentação na FASE 2): coleta+match do edital (cache quente ≈ 0s; frio 10–30s) → download dos PDFs pela API Anthropic (5–20s) → geração de ~6–10k tokens de saída com gramática JSON (~40–70s). **A saída longa é o fator dominante.**

## 8. Git

**A pasta NÃO é um repositório git.** `git remote -v` e `git log` falham ("not a git repository"). Não há histórico, branch, remote nem rollback. O código vive numa pasta sincronizada pelo **OneDrive** (caminho com espaços/acentos e `node_modules` sincronizando — risco de corrupção e lentidão). Deploys são snapshots diretos via CLI.

## 9. Dívidas e riscos

| # | Risco | Gravidade |
|---|---|---|
| 1 | **Sem git/versionamento** — sem rollback, sem diff, sem CI | Alta |
| 2 | **ANTHROPIC_API_KEY exposta em texto plano** em conversa anterior — rotacionar em console.anthropic.com | Alta |
| 3 | **Conta Anthropic sem créditos** — relatório/chat quebrados em produção agora | Alta |
| 4 | Sem banco/auth — dados do usuário presos ao navegador | Alta (é o objeto das FASES 4–6) |
| 5 | `page.jsx` monolítico (2.670 l) + `components/` vazia — custo de manutenção crescente | Média |
| 6 | Sem TypeScript, sem ESLint, sem testes | Média |
| 7 | Sem `.env.example` | Baixa |
| 8 | Correios inacessível de IP de nuvem (WAF) — exigiria proxy residencial pago | Conhecido/aceito |
| 9 | Coleta fria pode levar 10–30 s (PNCP lento) — usuário novo pode ver tela vazia demorada | Média (FASE 5 ataca) |
| 10 | Identidade visual do brief (Space Grotesk/#C8FF00) ≠ implementada (Inter/#1b9e4b) | Decisão pendente |
