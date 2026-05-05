# Feature Pro: Debrief Pós-Date

Análise honesta do encontro. Usuário conta como foi — bot lê sinais de interesse/desinteresse, avalia performance, dá próximo passo concreto e mensagens de seguimento.

## Plano

**Wingman Pro only** — sem teaser para Wingman básico.

## Trigger

**Trigger B/C — Explícito:**
- Keywords: "como foi o encontro", "voltei do encontro", "tive o encontro", "o encontro foi bem/mal/ok"
- Padrões de relato: "ela pareceu animada/fria/distante", "saímos ontem/hoje"
- Comando direto: "debrief" ou "debrief encontro"

**Trigger A — Proativo:**
- Worker envia "Como foi?" 10h após o encontro agendado
- Quando usuário responde qualquer coisa, `temDebriefPendente()` detecta e inicia automaticamente
- Só funciona se houve sessão de Pré-Date com data parseada

## Mini-entrevista (7 perguntas)

Perguntas em sequência, uma por vez:

1. Como você se sentiu durante o encontro? De 0 a 10 — e me conta brevemente por quê.
2. Ela pareceu engajada? O que você notou — expressões, perguntas que ela fez, ou ausência delas?
3. Falaram de quê? Teve algum tema que esquentou o papo, ou algo que esfriou?
4. Aconteceu algum momento estranho — silêncio pesado, uma coisa que você disse, uma reação inesperada dela?
5. Como foi a despedida? Quem propôs o encerramento? Teve abraço, beijo, ou foi seco?
6. Ela falou em se ver de novo? Espontaneamente ou você quem perguntou?
7. Você mandou mensagem depois? Se sim, o que ela respondeu — e quando?

Estado guardado em `userContext.postdateDebriefState` (in-memory).

## Output — 4 mensagens WhatsApp

**Msg 1 — Leitura honesta:**
- Avaliação: great/good/neutral/poor/unclear + label visual
- Rationale direto (2-3 frases)
- `honest_truth_if_needed` se houver algo importante a dizer

**Msg 2 — Sinais + Performance:**
- ✅ Sinais de interesse dela
- ⚠️ Sinais de desinteresse/distância
- O que ele fez bem (concreto)
- O que ajustar (concreto)
- Principal erro, se houver

**Msg 3 — Próximo passo + sugestões:**
- 1 ação específica com timing (agora / 24h / 48-72h / espera)
- Sugestões de mensagem adaptadas ao outcome:
  - `warm_followup` (para great/good)
  - `playful_callback` (referencia algo do encontro)
  - `next_invite` (para marcar de novo)

**Msg 4 — Lições:**
- 1-2 coisas específicas pro próximo encontro
- Nunca genérico ("cada experiência é aprendizado")

## Anti-padrões PROIBIDOS (enforcement no system prompt)

```
"Você merece alguém melhor"
"Foque em você primeiro"
"Talvez não fosse a pessoa certa"
"Mulher é complicada mesmo"
"O importante é que você tentou"
"Cada experiência é um aprendizado"
```

Em vez disso: nomear o erro específico, dar próximo passo concreto.

## Tom — regras absolutas

- Honestidade brutal > bajulação
- Se foi mal, fala que foi mal. Se ele errou, aponta.
- Elogiar sem fundamento paralisa o crescimento
- Com respeito — sem crueldade

## Loop de aprendizado

Outcome do debrief alimenta o próximo pré-date via `getLastDebriefInsight()`:
```js
// Retorna string como:
// "Último encontro (04/05/2026): avaliação 'good'.
//  Lições: criou tensão tarde demais; não propôs próximo encontro.
//  Melhorar: segurança na despedida."
```

## Persistência

Tabela: `postdate_sessions`
- `predate_session_id` — link com sessão pré-date (se vier de trigger proativo)
- `interview_answers` (JSONB)
- `assessment_result` (JSONB completo)
- `encounter_quality` — great/good/neutral/poor/unclear
- `next_step` — próximo passo recomendado
- `outcome_summary` — resumo legível para loop

## Feature flags

```env
ENABLE_POSTDATE_DEBRIEF=false   # false | test | all
POSTDATE_DEBRIEF_TEST_PHONE=    # número de teste quando ENABLE_POSTDATE_DEBRIEF=test
```

## Custo estimado

- Haiku 4.5: ~700 tokens input (7 respostas) + ~700 output = ~$0.005 USD ≈ R$0,03
- Total por sessão: < R$0,05 (target: < R$0,60)

## Critérios de aceitação

- [ ] 5 sessões com outcomes variados (great / good / poor / unclear)
- [ ] Debrief proativo dispara 10h após o encontro agendado
- [ ] Tom honesto sem cruel — validado por Rafa em 10 testes reais
- [ ] Sugestões de mensagem corretas por outcome (não sugere nada se foi poor)
- [ ] Loop de aprendizado retornando insight correto no próximo pré-date
- [ ] Custo médio < R$0,60/sessão

## Processo de revisão antes do go-live

**Atenção máxima ao tom.** Revisar as primeiras 20 sessões manualmente:

```sql
-- Supabase: últimas sessões
SELECT phone, encounter_quality, outcome_summary, assessment_result->>'honest_truth_if_needed' as honest_truth
FROM postdate_sessions
ORDER BY created_at DESC
LIMIT 20;
```

Validar:
1. Nenhum anti-padrão proibido no output
2. Sessões "poor" têm tom direto mas respeitoso
3. Sugestões de mensagem são naturais, não robóticas
4. `lessons_for_next_time` é específico, nunca genérico

## Arquivos relevantes

```
src/lib/postdateDebrief.js         — lógica Haiku, formatação, persistência
src/followup/followupWorker.js     — predate_debrief trigger, atualizarDebriefEnviado()
src/followup/followupMessages.js   — textos do follow-up "como foi?"
migrations/008_postdate_sessions.sql
```
