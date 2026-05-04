# Comparativo ANTES/DEPOIS — Persona 2026

> Todas as mudanças de texto voltado ao usuário. Para inventário completo do estado anterior, ver `01-inventario-antes.md`.

---

## 1. WELCOME_MESSAGES

**ANTES:**
```
[0] "Boa que chegou aqui. 👊

Sou o MandaAssim — leio a conversa com ela e te dou 3 respostas prontas pra copiar.

Sem papo de coach. Sem técnica de sedução. Só o que funciona."

[1] "Funciona assim: você manda o print ou descreve em texto o que tá rolando.

Eu leio o contexto dela — o tom, o que ela disse, o que aconteceu antes — e gero 3 opções:

🔥 Uma que aquece
😏 Uma que provoca levemente
⚡ Uma direta e sem ansiedade

*3 dias ilimitados pra testar. Sem cartão.*"

[2] "Tem alguma conversa rolando agora? Manda o print ou descreve a situação."
```

**DEPOIS:**
```
[0] "Boa, chegou aqui.

Sou o MandaAssim — leio o que ela quis dizer antes de sugerir o que responder. Não é técnica, não é coach. É leitura de situação.

Funciona assim: você manda o print ou descreve o que tá rolando. Eu leio o contexto dela e gero 3 opções reais pra copiar.

*3 dias ilimitados. Sem cartão.*"

[1] "Pra começar melhor — qual é a sua situação agora?

1️⃣ Voltei pro mercado depois de muito tempo fora (separação, divórcio)
2️⃣ Tô nos apps mas não tô conseguindo evoluir as conversas
3️⃣ Tenho uma conversa específica rolando agora
4️⃣ Outro

Só me fala o número ou descreve — ou já manda o print direto."

[2] "Pode mandar o print da conversa ou descreve a situação. Eu leio e te dou as opções."
```

**Por quê:** O ICP de 2026 é 32-45, muitos voltando pro mercado pós-separação. A mensagem [1] agora reconhece isso explicitamente e cria contexto antes de começar, sem perder quem já tem conversa rolando (opção 3/4). "Sem técnica de sedução" e "👊" foram removidos — soavam como marketing de pickup.

---

## 2. MENSAGEM_RENOVACAO

**ANTES:** `"Seu acesso ilimitado expira em *3 dias*.\n\nSe quiser renovar antes de acabar: digita *mensal* ou *anual*."`

**DEPOIS:** `"Seu acesso ilimitado vence em *3 dias*.\n\nSe quiser renovar antes: *mensal* ou *anual*."`

**Por quê:** Mais enxuto. "expira" → "vence" (menos alarmista). Remove o "digita" desnecessário — o usuário já sabe.

---

## 3. OPCOES_PREMIUM

**ANTES:**
```
"👉 Escolhe como continuar:

⚡ *24h ilimitado* — R$4,99 → digita *24h*
📅 *Mensal* — R$29,90/mês → digita *mensal*
📆 *Anual* — R$299/ano _(economiza R$60)_ → digita *anual*

_+1.200 caras já usaram essa semana_"
```

**DEPOIS:**
```
"Escolhe como continuar:

⚡ *24h* — R$4,99 → digita *24h*
📅 *Mensal* — R$29,90/mês → digita *mensal*
📆 *Anual* — R$299/ano _(economiza R$60)_ → digita *anual*"
```

**Por quê:** Removeu "👉" (desnecessário), "ilimitado" do 24h (implicito), e o social proof falso "_+1.200 caras já usaram essa semana_" — se for falso, corrói confiança; se for verdadeiro, ainda soa como marketing barato.

---

## 4. LIMITE_FREE_ESGOTADO

**ANTES:** `"Deu 3 por hoje. Amanhã renova.\n\nSe a conversa tá quente e não dá pra esperar: *mensal* (R$29,90) ou *anual* (R$299)."`

**DEPOIS:** `"Deu 3 por hoje. Amanhã cedo renova.\n\nSe não dá pra esperar: *mensal* (R$29,90) ou *anual* (R$299)."`

**Por quê:** "Amanhã cedo" é mais específico e tranquilizador. "Se a conversa tá quente" era condicionante desnecessário — se o cara chegou no limite, provavelmente tem conversa rolando.

---

## 5. PRINT_UPSELL_MESSAGE

**ANTES:**
```
"Análise de print é uma feature do *Wingman Premium* 🔍

Com ela: manda qualquer conversa do Tinder, WhatsApp ou Bumble e eu leio o que tá rolando — interesse dela, temperatura da conversa, erros, próxima mensagem certa.

👉 Escolhe como continuar:

⚡ *24h ilimitado* — R$4,99 → digita *24h*
📅 *Mensal* — R$29,90/mês → digita *mensal*
📆 *Anual* — R$299/ano _(economiza R$60)_ → digita *anual*"
```

**DEPOIS:**
```
"Análise de print é do *Wingman* 🔍

Manda o print da conversa — eu leio o que tá rolando: interesse dela, temperatura, o que fazer agora.

⚡ *24h* — R$4,99 → *24h*
📅 *Mensal* — R$29,90 → *mensal*
📆 *Anual* — R$299 → *anual*"
```

**Por quê:** "uma feature do" → "é do" (mais direto). "Wingman Premium" → "Wingman" (nome atual). Removeu "👉" e o bloco duplicado de opções. Descrição mais curta mantendo os benefícios essenciais.

---

## 6. PRINT_LIMIT_REACHED_PREMIUM

**ANTES:** `"Chegou no limite de 5 análises de print hoje.\n\nAmanhã cedo tem mais 5. Usa texto enquanto isso — descreve o que ela mandou que eu analiso."`

**DEPOIS:** `"Deu 5 análises de print hoje — o limite do plano.\n\nAmanhã cedo renova. Enquanto isso, descreve em texto o que ela mandou — funciona igual."`

**Por quê:** "Chegou no limite" → "Deu X" (mais brasileiro). "funciona igual" é mais verdadeiro e tranquilizador.

---

## 7. PROFILE_UPSELL_MESSAGE

**ANTES:**
```
"Análise de Perfil é do *Wingman Pro* (R$79,90/mês) 🔍

Você manda o print do perfil dela no Tinder, Bumble ou Instagram — eu leio o que ela revela sobre si mesma e gero a primeira mensagem certa. Daquelas que ela percebe que você realmente olhou.

+ Análise de conversa (5/dia)
+ Análise de perfil (10/dia)
+ Mensagens ilimitadas

Quer fazer upgrade? Digita *pro* 👇"
```

**DEPOIS:**
```
"Análise de Perfil é do *Wingman Pro* (R$79,90/mês) 🔍

Você manda o print do perfil dela — eu leio o que ela está sinalizando e gero a mensagem de abertura certa. Não uma abertura genérica: uma baseada no que está ali.

Wingman Pro inclui:
• Análise de conversa (5/dia)
• Análise de perfil (10/dia)
• Mensagens ilimitadas

Digita *pro* 👇"
```

**Por quê:** "o que ela revela sobre si mesma" era ligeiramente invasivo em tom. "o que ela está sinalizando" é mais neutro. "Quer fazer upgrade?" removido — a chamada já está no botão.

---

## 8. TRANSITION_COACH_UPSELL_FREE

**ANTES:**
```
"Marcar o primeiro encontro é o momento mais crítico — e a maioria erra aqui.

Com o *Coach de Transição* eu te guio pra hora certa, com a mensagem certa.

Disponível no *Wingman Premium* (R$29,90/mês) ou *Anual* (R$299).

Digita *mensal* ou *anual* 👇"
```

**DEPOIS:**
```
"Chamar pra sair no momento certo — com a mensagem certa — é o que separa conversa boa de encontro marcado.

Com o *Coach de Transição* eu leio onde a conversa está e te digo quando e como chamar.

Disponível no *Wingman* (R$29,90/mês) ou *Anual* (R$299).

*mensal* ou *anual* 👇"
```

**Por quê:** Abre com benefício concreto em vez de "a maioria erra". "Wingman Premium" → "Wingman" (nome certo). Descrição do que o feature faz é mais específica.

---

## 9. PREDATE_COACH_UPSELL_FREE

**ANTES:**
```
"Preparação para encontro é do *Wingman Premium* 🗓️

Você me conta quando e onde — eu te dou o checklist completo: roupa, conversa, chegada, o que evitar, mensagem depois.

Disponível no *Wingman Premium* (R$29,90/mês) ou *Anual* (R$299).

Digita *mensal* ou *anual* 👇"
```

**DEPOIS:**
```
"Preparação de encontro é do *Wingman* 🗓️

Você me conta quando e onde — eu te dou o que você precisa saber: roupa, chegada, o que evitar, como agir quando ela chegar.

Disponível no *Wingman* (R$29,90/mês) ou *Anual* (R$299).

*mensal* ou *anual* 👇"
```

**Por quê:** "checklist completo" + "mensagem depois" era selling excessivo. "o que você precisa saber" é mais honesto. Nome atualizado.

---

## 10. POSTDATE_DEBRIEF_UPSELL_FREE

**ANTES:**
```
"Debrief de encontro é do *Wingman Premium* 🔍

Você me conta como foi — eu analiso o que rolou, o que funcionou, o que errou e qual o próximo passo certo.

Sem rodeios. Honestidade total.

Disponível no *Wingman Premium* (R$29,90/mês) ou *Anual* (R$299).

Digita *mensal* ou *anual* 👇"
```

**DEPOIS:**
```
"Analisar o encontro é do *Wingman* 🔍

Você me conta como foi — eu leio o que aconteceu, o que sinalizou interesse ou não, e qual o próximo passo certo.

Sem rodeios.

Disponível no *Wingman* (R$29,90/mês) ou *Anual* (R$299).

*mensal* ou *anual* 👇"
```

**Por quê:** "Honestidade total" soava como slogan. "eu leio o que aconteceu, o que sinalizou" é mais consistente com o mecanismo de Leitura de Intenção. Nome atualizado.

---

## 11. MINDSET_INVITE_MESSAGE

**ANTES:**
```
"Tenho um material extra que mando 3x por semana de manhã — pequenas reflexões sobre paquera, postura, como lidar com rejeição, identidade. Não é palestra, são recados curtos.

Quer ativar? Responde *sim* ou *não*."
```

**DEPOIS:**
```
"Tenho um material extra que mando algumas vezes por semana de manhã — reflexões curtas sobre postura, como ler situações, o que funciona e o que não funciona no mercado hoje.

Não é autoajuda. São recados diretos.

Quer receber? *sim* ou *não*."
```

**Por quê:** "paquera" e "rejeição, identidade" soavam como autoajuda. "o que funciona e o que não funciona no mercado hoje" é mais concreto e alinhado com o ICP de 32-45. "Não é autoajuda" explicita o posicionamento.

---

## 12. MENSAGENS_ESPERA_PERFIL (uma entrada)

**ANTES:** `'Lendo o vibe dela pela foto... ⏳'`

**DEPOIS:** Removida — "vibe" é palavra banida. As outras 3 entradas foram mantidas.

---

## 13. Mensagens de Trial (1ª msg do dia)

**ANTES:**
```
lastHours: "Seu acesso ilimitado fecha em menos de *2h*.\n\nQuer continuar sem parar? *mensal* (R$29,90) ou *anual* (R$299)."

isLastDay: "Hoje é seu último dia ilimitado.\n\nAmanhã passa pra *3 análises/dia* gratuitamente — ou continua ilimitado:\n\n*mensal* (R$29,90) · *anual* (R$299)\n\n_Digita *status* pra ver seu plano_"

outros: "*X dia(s)* de acesso ilimitado. Manda o que tiver.\n\n_Digita *status* a qualquer momento_"
```

**DEPOIS:**
```
lastHours: "Acesso ilimitado fecha em menos de *2h*.\n\n*mensal* (R$29,90) ou *anual* (R$299) se quiser continuar."

isLastDay: "Hoje é o último dia ilimitado.\n\nAmanhã passa pra *3 análises/dia* — ou continua ilimitado:\n\n*mensal* (R$29,90) · *anual* (R$299)"

outros: "*X dia(s)* ilimitados. Manda o que tiver.\n\n_*status* pra ver seu plano_"
```

**Por quê:** Mais secos e diretos. Remove "Seu" no começo (mais impessoal quando bloqueado). Remove "gratuitamente" (o usuário não perguntou). Remove "Digita" redundante.

---

## 14. Upsell no pico emocional

**ANTES:**
```
isLastDay + msgs ≥ 3: "Hoje é seu último dia ilimitado — e você ainda tem conversa pra resolver.\n\n${OPCOES_PREMIUM}"

lastHours + msgs ≥ 1: "Seu acesso ilimitado fecha em menos de *2h*. Se quiser continuar sem parar:\n\n${OPCOES_PREMIUM}"

free + última análise: "Última análise de hoje.\n\nSe a conversa tá no ponto e não dá pra esperar: *mensal* (R$29,90) ou *anual* (R$299)."
```

**DEPOIS:**
```
isLastDay + msgs ≥ 3: "Hoje é seu último dia ilimitado.\n\n${OPCOES_PREMIUM}"

lastHours + msgs ≥ 1: "Fecha em menos de *2h*. Se quiser continuar:\n\n${OPCOES_PREMIUM}"

free + última análise: "Última análise de hoje.\n\nSe não dá pra esperar amanhã: *mensal* (R$29,90) ou *anual* (R$299)."
```

**Por quê:** Remove "e você ainda tem conversa pra resolver" — presunçoso. "Seu acesso ilimitado" → "Fecha" (mais urgente, mais curto). "continuar sem parar" → "continuar" (sem drama).

---

## 15. Win-back + conversa quente

**ANTES:**
```
win-back: "Deu 3 por hoje.\n\nComo você já assinou antes: *voltar* por R$19,90 no primeiro mês _(era R$29,90)_."

conversa quente: "Deu o limite. Se a conversa tá no ponto: *mensal* (R$29,90) ou *anual* (R$299)."
```

**DEPOIS:**
```
win-back: "Deu 3 por hoje.\n\nComo você já assinou antes, tem uma oferta de volta: *voltar* por R$19,90 no primeiro mês."

conversa quente: "Deu o limite por hoje. Se não dá pra esperar: *mensal* (R$29,90) ou *anual* (R$299)."
```

**Por quê:** Win-back: "_(era R$29,90)_" em itálico soava como preço de liquidação. "tem uma oferta de volta" é mais digno. Conversa quente: "tá no ponto" era condicional desnecessário.

---

## 16. Comando `status`

**ANTES:**
```
isPro: "🔥 *Wingman Pro* — mensagens ilimitadas + Análise de Perfil\n_Válido até {data}_"
isPremium: "🌟 *Wingman* — mensagens ilimitadas\n_Válido até {data}_"
inTrial: "🎉 *Trial ativo* — ilimitado por mais menos de 2h\n_Usado hoje: X análise(s)_"
free: "🆓 *Free* — X/3 análises usadas hoje · Y restante(s)"
cabeçalho: "📊 *Seu status:*"
```

**DEPOIS:**
```
isPro: "🔥 *Wingman Pro* — mensagens ilimitadas + Análise de Perfil\n_Válido até {data}_"
isPremium: "🌟 *Wingman* — mensagens ilimitadas\n_Válido até {data}_"
inTrial: "⏳ *Trial* — ilimitado por mais X dia(s)\n_Usado hoje: X análise(s)_"
free: "🆓 *Free* — X/3 hoje · Y restante(s)"
cabeçalho: "*Seu plano:*"
```

**Por quê:** Trial: "🎉" (celebração) foi trocado por "⏳" (urgência de tempo restante). "🎉 Trial ativo" soava excessivo. "📊 Seu status:" → "*Seu plano:*" (mais direto). Linha free encurtada.

---

## 17. Paguei — confirmações

**ANTES:**
```
já ativo: "✅ Pagamento confirmado! Você já é *Wingman* — pode mandar à vontade 🚀"
24h: "✅ *24h ativado!*\n\nAcesso ilimitado pelas próximas *24 horas* 🚀\n\nAproveita — manda o print agora!"
Pro: "✅ *Wingman Pro ativado!* 🔥\n\nAgora você tem Análise de Perfil + tudo mais. Manda o print do perfil dela pra testar 👇"
mensal: "✅ *Pagamento confirmado!*\n\nBem-vindo ao *Wingman* 🚀\n\nVocê agora tem mensagens *ilimitadas*. Manda o próximo print ou descreve a situação!"
pendente: "⏳ Seu Pix ainda não foi confirmado pelo banco.\n\nNormalmente cai em menos de 1 minuto. Aguarda e tenta de novo! 🙏"
```

**DEPOIS:**
```
já ativo: "✅ *Wingman ativo* — pode mandar à vontade."
24h: "✅ *24h ativado* — acesso ilimitado pelas próximas 24 horas. Manda o print."
Pro: "✅ *Wingman Pro ativado* — Análise de Perfil liberada. Manda o print do perfil dela 👇"
mensal: "✅ *Wingman ativado* — mensagens ilimitadas. Manda o próximo print ou descreve a situação."
pendente: "Pix ainda não confirmado pelo banco.\n\nNormalmente cai em menos de 1 minuto. Tenta de novo em instantes."
```

**Por quê:** Remove exclamações em excesso e 🚀/🙏 desnecessários. Tom mais maduro. "Bem-vindo ao Wingman" era excessivo — o usuário já sabe o que é. Pendente sem "⏳" e "🙏" — era ansioso.

---

## 18. Pix — mensagens de geração

**ANTES:**
```
"Perfeito! Gerei seu Pix 👇\n\n⚠️ O Pix aparecerá no nome *Rafael Cabral Ibraim* — esse é o nome do responsável pelo MandaAssim. É seguro pagar normalmente! ✅"
"✅ Após o pagamento, você receberá a confirmação aqui no WhatsApp em menos de 1 minuto.\n\n_Se demorar mais, digita *paguei* que eu verifico pra você._"
```

**DEPOIS:**
```
"Gerado 👇\n\n_O Pix aparece no nome *Rafael Cabral Ibraim* — é o responsável pelo MandaAssim. Pode pagar normalmente ✅_"
"_Confirmação chega aqui em menos de 1 minuto. Se demorar: *paguei*_"
```

**Por quê:** "Perfeito!" e "⚠️" eram excessivos. "você receberá" formal demais. Mais enxuto mantendo toda a informação necessária.

---

## 19. followupMessages.js

**ANTES:** `day1_inactive[1]`: `"E aí, apareceu. Alguma conversa pra resolver? Manda aqui."`
**DEPOIS:** Mantido (já era bom).

**ANTES:** `limit_drop_3[1]`: `"Mudou pra 3 análises por dia. Usa nas situações que realmente precisam."`
**DEPOIS:** `"Trial encerrado — agora são 3/dia. Usa nas situações que realmente precisam."` — explicita o porquê da mudança.

**ANTES:** `predate_reminder_day_before`: `"Você tá pronto 💪"`
**DEPOIS:** `"Você tá pronto."` — sem o emoji desnecessário na versão alternativa.

**ANTES:** `TRANSITION_COACH_OUTCOME_MESSAGE`: `"Ei, lembra que te ajudei a chamar ela pra sair semana passada?\n\nComo foi? Ela topou? Me conta aqui — pode ser curto, só quero saber o resultado 👇"`
**DEPOIS:** `"Semana passada te ajudei a chamar ela pra sair.\n\nComo foi? Ela topou? Me conta — pode ser curto 👇"` — Remove "Ei" e "só quero saber o resultado" (óbvio).

---

## 20. SYSTEM_PROMPT (principal)

**Mudanças estruturais:**

| Seção | Antes | Depois |
|-------|-------|--------|
| Cabeçalho | "Entrega as mensagens certas pro momento certo" | "Lê o que ela quis dizer — e entrega a resposta certa pra aquele momento" |
| Seção de abertura | "=== O QUE VOCÊ SABE QUE OS OUTROS NÃO SABEM ===" (tom de guru) | "=== LEITURA DE INTENÇÃO ===" (mecanismo explícito) |
| Princípio de atração | "A mulher brasileira não lê o texto — ela lê a energia por trás do texto" (pickup frame) | Removido — substituído por explicação do mecanismo Leitura de Intenção |
| "Ela testa" | "Sumiço, frieza, resposta seca — quase sempre é teste" (hipergeneralização) | "está esperando pra ver se ele vai cobrar" (mais específico, sem "teste" como frame de jogo) |
| Cenários especiais | Filhos/separação mencionados mas sem contexto de 32-45 | Adicionado: "O cara que voltou pro mercado aos 35-45 tem mais pra oferecer, não menos" |
| Regra de ouro | "Nunca soe como alguém que precisa da aprovação dela" (linguagem de pickup) | "Nunca over-share, nunca se justifique" (comportamento concreto) |
| Diagnóstico no output | `📍 _[o que ela tá sinalizando agora]_` | `📍 _[o que ela sinalizou — leitura de intenção]_` |

---

## 21. SYSTEM_PROMPT_COACH

**Mudanças estruturais:**

| Seção | Antes | Depois |
|-------|-------|--------|
| Definição | "amigo experiente que já viu tudo, fala sem rodeios e não bajula" | "amigo experiente que já viu de tudo, fala sem rodeio e respeita quem está na frente" |
| Como você pensa | Começa com leitura dela | **Escuta primeiro**: "O que ele descreveu de fato aconteceu? Qual é o contexto completo?" |
| Princípio de atração | "Presença segura atrai, necessidade repele. Quem persegue perde poder." (pickup dogma) | "Menos texto > mais texto. Quem manda muito tá ansioso. Ansiedade afasta." (comportamento concreto) |
| "Silêncio estratégico" | "Silêncio estratégico > explicação" (manipulativo) | Removido |
| "Ela testa" | "Ela não tá com raiva de você — tá vendo se você mantém o rumo." | Removido — hipergeneralização |
| Reconquista | "No-contact mínimo 14-21 dias" (número mágico) + "indiferença calculada" (alfa-toxic) | "Afastamento primeiro" + "tempo varia por contexto — não existe número mágico" |
| Voltou pro mercado | Presente mas genérico | Expandido: erro de over-share, filhos como contexto, ansiedade com apps, ICP explícito |
| Formato de saída | "Evita isso" | "Evita" (mais curto) |
| Título seção ação | "O que fazer agora:" | "O que fazer:" |

---

## 22. SYSTEM_PROMPT_DEGRADED

**Antes:** `"PRINCÍPIO: presença segura atrai, necessidade repele. Menos palavras = mais confiança."`

**Depois:** `"PRINCÍPIO: quem explica muito, perde. Menos palavras = mais presença."`

**Por quê:** Remove "presença segura atrai, necessidade repele" (pickup vocabulary). Versão nova é mais concreta e evita o jargão.

---

## 23. Mensagens não alteradas

As seguintes mensagens foram mantidas sem mudança — já estavam alinhadas com a persona:

- `SYSTEM_PROMPT_MINIMAL` — curto, direto, sem issues
- `SYSTEM_PROMPT_OUSADIA` — tom adequado para o contexto
- `CLASSIFIER_PROMPT` — técnico, sem persona
- `MENSAGENS_ESPERA` (maioria) — já adequadas
- `PROFILE_LIMIT_REACHED_PRO` — simples, direto
- `TRANSITION_COACH_UPSELL_PREMIUM_LIMIT` — leve ajuste de nome
- Comandos de perfil dela (nome, salvar, limpar) — adequados
- Respostas de feedback (positivo/negativo) — já corretas
- Comandos de mindset (cancelar, frequência) — adequados
- Respostas de pro/wingman pro já ativo — simples
