# S-Aggregator — MVP

Radar de licitações do Sistema S com análise de edital por IA (Claude).

## Escopo desta fase

- **Entidades**: SESI e SENAI
- **Estados**: DF, PE, RO, RN, RJ, SP, RS, AL, BA
  - *Obs.: o escopo original citava "RD", que não é uma UF — assumido RN. Ajuste em `lib/editais.js` (constante `UFS`).*
- **Funcionalidades**: filtro por entidade, estado, tipo (modalidade), segmento, status e busca livre; detalhe do edital; análise com IA (resumo executivo, exigências críticas, documentos, riscos, prazos, score de aderência ao perfil da empresa e recomendação).

## Dados

Nesta fase os editais são uma **base semente de demonstração** (`lib/editais.js`), realista e no schema definitivo. A próxima fase substitui `generateSeed()` por coletores dos portais de compras de cada regional SESI/SENAI, sem mudar o restante da aplicação.

## Como rodar

```bash
cd s-aggregator-app
npm install
cp .env.local.example .env.local   # e preencha a ANTHROPIC_API_KEY
npm run dev                         # http://localhost:3040
```

Sem a `ANTHROPIC_API_KEY`, a análise roda em **modo demonstração** (marcada como DEMO na tela) para validar o fluxo. Com a chave, a análise usa o modelo `claude-opus-4-8` com saída estruturada (JSON schema).

## Estrutura

```
app/page.jsx              Dashboard (radar, filtros, detalhe, análise IA, perfil)
app/api/editais/route.js  GET /api/editais — listagem com filtros
app/api/analisar/route.js POST /api/analisar — análise do edital com Claude
lib/editais.js            Base de editais + constantes de escopo (UFs, modalidades, segmentos)
```

## Próximas fases (conforme plano de negócio)

1. Coletores reais dos portais SESI/SENAI por regional (persistência em PostgreSQL/Supabase)
2. Alertas por e-mail e radar automático por segmento
3. Autenticação e planos pagos (Stripe/Pix)
4. Novas entidades (SESC, SENAC, SEBRAE...) e demais estados
5. Pipeline de gestão de processos e histórico de contratos (empenhos & atas)
