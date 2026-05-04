# Inventário de Touchpoints — Estado Anterior (Pré-Persona 2026)

> Registro verbatim de todos os textos voltados ao usuário antes da reescrita.
> Para o comparativo ANTES/DEPOIS, ver `03-comparativo-prompts.md`.

---

## 1. WELCOME_MESSAGES (`index.js` ~linha 110)

```
[0] "Boa que chegou aqui. 👊\n\nSou o MandaAssim — leio a conversa com ela e te dou 3 respostas prontas pra copiar.\n\nSem papo de coach. Sem técnica de sedução. Só o que funciona."

[1] "Funciona assim: você manda o print ou descreve em texto o que tá rolando.\n\nEu leio o contexto dela — o tom, o que ela disse, o que aconteceu antes — e gero 3 opções:\n\n🔥 Uma que aquece\n😏 Uma que provoca levemente\n⚡ Uma direta e sem ansiedade\n\n*3 dias ilimitados pra testar. Sem cartão.*"

[2] "Tem alguma conversa rolando agora? Manda o print ou descreve a situação."
```

---

## 2. MENSAGEM_RENOVACAO (`index.js` ~linha 105)

```
"Seu acesso ilimitado expira em *3 dias*.\n\nSe quiser renovar antes de acabar: digita *mensal* ou *anual*."
```

---

## 3. OPCOES_PREMIUM (`index.js` ~linha 116)

```
"👉 Escolhe como continuar:\n\n⚡ *24h ilimitado* — R$4,99 → digita *24h*\n📅 *Mensal* — R$29,90/mês → digita *mensal*\n📆 *Anual* — R$299/ano _(economiza R$60)_ → digita *anual*\n\n_+1.200 caras já usaram essa semana_"
```

---

## 4. LIMITE_FREE_ESGOTADO (`index.js` ~linha 123)

```
"Deu 3 por hoje. Amanhã renova.\n\nSe a conversa tá quente e não dá pra esperar: *mensal* (R$29,90) ou *anual* (R$299)."
```

---

## 5. Print Analysis

```js
PRINT_UPSELL_MESSAGE:
"Análise de print é uma feature do *Wingman Premium* 🔍\n\nCom ela: manda qualquer conversa do Tinder, WhatsApp ou Bumble e eu leio o que tá rolando — interesse dela, temperatura da conversa, erros, próxima mensagem certa.\n\n👉 Escolhe como continuar:\n\n⚡ *24h ilimitado* — R$4,99 → digita *24h*\n📅 *Mensal* — R$29,90/mês → digita *mensal*\n📆 *Anual* — R$299/ano _(economiza R$60)_ → digita *anual*"

PRINT_LIMIT_REACHED_PREMIUM:
"Chegou no limite de 5 análises de print hoje.\n\nAmanhã cedo tem mais 5. Usa texto enquanto isso — descreve o que ela mandou que eu analiso."

PRINT_LIMIT_REACHED_TRIAL:
"Deu 1 análise de print por hoje — esse é o limite do trial.\n\nQuer ilimitado? *mensal* (R$29,90) ou *anual* (R$299)."
```

---

## 6. Profile Analysis

```js
PROFILE_UPSELL_MESSAGE:
"Análise de Perfil é do *Wingman Pro* (R$79,90/mês) 🔍\n\nVocê manda o print do perfil dela no Tinder, Bumble ou Instagram — eu leio o que ela revela sobre si mesma e gero a primeira mensagem certa. Daquelas que ela percebe que você realmente olhou.\n\n+ Análise de conversa (5/dia)\n+ Análise de perfil (10/dia)\n+ Mensagens ilimitadas\n\nQuer fazer upgrade? Digita *pro* 👇"

PROFILE_LIMIT_REACHED_PRO:
"Chegou no limite de 10 análises de perfil hoje.\n\nAmanhã cedo tem mais 10."
```

---

## 7. Transition Coach (C3)

```js
TRANSITION_COACH_UPSELL_FREE:
"Marcar o primeiro encontro é o momento mais crítico — e a maioria erra aqui.\n\nCom o *Coach de Transição* eu te guio pra hora certa, com a mensagem certa.\n\nDisponível no *Wingman Premium* (R$29,90/mês) ou *Anual* (R$299).\n\nDigita *mensal* ou *anual* 👇"

TRANSITION_COACH_UPSELL_PREMIUM_LIMIT:
"Você já usou as 2 sessões do Coach de Transição esse mês.\n\nRenova no mês que vem, ou faz upgrade pro *Wingman Pro* (ilimitado) 🔥\n\nDigita *pro* se quiser."
```

---

## 8. Pre-Date Coach (C4)

```js
PREDATE_COACH_UPSELL_FREE:
"Preparação para encontro é do *Wingman Premium* 🗓️\n\nVocê me conta quando e onde — eu te dou o checklist completo: roupa, conversa, chegada, o que evitar, mensagem depois.\n\nDisponível no *Wingman Premium* (R$29,90/mês) ou *Anual* (R$299).\n\nDigita *mensal* ou *anual* 👇"

PREDATE_COACH_UPSELL_PREMIUM_LIMIT:
"Você já usou sua sessão pré-date do mês.\n\nRenova no mês que vem, ou faz upgrade pro *Wingman Pro* (ilimitado) 🔥\n\nDigita *pro* se quiser."
```

---

## 9. Post-Date Debrief (C5)

```js
POSTDATE_DEBRIEF_UPSELL_FREE:
"Debrief de encontro é do *Wingman Premium* 🔍\n\nVocê me conta como foi — eu analiso o que rolou, o que funcionou, o que errou e qual o próximo passo certo.\n\nSem rodeios. Honestidade total.\n\nDisponível no *Wingman Premium* (R$29,90/mês) ou *Anual* (R$299).\n\nDigita *mensal* ou *anual* 👇"

POSTDATE_DEBRIEF_UPSELL_PREMIUM_LIMIT:
"Você já fez seu debrief do mês.\n\nRenova no mês que vem, ou faz upgrade pro *Wingman Pro* (ilimitado) 🔥\n\nDigita *pro* se quiser."
```

---

## 10. Mindset Opt-In (C6)

```js
MINDSET_INVITE_MESSAGE:
"Tenho um material extra que mando 3x por semana de manhã — pequenas reflexões sobre paquera, postura, como lidar com rejeição, identidade. Não é palestra, são recados curtos.\n\nQuer ativar? Responde *sim* ou *não*."

MINDSET_ACTIVATED_MESSAGE:
"Ativado ✅\n\nVou mandar 3 por semana — segunda, quarta e sexta de manhã.\n\nPra mudar frequência, digita:\n• *mindset 1x* — 1 por semana\n• *mindset 3x* — 3 por semana (padrão)\n• *mindset 5x* — dias úteis\n• *mindset diário* — todo dia\n\nPra pausar: *cancelar mindset*"

MINDSET_DECLINED_MESSAGE:
"Ok, sem problema. Se quiser ativar depois: *ativar mindset*."
```

---

## 11. Mensagens de Trial (inline, ~linha 1894)

```
lastHours (< 2h):
"Seu acesso ilimitado fecha em menos de *2h*.\n\nQuer continuar sem parar? *mensal* (R$29,90) ou *anual* (R$299)."

isLastDay:
"Hoje é seu último dia ilimitado.\n\nAmanhã passa pra *3 análises/dia* gratuitamente — ou continua ilimitado:\n\n*mensal* (R$29,90) · *anual* (R$299)\n\n_Digita *status* pra ver seu plano_"

outros dias:
"*${trialDaysLeft} dia(s)* de acesso ilimitado. Manda o que tiver.\n\n_Digita *status* a qualquer momento_"
```

---

## 12. Upsell no pico emocional (inline, ~linha 1489)

```
isLastDay + todayCount >= 3:
"Hoje é seu último dia ilimitado — e você ainda tem conversa pra resolver.\n\n${OPCOES_PREMIUM}"

lastHours + todayCount >= 1:
"Seu acesso ilimitado fecha em menos de *2h*. Se quiser continuar sem parar:\n\n${OPCOES_PREMIUM}"

free + todayCount === FREE_DAILY_LIMIT:
"Última análise de hoje.\n\nSe a conversa tá no ponto e não dá pra esperar: *mensal* (R$29,90) ou *anual* (R$299)."
```

---

## 13. Limite + win-back (inline, ~linha 1874)

```
win-back:
"Deu 3 por hoje.\n\nComo você já assinou antes: *voltar* por R$19,90 no primeiro mês _(era R$29,90)_."

conversa quente:
"Deu o limite. Se a conversa tá no ponto: *mensal* (R$29,90) ou *anual* (R$299)."
```

---

## 14. Comando `status` (inline, ~linha 1657)

```
isPro:
"🔥 *Wingman Pro* — mensagens ilimitadas + Análise de Perfil\n_Válido até {data}_"

isPremium:
"🌟 *Wingman* — mensagens ilimitadas\n_Válido até {data}_"

inTrial (lastHours):
"🎉 *Trial ativo* — ilimitado por mais menos de 2h\n_Usado hoje: X análise(s)_"

inTrial (normal):
"🎉 *Trial ativo* — ilimitado por mais *X dia(s)*\n_Usado hoje: X análise(s)_"

free:
"🆓 *Free* — X/3 análises usadas hoje · Y restante(s)"
```

---

## 15. Comando `premium` já assinante

```
"🌟 Você já é *Wingman*! Pode mandar à vontade."
```

---

## 16. Pix / Pagamento

```
Pix mensal/anual/24h:
"Perfeito! Gerei seu Pix 👇\n\n⚠️ O Pix aparecerá no nome *Rafael Cabral Ibraim* — esse é o nome do responsável pelo MandaAssim. É seguro pagar normalmente! ✅"
"✅ Após o pagamento, você receberá a confirmação aqui no WhatsApp em menos de 1 minuto.\n\n_Se demorar mais, digita *paguei* que eu verifico pra você._"

Pix Pro (enviarCobrancaPixPro):
"*Wingman Pro — R$79,90/mês* 🔥\n\nInclui:\n• Mensagens ilimitadas\n• Análise de print de conversa (5/dia)\n• *Análise de Perfil* no Tinder, Bumble, Instagram (10/dia)\n\n⚠️ Pix aparecerá no nome *Rafael Cabral Ibraim* — é o responsável pelo MandaAssim. Seguro pagar normalmente ✅"
"✅ Após o pagamento, você recebe confirmação aqui em menos de 1 minuto.\n\n_Se demorar, digita *paguei* que eu verifico._"
```

---

## 17. Paguei — confirmação

```
Já ativo:
"✅ Pagamento confirmado! Você já é *Wingman* — pode mandar à vontade 🚀"

24h ativado:
"✅ *24h ativado!*\n\nAcesso ilimitado pelas próximas *24 horas* 🚀\n\nAproveita — manda o print agora!"

Pro ativado:
"✅ *Wingman Pro ativado!* 🔥\n\nAgora você tem Análise de Perfil + tudo mais. Manda o print do perfil dela pra testar 👇"

Mensal ativado:
"✅ *Pagamento confirmado!*\n\nBem-vindo ao *Wingman* 🚀\n\nVocê agora tem mensagens *ilimitadas*. Manda o próximo print ou descreve a situação!"

Pix pendente:
"⏳ Seu Pix ainda não foi confirmado pelo banco.\n\nNormalmente cai em menos de 1 minuto. Aguarda e tenta de novo! 🙏"

Nenhum pagamento encontrado:
"Não encontrei nenhum pagamento. Digita *mensal* pra gerar um novo Pix."
```

---

## 18. Saudações simples (inline, ~linha 2190)

```
"Manda o print da conversa ou descreve o que tá rolando — eu leio o contexto e gero as opções."
```

---

## 19. Perfil dela — respostas de comando

```
Sem perfil salvo:
"Ainda não tem perfil salvo 📋\n\nManda assim:\n\n*ela se chama [nome]*\n*ela é [descrição]*\n\nEx: _"ela é agitada, fica no zap o dia todo, já ficamos uma vez"_"

Feedback positivo:
"Anotei. Vou usar de referência nas próximas. Manda o próximo quando quiser."

Feedback negativo:
"Nem sempre cola na primeira. Manda como ela reagiu — ajusto a abordagem."

Limpar perfil:
"Perfil limpo ✅\n\nNova conversa, do zero. Manda o print ou descreve a situação."

Nome salvo:
"Salvo ✅ Ela se chama *${nome}*.\n\nAgora manda o print ou descreve o que aconteceu — vou usar o contexto dela nas respostas."

Perfil salvo:
"Perfil salvo ✅\n\nAgora toda resposta vai ser personalizada pra ela. Manda o print ou descreve o que aconteceu 🎯"

Contexto salvo:
"Contexto salvo ✅\n\nManda o print ou o que ela disse por último."
```

---

## 20. Mensagens de espera

```js
MENSAGENS_ESPERA:
'Lendo o contexto... ⏳',
'Deixa eu ver o que tá rolando aqui... ⏳',
'Analisando ela... ⏳',
'Tô lendo, já te mando... ⏳',
'Um segundo... ⏳',
'Vendo o melhor ângulo pra isso... ⏳',
'Lendo o que ela disse... ⏳',
'Já tô nisso... ⏳',
'Lendo o contexto dela... ⏳',
'Tô vendo aqui, já volto... ⏳',

MENSAGENS_ESPERA_PERFIL:
'Analisando o perfil dela... ⏳',
'Vendo o que tem aqui pra trabalhar... ⏳',
'Lendo o vibe dela pela foto... ⏳',
'Deixa eu ver o que ela tá revelando aqui... ⏳',
```

---

## 21. followupMessages.js — Mensagens proativas do worker

```js
day1_inactive:
"Tem alguma conversa rolando? Manda o print ou descreve a situação — leio o contexto e te dou as opções."
"E aí, apareceu. Alguma conversa pra resolver? Manda aqui."
"Tô por aqui. Se tiver alguma conversa travada ou situação pra entender, manda."

limit_drop_3 (trial→free):
"A partir de hoje são 3 análises por dia.\n\nSe quiser mais: *mensal* (R$29,90) ou *anual* (R$299)."
"Mudou pra 3 análises por dia. Usa nas situações que realmente precisam.\n\nQuer ilimitado? *mensal* (R$29,90) ou *anual* (R$299)."

limit_exhausted_3 (bloqueio proativo):
"Deu 3 por hoje. Amanhã tem mais 3.\n\nSe a conversa tá no ponto e não dá pra esperar: *mensal* (R$29,90) ou *anual* (R$299)."
"Por hoje acabou. Renova amanhã.\n\nQuer ilimitado? *mensal* (R$29,90) ou *anual* (R$299)."
"3 por hoje, acabou. Se precisar continuar agora: *mensal* (R$29,90) ou *anual* (R$299)."

predate_reminder_day_before:
"Amanhã é o encontro 🗓️\n\nConfirma o local no Maps, define a roupa hoje à noite (casual-arrumado), barba e perfume sutil.\n\nSai com 15 min de folga, chega 5 min antes — não 30 min. Você tá pronto 💪\n\n_Manda PARAR se não quiser mais lembretes._"

predate_reminder_2h_before:
"Daqui a pouco é o encontro 👊\n\nSem pressa — sai com calma, chega 5 min antes. Guarda o celular quando ela chegar, foca nela.\n\nVai bem."

predate_debrief:
"E aí, como foi o encontro? Me conta — pode ser curto 👇"

transition_coach_outcome:
"Ei, lembra que te ajudei a chamar ela pra sair semana passada?\n\nComo foi? Ela topou? Me conta aqui — pode ser curto, só quero saber o resultado 👇"
```

---

## 22. SYSTEM_PROMPT (main, ~145 linhas, índice 230–374)

Sistema completo: Leitura de sinais, exemplos, 3 opções (🔥😏⚡), formato de saída.
Ver arquivo `index.js` linhas 230–374 para texto completo.

**Problemas identificados:**
- "A mulher brasileira não lê o texto — ela lê a energia" → framing de pickup/RSD
- "=== O QUE VOCÊ SABE QUE OS OUTROS NÃO SABEM ===" → linguagem de guru
- Cenários voltados a home 20-something, não ao ICP de 32-45 voltando pro mercado
- Ausência explícita do mecanismo "Leitura de Intenção"

---

## 23. SYSTEM_PROMPT_DEGRADED (~linha 376)

Versão compacta para intent `volume`. Boa estrutura, tom levemente pickup nas regras.

---

## 24. SYSTEM_PROMPT_MINIMAL (~linha 402)

Ultra-curto para `one_liner`. Exemplos bons, sem issues maiores.

---

## 25. SYSTEM_PROMPT_OUSADIA (~linha 418)

Flerte e duplo sentido. "Adulto não precisa ser vulgar" — bom princípio.
Leve framing de jogo ("deixa ela com a próxima jogada") mas aceitável para o contexto.

---

## 26. SYSTEM_PROMPT_COACH (~linha 445)

Estratégia/reconquista. Problemas:
- "Presença segura atrai, necessidade repele" → linguagem de pickup
- No-contact 14-21 dias rígido → dogma, não realidade
- "Indiferença calculada" → alfa-toxic
- Escuta ativa e honestidade brutal ausentes
- Não cobre bem o contexto de 32-45 com filhos, pós-separação

---

## 27. CLASSIFIER_PROMPT (~linha 527)

Classifica intents: `one_liner`, `volume`, `premium`, `coaching`, `ousadia`.
Regras claras, sem issues de persona. Manter estrutura.
