# Feature: Coach de Transição (Camada 3)

**Status:** implementada, aguardando validação  
**Branch:** `spike/print-analysis`  
**Tier:** Wingman Premium (2/mês) + Wingman Pro (ilimitado)

---

## O problema que resolve

"Hinge penpal trap" — conversa flui por semanas mas nunca vira encontro.
É a maior frustração do usuário 30-45 que voltou pro mercado: consegue match, consegue conversa, trava na transição.

---

## Triggers

### Forma A — Comando explícito
Usuário escreve frases como:
- "como marco encontro com ela?"
- "quero chamar ela pra sair"
- "tá na hora de marcar?"
- "como chamar ela pra sair"

Regex: `TRANSITION_COACH_KEYWORDS` em `index.js`

### Forma B — Sugestão proativa
Após análise de print (Camada 1) com:
- `conversation_temperature: hot` AND `match_interest_level: high|very_high`

Bot adiciona ao final: _"Pela temperatura da conversa, tá maduro pra você chamar pra sair. Quer ajuda com isso? Digita *como marco encontro*."_

### Forma C — Menu
Mencionado no upsell como opção disponível.

---

## Fluxo

```
Trigger detectado
    ↓
Verificação de plano (free → upsell, premium → checa 2/mês, pro → ok)
    ↓
Mini-entrevista 5 perguntas (state machine em userContext.transitionCoachState)
  Q1: Primeira vez ou já tentou?
  Q2: Quantos dias conversando?
  Q3: Trocou número ou ainda no app?
  Q4: Tipo de encontro imaginado?
  Q5: Sabe algo específico que ela curte?
    ↓
Haiku 4.5 analisa respostas + contexto de print anterior (se houver)
    ↓
4 mensagens formatadas:
  Msg 1: Leitura de prontidão (ready/wait_a_bit/not_yet/red_flags)
  Msg 2: Estratégia (formato, local, timing)
  Msg 3: A mensagem pronta pra copiar (balanced)
  Msg 4: Contingência (se sim / se enrolar / se não)
    ↓
Salva em transition_coach_sessions
    ↓
Agenda follow-up em 7 dias (followup_queue: transition_coach_outcome)
    ↓
7 dias depois: "Como foi? Ela topou?"
    ↓
Usuário responde → outcome salvo na sessão
```

---

## Readiness assessment

| Valor | Significado | Condição típica |
|-------|-------------|-----------------|
| `ready` | Bora | 5+ dias, engajada, já no WhatsApp |
| `wait_a_bit` | Quase | < 5 dias ou ainda no app |
| `not_yet` | Ainda não | Conversa seca, respostas curtas |
| `red_flags` | Sinal de alerta | Desinteresse claro, ghosting recente |

---

## Exemplos de output

### Msg 1 — Leitura
> ✅ **Tá pronto pra chamar**
>
> Vocês conversam há 9 dias, ela responde rápido e faz perguntas — sinal claro de interesse. Já estão no WhatsApp, o que elimina o atrito do app. Timing bom.
>
> ⏰ Manda hoje à noite ou amanhã de manhã — não deixa passar o fim de semana.

### Msg 2 — Estratégia
> **Estratégia:**
>
> 📍 Café curto numa tarde de sábado, 1-1,5h
> 🏠 Local público e movimentado (tira pressão de encontro íntimo)

### Msg 3 — A mensagem
> Manda isso 👇
>
> "Ei, tô curtindo muito conversar contigo. Bora tomar um café esse sábado à tarde?"

### Msg 4 — Contingência
> **E se...**
>
> ✅ **Ela topar:** confirma o lugar e horário, não precisa de mais texto
> ⏳ **Ela enrolar:** "tranquilo, qual sábado fica bom pra você?" — empurra pra data, não para na desculpa
> ❌ **Ela negar:** se ela não der alternativa, é sinal real de desinteresse — segue a vida

---

## Limites

| Plano | Sessions/mês | Observação |
|-------|-------------|------------|
| Free | 0 → upsell | — |
| Premium (R$29,90) | 2 | Contagem no banco (persistente entre restarts) |
| Pro (R$79,90) | Ilimitado | — |

---

## Tracking de outcome (7 dias)

O followup worker envia automaticamente 7 dias após cada sessão:

> _Ei, lembra que te ajudei a chamar ela pra sair semana passada? Como foi? Ela topou?_

Usuário responde e o sistema classifica via Gemini Flash Lite:
- `accepted_and_happened` — ela topou e o encontro aconteceu
- `accepted_but_postponed` — ela topou mas adiou
- `accepted_but_canceled` — topou mas cancelou
- `rejected` — ela recusou
- `never_responded` — ele mandou mas ela nunca respondeu
- `user_didnt_send` — ele não chegou a mandar

---

## Métricas de sucesso

| Métrica | Target |
|---------|--------|
| Latência total sessão (5 perguntas + análise) | < 30s (sem contar tempo do usuário responder) |
| Custo médio Haiku (só a análise) | < R$0,40 |
| Taxa de outcome coletado | > 40% dos que responderam ao follow-up |
| Taxa `accepted_and_happened` | Baseline a definir nas primeiras semanas |

---

## Feature flag

```
ENABLE_TRANSITION_COACH=false   # padrão
ENABLE_TRANSITION_COACH=test    # só TRANSITION_COACH_TEST_PHONE
ENABLE_TRANSITION_COACH=beta    # 10% dos premium/pro
ENABLE_TRANSITION_COACH=all     # todos
```

---

## Arquivos

| Arquivo | Função |
|---------|--------|
| `src/lib/transitionCoach.js` | Haiku 4.5, JSON, formatação, save, outcome tracking |
| `migrations/006_transition_coach.sql` | Tabela sessions + view de métricas |
| `index.js` | Feature flag, triggers A/B/C, state machine 5 perguntas, outcome detection |
| `src/followup/followupScheduler.js` | scheduleTransitionCoachOutcome (7 dias) |
| `src/followup/followupMessages.js` | Mensagem do follow-up de outcome |
| `src/lib/printAnalysis.js` | Forma B: sugere transition coach quando conversa está hot |
