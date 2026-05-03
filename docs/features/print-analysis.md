# Feature: Análise de Prints

**Status:** implementada, aguardando validação  
**Branch:** `spike/print-analysis`  
**Tier:** Wingman Premium (R$29,90/mês, incluído) + Trial (1/dia)

---

## O que faz

Quando o usuário manda um print de conversa (WhatsApp, Tinder, Bumble, Instagram DM), o bot:

1. Detecta que é imagem de conversa (não perfil/stories — esses continuam no fluxo antigo)
2. Verifica acesso (premium ou trial) e limites
3. Chama Haiku 4.5 com vision via Anthropic SDK
4. Retorna 2-3 mensagens curtas no WhatsApp com:
   - Leitura da situação (temperatura + diagnóstico)
   - A próxima mensagem sugerida (só 1, equilibrada)
   - Pergunta se quer alternativa mais ousada/segura (quando aplicável)
5. Salva resultado na tabela `print_analyses` (sem a imagem)
6. Loga em `api_requests` para tracking de custo

---

## Arquitetura

```
index.js (handler de imagem)
  └── isPrintAnalysisEnabled(phone) — feature flag
      └── checkPrintLimit(phone, isPremium, inTrial) — limites diários + cooldown
          └── analisarPrintConversaComHaiku(base64, mimeType, phone)
              ├── Haiku 4.5 vision (Anthropic SDK direto, com prompt caching)
              ├── Parse JSON estruturado
              ├── formatarRespostaPrint(result) → string[]
              ├── logApiRequest (fire-and-forget)
              └── salvarPrintAnalysis (fire-and-forget, sem imagem)
```

### Arquivos

| Arquivo | Função |
|---------|--------|
| `src/lib/printAnalysis.js` | Sistema de análise (Haiku 4.5, prompt, formatação, save) |
| `src/lib/printLimits.js` | Controle de limites diários e cooldown (in-memory) |
| `migrations/003_print_analyses.sql` | Tabela `print_analyses` + view de resumo |
| `index.js` | Feature flag, gate de acesso, handler de imagem modificado |

---

## Feature Flag

Variável de ambiente: `ENABLE_PRINT_ANALYSIS`  
Variável de teste: `PRINT_ANALYSIS_TEST_PHONE` (só necessária no modo `test`)

| Valor | Comportamento |
|-------|---------------|
| `false` (padrão) | Desativado para todos — fluxo antigo (Gemini Flash) |
| `test` | Só para o phone em `PRINT_ANALYSIS_TEST_PHONE` |
| `beta` | 10% da base premium (hash determinístico do phone) |
| `all` | Habilitado para todos |

### .env
```
ENABLE_PRINT_ANALYSIS=test
PRINT_ANALYSIS_TEST_PHONE=5511912345678
```

---

## Limites

| Plano | Print analyses/dia | Cooldown entre análises |
|-------|--------------------|------------------------|
| Premium ativo | 5 | 30 segundos |
| Trial (3 dias) | 1 | 30 segundos |
| Free (pós-trial) | 0 → upsell | — |

Os limites de print são **independentes** do limite de mensagens de texto.  
Contador in-memory — reseta quando o processo reinicia (PM2 restart).

---

## Mensagens retornadas

### Fluxo normal (2-3 mensagens)

**Msg 1 — Leitura da situação:**
```
🌡️ _interesse médio — ela tá testando, não descartou_

⚠️ Você mandou 3 mensagens sem resposta — isso pesou.

Ela pausou, mas o histórico antes sugeria interesse real. O sumiço foi reação ao excesso, não ao cara em si.
```

**Msg 2 — Sugestão:**
```
Manda isso 👇

"e aí, sumiu geral ou só comigo kkk"
```

**Msg 3 — Alternativas (opcional):**
```
Quer uma _mais segura_ ou uma _mais ousada_? Só falar 😏
```

### Imagem ilegível
```
Hmm, não consegui ler bem essa imagem. Tenta um print mais nítido da conversa, mostrando as últimas 5-10 mensagens.

Pode ser do Tinder, WhatsApp, Bumble, Instagram — qualquer um.
```

### Limite atingido (premium)
```
Chegou no limite de 5 análises de print hoje.

Amanhã cedo tem mais 5. Usa texto enquanto isso — descreve o que ela mandou que eu analiso.
```

### Upsell (free)
```
Análise de print é uma feature do *Wingman Premium* 🔍

[...descrição + opções de plano]
```

---

## JSON estruturado (banco `print_analyses`)

Campos salvos por análise (sem a imagem):

```json
{
  "phone": "5511...",
  "platform_detected": "whatsapp",
  "messages_count": 7,
  "match_interest_level": "medium",
  "conversation_temperature": "warm",
  "red_flags_count": 1,
  "green_flags_count": 2,
  "mistakes_count": 1,
  "has_suggested_messages": true,
  "raw_json": { ...análise completa do Haiku... },
  "created_at": "2026-05-03T..."
}
```

---

## Rollout

### Fase 1 — Testes internos
1. Coloca no `.env`:
   ```
   ENABLE_PRINT_ANALYSIS=test
   PRINT_ANALYSIS_TEST_PHONE=<seu número>
   ```
2. Roda `git pull && pm2 restart mandaassim-bot` no VPS
3. Roda SQL `migrations/003_print_analyses.sql` no Supabase
4. Manda 10 prints reais seus — valida qualidade + custo
5. Confirma linha em `api_requests` (intent: `print_analysis`) e `print_analyses`

### Fase 2 — Beta premium (10%)
1. Troca no `.env`:
   ```
   ENABLE_PRINT_ANALYSIS=beta
   ```
2. Restart. Sem redeployar código.
3. Monitora por 1 semana:
   - Taxa de erro em `api_requests` (error != null)
   - Latência média (target < 8s)
   - Custo médio (target < R$0,15)

### Fase 3 — Full release
1. Troca para `ENABLE_PRINT_ANALYSIS=all`
2. Restart.
3. Envia broadcast para usuários ativos (texto abaixo).

---

## Broadcast de lançamento

> Novidade: agora você pode mandar print da conversa que eu analiso e te falo o que tá rolando.
>
> Temperatura da conversa, interesse dela, próxima mensagem certa — tudo em segundos.
>
> Testa aí 👇

---

## Métricas de sucesso

| Métrica | Target | Onde medir |
|---------|--------|------------|
| Parse rate | ≥ 90% | `print_analyses.has_suggested_messages` |
| Latência P95 | < 8s | `api_requests.latency_ms` WHERE intent = `print_analysis` |
| Custo médio | < R$0,15 | `api_requests` calculado |
| Retenção premium | +5% W4 | `audit.js` |

---

## Decisões técnicas

**Por que Haiku 4.5 direto (não via OpenRouter)?**  
Menor latência (sem overhead do proxy), custo ligeiramente menor, prompt caching nativo.

**Por que limites separados do limite de texto?**  
Premium tem mensagens ilimitadas de texto. O limite de print (5/dia) é específico para controlar custo do vision model, que é ~3× mais caro que o Gemini Flash.

**Por que não armazenar a imagem?**  
Privacidade. O JSON estruturado tem todo o valor analítico sem os riscos de guardar screenshots de conversas pessoais.

**Por que 30s de cooldown?**  
Evita duplo envio acidental (usuário manda 2× por engano) e limita abuse de rate.
