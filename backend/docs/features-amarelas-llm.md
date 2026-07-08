# Funcionalidades 🟡 — Possíveis, mas exigem novo processamento / LLM

> Itens do REF (`Alterações na plataforma`) que **dão pra fazer**, mas dependem
> de **novo processamento no pipeline e/ou LLM** (custo + `LLM_DRIVER=real`) —
> diferente das que só agregam dados já existentes (essas já foram feitas).
> Documento de planejamento; nada aqui está implementado ainda.

Data: 2026-06-23

## Contexto técnico que pesa em todas

- **`chat_messages` (ClickHouse) tem TTL de 30 dias**; `batch_analysis` 180 dias
  (só os insights agregados, não a msg crua). Análises retroativas além disso
  não têm dado de origem.
- **LLM hoje é `mock` por padrão.** Qualquer "a IA descreve / classifica" exige
  `LLM_DRIVER=real` + `ANTHROPIC_API_KEY` (Haiku 4.5) → **custo por token**.
- O pipeline atual classifica **por janela de 15s** (sentimento + pauta), não
  guarda sentimento por-marca nem rótulo orgânico/mod por menção.

---

## 1. Sentimento POR marca (neg/pos/neutro) — slide 6

- **Hoje:** `batch_analysis.mentioned_brands_json` tem só `{brand, count, sample}`.
  A página de marcas já mostra **contagem + timeline** (feito). Falta o sentimento.
- **Precisa:** ao detectar menção de marca na janela, classificar as msgs que
  citam a marca (heurístico de sentimento já existe por msg → dá pra atribuir
  barato; refino com LLM). Gravar `brand_sentiment` no `batch_analysis` (nova
  coluna) ou numa tabela `brand_mentions`.
- **Esforço:** médio. Muda o `orchestrator` (compor) + migração ClickHouse +
  reprocesso (histórico antigo não terá).

## 2. Orgânico vs moderador/bot POR marca — slide 6

- **Hoje:** `chat_messages.is_mod` existe; a busca de mensagens já separa
  orgânico/mod no total. Para **marca**, a detecção por janela não guarda o split.
- **Precisa:** rodar `detectBrands` separando por `is_mod` (e heurística de bot),
  gravando `count_organic` / `count_mod` por marca. Migração + orchestrator.
- **Esforço:** médio (reaproveita `is_mod`).

## 3. "Assuntos do chat": IA descreve as pautas do dia — slide 2

- **Hoje:** `batch_analysis.pautaMaisComentada` (categoria+count) por janela +
  `topTokens`. Dá pra agregar por dia (mecânico).
- **Precisa (a parte 🟡):** o **texto descritivo** ("os assuntos mais pautados
  foram…") = **LLM** sobre o agregado do dia. O `insights-report.service` já faz
  narrativa — dá pra reusar o prompt.
- **Esforço:** baixo-médio (novo endpoint de resumo diário via ReportLlmService).
  Custo de LLM por consulta (cachear por dia).

## 4. VOD: recortar hora X→Y e entender o assunto — slide 4

- **Hoje:** `chat_messages.received_at` permite recortar a janela (a busca já
  aceita from/to). 
- **Precisa (🟡):** o "entender o assunto daquele momento" = **LLM** sumarizando
  as msgs do recorte. Limitado pelo **TTL de 30d**.
- **Esforço:** baixo (reusa busca + resumo LLM sob demanda).

## 5. Sumário executivo: Pontos positivos / Reclamações / Oportunidades — slides 0, 4

- **Hoje:** `insights-report.service` já gera narrativa (resumo + seções +
  recomendações) e PDF. Bem perto.
- **Precisa (🟡):** ajustar o **prompt** para esses 3 buckets fixos + expor na UI
  (página de relatório/exec summary). `LLM_DRIVER=real`.
- **Esforço:** baixo (tweak de prompt + 1 view). Custo de LLM por relatório.

## 6. "Ativação por plataforma" com número por plataforma (Twitch/YouTube) — slide 6

- **Hoje:** dá por `chat_messages.platform` para **Twitch/Kick**.
- **🟡/❌:** **YouTube não tem ingestão** (roadmap) → o "YouTube 777" do mock não
  é possível até existir coletor YT. Twitch/Kick: já dá (agregação simples).

---

## Pré-requisitos para destravar o bloco 🟡

1. `LLM_DRIVER=real` + `ANTHROPIC_API_KEY` (itens 3, 4, 5) — com orçamento/limite
   (`LLM_BUDGET_TOKENS_MONTHLY`) e cache por dia/relatório.
2. Migração ClickHouse para colunas novas (`brand_sentiment`, `count_organic`,
   `count_mod`) + ajuste do `orchestrator` (itens 1, 2) — e reprocessar (histórico
   antigo fica sem).
3. Validação contra **ClickHouse + LLM reais** (bloqueado localmente — docker/
   portas), junto da janela VAL-01/02 do M4.

## Ordem sugerida (custo/benefício)
1º **#5 sumário executivo** (já 90% pronto, só prompt+UI) → 2º **#3 assuntos do
dia** → 3º **#1/#2 sentimento e orgânico por marca** (mesma mexida no orchestrator)
→ 4º **#4 VOD recorte+resumo** → **#6 YouTube** só quando houver ingestão.
