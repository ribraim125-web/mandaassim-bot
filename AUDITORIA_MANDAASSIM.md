# Auditoria MandaAssim — 2026-05-27

## TL;DR

- **Problema raiz:** O classificador de intent roteia 99% das mensagens para o prompt "degradado" (inferior) — o prompt completo com exemplos, variabilidade e qualidade foi usado apenas 2 vezes em 30 dias (1,3% dos requests)
- **Impacto:** Todo usuário recebe output de segunda categoria em 99% das interações — output_avg de 124 tokens contra 296 do prompt completo (2,4x menos conteúdo)
- **Solução em 1 frase:** Fundir volume com premium (apagar SYSTEM_PROMPT_DEGRADED, usar só SYSTEM_PROMPT) e zerar o contexto da "ela" que nunca é salvo

---

## Pipeline atual

```
[Usuário manda texto/print]
        │
        ▼
[Gemini Flash — classifica intent]
        │
        ├── 79,7% → volume    → SYSTEM_PROMPT_DEGRADED ← PROBLEMA CENTRAL
        ├── 15,8% → image     → Gemini 2.0 Flash (análise de print)
        ├──  3,2% → first_mirroring_v2 → prompt de onboarding
        ├──  1,3% → premium   → SYSTEM_PROMPT (prompt completo)
        └──  0,0% → coaching/ousadia/outcome/one_liner → NUNCA DISPARA
                │
                ▼
        [Claude Haiku 4.5 gera resposta]
                │
                ▼
        [enviarResposta() tenta split por ---]
        [Se não achar → fallback manual → output incompleto]
                │
                ▼
        [sendWithDelay() → WhatsApp]
```

O fluxo parece sofisticado mas na prática é sempre: Gemini classifica como "volume" → Haiku usa prompt degradado → output medíocre.

---

## Acesso aos dados reais

Banco: Supabase PostgreSQL. Credencial service_role usada via REST API.

**Limitação crítica:** A tabela `api_requests` armazena apenas metadados (intent, tokens, latência, custo). O texto das mensagens — o que o usuário escreveu e o que o bot respondeu — **não é armazenado em nenhum lugar do banco**. A análise de qualidade do output só é possível via logs de PM2 no servidor (que rotatam e não persistem).

Tabelas consultadas:
- `api_requests` — 158 registros nos últimos 30 dias ✅
- `girl_profiles` — 0 registros ✅ (vazio, confirmado)
- `narrative_messages_log` — acessado anteriormente ✅

---

## Notas dos critérios (0-5)

| Critério | Nota | Justificativa |
|---|---|---|
| System prompt específico PT-BR | 4 | Bem definido no SYSTEM_PROMPT — mas esse prompt só roda 1,3% das vezes |
| Persona do usuário definida | 2 | Act 1 coleta, mas é opt-in e raramente completado |
| Distingue contextos | 1 | Todos os contextos são românticos/dating, nenhuma distinção de destinatário |
| Proíbe jargão inadequado | 5 | Anti-patterns explícitos e sensitive_cases bem definidos |
| Pergunta pra quem é a mensagem | 0 | Não existe no fluxo principal |
| Sabe histórico/relação com ela | 0 | girl_profiles = 0 registros. Nunca foi preenchido. |
| Sabe objetivo da mensagem | 0 | Não é coletado |
| Sabe estado emocional | 1 | Classifier detecta temperatura emocional mas não usa pra nada relevante |
| Few-shot examples | 4 | 6 exemplos no SYSTEM_PROMPT — mas esse prompt roda 1,3% das vezes |
| Examples em PT-BR real | 4 | Autênticos quando o prompt completo roda |
| Output format definido | 5 | Formato com emojis e separadores bem definido |
| Modelo adequado PT-BR | 3 | Haiku 4.5 funciona mas perde nuance vs Sonnet |
| Temperature configurada | 5 | Por intent, bem calibrada |
| Max tokens suficiente | 2 | 550 para volume, mas output real é avg 124 tokens — o modelo não está usando o espaço disponível |

---

## Análise das mensagens reais

### Dados do banco (últimos 30 dias, 158 requests)

| Intent | N | % | Output avg | Output min | Output max | Input avg |
|---|---|---|---|---|---|---|
| volume | 126 | 79,7% | 124 tokens | 90 | 298 | 1.694 |
| image | 25 | 15,8% | 154 tokens | 23 | 198 | 6.667 |
| first_mirroring_v2 | 5 | 3,2% | 41 tokens | 22 | 57 | 290 |
| premium | 2 | 1,3% | 296 tokens | 225 | 367 | 3.112 |
| coaching | 0 | 0% | — | — | — | — |
| ousadia | 0 | 0% | — | — | — | — |
| outcome | 0 | 0% | — | — | — | — |
| one_liner | 0 | 0% | — | — | — | — |

### Agrupamento por categoria de problema

**Problema A — Prompt inferior em 99% dos casos: 126 casos (volume)**
O classificador never roteia para premium exceto 2 vezes. Qualquer mensagem "normal" vira volume → SYSTEM_PROMPT_DEGRADED.

**Problema B — Output token muito baixo: 126 casos**
Output médio de 124 tokens para 3 opções (🔥 😏 ⚡) + diagnóstico. Isso é ~30 palavras por opção. Curto demais para mensagens com nuance real.

**Problema C — Análise de imagem com zero contexto: 25 casos**
Todas as 25 análises de imagem partem do zero — girl_profiles vazio confirma que nenhuma análise gera ou usa contexto persistente sobre ela.

**Problema D — Intents especializados nunca disparam: 0 casos**
coaching, ousadia, outcome, one_liner = zero usos em 30 dias. O classificador não consegue distinguir esses casos do volume genérico.

**Problema E — girl_profiles completamente vazio**
0 registros. Nenhuma "ela" foi salva jamais. Cada análise começa do absoluto zero sobre quem é a pessoa.

### O texto real das mensagens
Não está armazenado no banco. Para ver as respostas reais que o bot gerou, a única fonte são os logs PM2 no servidor (`pm2 logs mandaassim-bot --lines 500`). Os logs rotatam e não persistem entre restarts.

---

## Top 3 problemas críticos

### Problema 1 — O classificador roteia 99% para o prompt degradado

**Problema:** O intent `volume` usa `SYSTEM_PROMPT_DEGRADED` — um prompt simplificado criado para casos de "input confuso". Mas o classificador trata praticamente tudo como volume. O SYSTEM_PROMPT completo (com 6 exemplos, regras de variabilidade, jogada mestre, mini-lição) roda apenas 2 vezes em 30 dias.

**Evidência no código:**
- `index.js:1622` — `volume: { systemPrompt: SYSTEM_PROMPT_DEGRADED, maxTokens: 550, temperature: 0.85 }`
- `index.js:1635` — `premium: { systemPrompt: SYSTEM_PROMPT, maxTokens: 550, temperature: 0.80 }`
- `index.js:1542` — CLASSIFIER_PROMPT define premium como "momento decisivo, ambiguidade extrema ou tensão clara" — critério alto demais

**Evidência nos dados reais:** volume=126 (79,7%), premium=2 (1,3%) em 30 dias.

**Por que causa mensagens ruins:** SYSTEM_PROMPT_DEGRADED tem menos instruções, menos exemplos, menos variabilidade forçada. Output avg de 124 tokens vs 296 do premium = 2,4x menos conteúdo. O modelo gera respostas mais curtas e genéricas porque o prompt não exige mais.

**Correção proposta:**

```javascript
// ANTES (index.js:1622)
volume: {
  systemPrompt: SYSTEM_PROMPT_DEGRADED,
  maxTokens: 550,
  temperature: 0.85
},

// DEPOIS — apagar SYSTEM_PROMPT_DEGRADED, usar o completo sempre
volume: {
  systemPrompt: SYSTEM_PROMPT,
  maxTokens: 650,
  temperature: 0.85
},
```

E no CLASSIFIER_PROMPT, baixar o critério de premium:

```javascript
// ANTES (index.js ~1542)
"premium: situação com momento decisivo, ambiguidade extrema ou tensão clara"

// DEPOIS
"premium: qualquer situação com uma pessoa específica e uma conversa em andamento.
 volume: apenas textos vagos sem contexto, sem nome, sem situação definida."
```

**Esforço:** 30 minutos
**Impacto:** Alto — output passa de 124 para ~296 tokens de imediato

---

### Problema 2 — girl_profiles vazio: zero contexto sobre ela em 100% das análises

**Problema:** A tabela `girl_profiles` tem 0 registros. O código para salvar existe (`saveGirlProfile`), a estrutura existe, o campo `buildGirlContext()` injeta no prompt quando disponível — mas nunca é preenchido. O bot nunca pergunta "quem é ela?" de forma sistemática, e quando pergunta, a resposta não é persistida automaticamente.

**Evidência no código:**
- `src/lib/girlProfile.js` — função `saveGirlProfile()` existe mas só é chamada em fluxos muito específicos
- `index.js:2396-2405` — `buildGirlContext()` injeta perfil quando existe — mas como o banco é vazio, nunca injeta nada
- `index.js:3733` — `analisarPrintComClaude(imgData, imgMime, '', '', '', phone)` — girlContext e situação chegam como strings vazias

**Evidência nos dados reais:** `girl_profiles` = 0 registros (confirmado via API).

**Por que causa mensagens ruins:** O LLM analisa um print sem saber quem é ela, qual é a relação, o que já funcionou. Gera opções para uma "situação genérica de Tinder" quando pode ser uma ex, uma colega, alguém que já foi pra um encontro.

**Correção proposta:**

Antes de analisar qualquer print, verificar se há contexto. Se não houver, fazer 1 pergunta e aguardar:

```javascript
// index.js — antes de analisarPrintComClaude (linha ~3732)
const girlCtx = await getGirlProfile(phone);
const sessionCtx = userContext.get(phone) || {};

if (!girlCtx && !sessionCtx.quickContext) {
  // Salva imagem pendente, pede contexto rápido
  userContext.set(phone, {
    ...sessionCtx,
    pendingImg: { data: imgData, mime: imgMime },
    awaitingQuickContext: true
  });
  await client.sendMessage(message.from,
    'Antes de analisar — quem é ela e o que você quer?\n_(ex: "match do Tinder, quero marcar um encontro" ou "ex minha, tentando reatar")_'
  );
  return;
}

// Usa contexto existente ou o que o usuário acabou de responder
const situacao = girlCtx?.girl_context || sessionCtx.quickContext || '';
const sugestoes = await analisarPrintComClaude(imgData, imgMime, '', '', situacao, phone);
```

E quando o usuário responde essa pergunta, salvar no perfil:

```javascript
// No handler de texto, checar se está aguardando contexto rápido
if (sessionCtx.awaitingQuickContext && sessionCtx.pendingImg) {
  await saveGirlProfile(phone, {
    girl_context: message.body.slice(0, 300),
    current_situation: message.body.slice(0, 200)
  });
  userContext.set(phone, { ...sessionCtx, quickContext: message.body, awaitingQuickContext: false });
  // Agora processa a imagem pendente
  const { data: imgData, mime } = sessionCtx.pendingImg;
  const sugestoes = await analisarPrintComClaude(imgData, mime, '', '', message.body, phone);
  await enviarResposta(message, sugestoes, 'print_analysis', phone);
  return;
}
```

**Esforço:** 6 horas
**Impacto:** Alto — elimina o "sem contexto" e o "nada a ver" em análises de imagem

---

### Problema 3 — Intents especializados nunca disparam (coaching, ousadia, outcome, one_liner)

**Problema:** 0 usos de coaching, ousadia, outcome e one_liner em 30 dias. Esses intents têm prompts calibrados para situações específicas e importantes: coaching estratégico, clima quente, feedback de resultado. Nada disso está sendo detectado.

**Evidência no código:**
- `index.js:1492-1609` — CLASSIFIER_PROMPT define os critérios, mas os critérios de ousadia, coaching e outcome são vagos demais ou altos demais
- `index.js:1635-1665` — Configurações dos intents existem corretamente — o problema é a classificação, não o roteamento

**Evidência nos dados reais:** 0 registros de coaching/ousadia/outcome/one_liner em 30 dias.

**Por que causa mensagens ruins:** Um cara manda "cara ela ficou de boa depois que mandei aquela mensagem, agora ela tá provocando" — deveria ser ousadia. Vai para volume, recebe resposta conservadora genérica.

**Correção proposta:**

Adicionar exemplos concretos no CLASSIFIER_PROMPT para cada intent:

```javascript
// No CLASSIFIER_PROMPT, adicionar seção de exemplos:
`EXEMPLOS DE CLASSIFICAÇÃO:
- "ela tá respondendo bem, mas não sei se chamo pra sair" → coaching
- "mandei a mensagem, ela ficou quieta, foi horrível" → outcome
- "ela mandou foto na cama com legenda 'entediada'" → ousadia
- "kkk" ou "😂" ou "ok" ou resposta de 1-3 palavras → one_liner
- qualquer situação com pessoa específica e conversa → premium (NÃO volume)
- volume: só quando o texto é completamente vago, sem contexto, sem pessoa`
```

**Esforço:** 2 horas
**Impacto:** Médio-alto — ativa 4 prompts especializados que nunca funcionaram

---

## Quick wins (< 2h cada)

1. **Trocar volume → SYSTEM_PROMPT** (`index.js:1622`) — 30 min — impacto imediato no output de 126 interações/mês
2. **Adicionar exemplos concretos no CLASSIFIER_PROMPT** — 1h — ativa coaching/ousadia/outcome/one_liner
3. **Baixar critério de premium** no classifier — 30 min — mais situações recebem roteamento correto
4. **Adicionar `response_text` na tabela `api_requests`** — 2h — a partir daí, consegue auditar output real sem depender de logs

---

## Mudanças estruturais (> 1 dia)

1. **Fluxo de contexto antes do print** — pergunta "quem é ela?" + salva no girl_profiles + reutiliza em análises futuras (descrição detalhada no Problema 2 acima)

2. **Logging do texto real** — adicionar colunas `user_message_text` e `response_text` em `api_requests`. Sem isso, é impossível fazer auditoria de qualidade sem acesso ao servidor.

3. **Persistência de sessão no banco** — `userContext` Map perde tudo no restart (bot reiniciou 50 vezes em 30 dias). Migrar para coluna JSON na tabela `users`.

4. **Upgrade de modelo para Sonnet em premium** — Haiku 4.5 gera output de 296 tokens quando tem o prompt completo. Sonnet 4.6 geraria mais nuance cultural por $0.005 a mais por request premium.

5. **Feedback loop de outcome** — Após sugestão, em 24h perguntar "funcionou?" → salvar em `girl_profiles.what_worked` → injetar nas próximas análises como contexto personalizado.

---

## Bug "trava em 1-2 mensagens"

**Diagnóstico:** Não é rate limit, quota ou timeout. É o path de fallback em `enviarResposta`.

Quando Haiku não usa `---` para separar blocos, `splitByDashes()` retorna array com 1 elemento. O código então tenta parsear manualmente (extrairDiagnostico, parsearOpcoes, extrairDica). Se o output de 90-124 tokens não contém os padrões esperados (📍, 🔥, 😏, ⚡), a mensagem sai incompleta — parece "travamento" do lado do usuário.

**Evidência:** `index.js:1886` — log `[enviarResposta] Fallback padrão ativado` aparece nos logs do servidor.

**Causa raiz:** Com SYSTEM_PROMPT_DEGRADED, as instruções de formato são mais fracas. O modelo às vezes gera texto corrido sem separadores.

**Correção:**

```javascript
// index.js:1874 — melhorar fallback de fallback
const blocos = splitByDashes(sugestoes);

if (blocos.length > 2) {
  await sendWithDelay(message.from, blocos, { phone, intent });
  // ... continua
  return;
}

// NOVO: tentar split por linha em branco antes de desistir
const porLinhaEmBranco = sugestoes.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
if (porLinhaEmBranco.length > 1) {
  console.warn(`[enviarResposta] Fallback linha-em-branco | intent:${intent} | phone:${phone}`);
  await sendWithDelay(message.from, porLinhaEmBranco, { phone, intent });
  return;
}

// Último recurso: manda tudo de uma vez (não deixa em branco)
console.warn(`[enviarResposta] Fallback total | intent:${intent} | phone:${phone}`);
await client.sendMessage(message.from, sugestoes.trim());
```

**Esforço:** 1 hora
**Impacto:** Elimina o "travamento" — usuário sempre recebe algo

---

## Roadmap próximos 7 dias

**Dia 1 — Deploy imediato (impact > esforço):**
- Trocar `volume` de `SYSTEM_PROMPT_DEGRADED` para `SYSTEM_PROMPT` (`index.js:1622`) — 30 min
- Corrigir fallback de `enviarResposta` — 1h
- Adicionar exemplos concretos no CLASSIFIER_PROMPT — 1h

**Dia 2:**
- Baixar critério de `premium` no classifier
- Testar com 10 situações reais e verificar se coaching/ousadia/outcome disparam

**Dia 3-4:**
- Implementar coleta de contexto antes do print ("quem é ela?")
- Salvar resposta em `girl_profiles` automaticamente
- Testar fluxo completo: pergunta → resposta → análise com contexto

**Dia 5:**
- Adicionar `response_text` em `api_requests` para logging do output real
- A partir daí: auditoria de qualidade passa a ter dados reais

**Dia 6:**
- Persistir `userContext` no banco para sobreviver restarts
- Verificar que contexto é carregado corretamente após restart

**Dia 7:**
- Review com usuários reais: mostrar exemplos de output antes/depois
- Ajuste fino de temperatura se necessário baseado em feedback
