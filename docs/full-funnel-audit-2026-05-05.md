# AUDITORIA COMPLETA DO FUNIL — MandaAssim
**Data:** 2026-05-05  
**Auditor:** Claude Sonnet 4.6 (Anthropic)  
**Escopo:** Repositório completo em `C:\Users\Rafae\mandaassim-bot`  
**Versão do código:** branch `main`, commit `c35fc52`

---

# SEÇÃO 1 — MAPA VISUAL DA JORNADA COMPLETA

## 1.1 Canais de Entrada

```
[Entrada Direta WhatsApp]
  └─ Usuário abre chat com o número do bot e manda qualquer coisa

[Slug de Aquisição]
  └─ Usuário manda uma mensagem contendo um slug (ex: "mandaassim_instagram_reel_001")
  └─ parseAcquisitionSlug() detecta, saveAttribution() salva canal de origem
  └─ Só funciona na PRIMEIRA mensagem (usuários existentes: slug ignorado)

[Promoção em aberto — sem canais explícitos no código]
  └─ Não há integração com landing page, bio do Instagram ou link de redirecionamento
     rastreável além do slug manual
```

## 1.2 Fluxo Completo Desde o Primeiro Contato

```
MOMENTO 0 — Primeiro contato (isNewUser = true)
│
├─ BOT ENVIA (sequência de 3 mensagens, sempre):
│   [msg 0] "Boa, você chegou.\n\nAqui é o MandaAssim. Eu leio o que ela quis dizer
│            antes de sugerir o que responder. Não é técnica de pegação, não é coach.
│            É leitura de situação.\n\nFunciona simples: você manda o print da conversa
│            ou descreve o que tá rolando. Eu olho o contexto dela e te devolvo 3 opções
│            de resposta prontas — você escolhe a que mais combina com você e copia.\n\n
│            *3 dias ilimitados. Sem cartão.*"
│
│   [msg 1] SE ENABLE_ACT_01_HOOK_DIAGNOSTICO=true:
│           → Mensagem do Ato 1 (diagnóstico de persona 1-4)
│           SE flag OFF:
│           → "Antes da gente começar — em qual desses momentos você tá?
│              1️⃣ Voltei pro mercado depois de muito tempo fora (separação, divórcio)
│              2️⃣ Tô nos apps já faz tempo, mas as conversas não engrenam
│              3️⃣ Tenho uma conversa rolando agora e cada mensagem importa
│              4️⃣ Outro
│              Manda o número. Ou descreve do seu jeito. Ou já cola o print direto que eu leio."
│
│   [msg 2] "Manda o print da conversa ou descreve a situação. Eu leio e te devolvo as opções."
│
├─ Agenda: scheduleInactiveFollowup() → follow-up em H+27 (±45min jitter) se inativo
├─ Log: evento 'signup' no journey_events
└─ BOT AGUARDA próxima mensagem

DIAS 0-2 (TRIAL ATIVO — ilimitado):
│
├─ A cada mensagem do user:
│   ├─ Rate limit: 4s entre mensagens (silencioso)
│   ├─ Limit check: trial → ilimitado → passa sempre
│   ├─ Na 1ª mensagem do dia:
│   │   ├─ Se trial.isLastDay (D+2): aviso "Hoje é o último dia ilimitado. A partir de amanhã: 3/dia."
│   │   └─ Se trial.lastHours (< 2h): aviso "O acesso ilimitado fecha em menos de 2h."
│   │   Demais dias: aviso informativo "Você ainda tem N dia(s) ilimitados."
│   │
│   ├─ PROCESSAMENTO NORMAL (detalhado na Seção 3)
│   │
│   ├─ Após resposta principal:
│   │   ├─ contadorRestante() → mostra "N/3 — última análise de hoje" (não se aplica no trial)
│   │   ├─ upsellPicoPremium() → no isLastDay + 3+ msgs: oferta "Hoje é seu último dia ilimitado..."
│   │   ├─ Ato 12 (fire-and-forget): se trialHoursLeft < 0.5h → mensagem de última chamada
│   │   └─ tryReactiveNarrative() → avalia atos narrativos 2-11 elegíveis (se flags ativas)
│   │
│   └─ Atos Narrativos disparados reativamente (se flags ativas):
│       ├─ Ato 2: logo após resposta ao Ato 1 (persona selecionada, ≤ 30min)
│       ├─ Ato 3: sufixo na PRIMEIRA análise feita pelo usuário (inline)
│       ├─ Ato 4: após ≥ 3 interações + ≥ 2h de conta (only_once)
│       └─ Ato 5: após ≥ 5 interações + ≥ 12h de conta (only_once, A/B 50/50)

H+72 — FIM DO TRIAL:
│
├─ getTrialInfo(): inTrial → false, planKey → 'free'
├─ Lazy update no banco: plan='trial' → plan='free' (trigger_ended_at salvo)
├─ Ato 12 (última chamada): disparado nos últimos 30min (H+71.5 a H+72)
│   → Mensagem do act_12_ultima_chamada.md (multi-bloco):
│     "30 minutos." / "Em meia hora seu trial fecha..."
│     "Pra continuar: mensal / anual / pro"
│     "Sem decisão, cai no Free."
│     "quem você era 72h atrás não sabia ler a conversa..."
├─ Cron verificarExpiracoes(): detecta plan='trial' vencidos → loga 'trial_ended'
└─ Worker proativo DESLIGADO por default (PROACTIVE_MESSAGES_ENABLED=false)
   → Nenhuma mensagem automática enviada no exato momento H+72

FREE (D+1 em diante — pós-trial sem upgrade):
│
├─ Limite: 3 análises/dia (canUseFeature 'messages')
├─ Na 1ª mensagem de cada dia: scheduleLimitDrop3() agendado (H+1 ±30min)
│
├─ Ao esgotar as 3:
│   ├─ scheduleLimitExhausted3() (5min ±3min)
│   ├─ Se ex-pagante na janela win-back (2-15d após expirar): oferta "voltar" R$19,90
│   ├─ Se conversa "quente" (última request < 5min): mensagem urgência contextual
│   └─ Caso geral: limitCheck.upsellMessage ou LIMITE_FREE_ESGOTADO
│       "Deu 3 por hoje. Amanhã cedo renova. Se não dá pra esperar: mensal (R$29,90) ou anual (R$299)."
│
├─ Atos narrativos no free (se flags ativas):
│   ├─ Ato 7 (free friction): mensagem de limite com variante A/B
│   ├─ Ato 9 (sumário): na 1ª msg após ≥ 60h de conta (só trial/free)
│   ├─ Ato 10 (oferta): após Ato 9 + ≥ 66h de conta (só trial/free)
│   ├─ Ato 11 (objeção): ≥ 2h após Ato 10 (só trial/free)
│   └─ Ato 13 (re-oferta D+1): após trial terminar + ≥ 24h + bater qualquer limite
│
└─ Follow-ups (workers proativos — desligados por default):
    ├─ day1_inactive (H+27): "Tem alguma conversa rolando? Manda o print ou descreve."
    ├─ limit_drop_3 (H+1): "A partir de hoje são 3 análises por dia."
    └─ limit_exhausted_3 (5min): "Deu 3 por hoje. Amanhã tem mais 3."

PARCEIRO (R$29,90/mês — pago):
│
├─ Após pagamento confirmado via Webhook MP:
│   Sequência CONFIRMACAO_PARCEIRO (4 mensagens):
│   "✅ Parceiro ativado"
│   "A partir de agora você tem: • Resposta sem limite • Análise de conversa sem limite • Conversar comigo — sem limite"
│   "Sem teto diário, sem travamento."
│   "Manda o próximo print, ou me conta a próxima situação."
│
├─ Análise de prints: 5/dia (printLimits.js) | print_analysis feature: 5/dia
├─ Mensagens textos: ilimitadas
├─ Transition Coach: 2 sessões/mês
├─ Pre-Date Coach: BLOQUEADO (Pro exclusivo)
├─ Profile Analysis (dela): BLOQUEADO
├─ Profile Self-Audit: BLOQUEADO
│
├─ Aviso de renovação 3 dias antes: cron 6h
│   "Seu acesso ilimitado vence em *3 dias*. Se quiser renovar antes: *mensal* ou *anual*."
│
└─ Grace period: 3 dias após expirar mantém acesso

PARCEIRO PRO (R$79,90/mês — pago):
│
├─ Após pagamento confirmado:
│   Sequência CONFIRMACAO_PRO (8 mensagens):
│   "🚀 Parceiro Pro liberado"
│   "Tudo do Parceiro continua valendo. E entram mais quatro coisas:"
│   "✓ Olhar seu perfil — ..."
│   "✓ Analisar o perfil dela — ..."
│   "✓ Antes do encontro — ..."
│   "✓ Depois do encontro — ..."
│   "Esse é o pacote do começo ao fim — antes do match até o pós-encontro."
│   "Pra gente começar: manda print do seu próprio perfil."
│
├─ Todas as features desbloqueadas:
│   ├─ Análise prints: 5/dia
│   ├─ Profile analysis (dela): 10/dia (features.js) / 30/dia (profileLimits.js) — INCONSISTÊNCIA
│   ├─ Profile self-audit: 30/dia
│   ├─ Profile her analysis: 30/dia
│   ├─ Transition Coach: ilimitado
│   ├─ Pre-Date Coach: ilimitado
│   ├─ Post-Date Debrief: ilimitado
│   └─ Mindset Capsules: opt-in disponível após 14 dias Pro
│
└─ Após 14 dias Pro: convite MINDSET_INVITE_MESSAGE (uma vez)
```

## 1.3 Onde Cada Ato Narrativo Se Encaixa

| Ato | Trigger | Timing | Audience | Flag |
|-----|---------|--------|----------|------|
| Ato 1 | Signup (boas-vindas) | H+0 | Todos | ENABLE_ACT_01_HOOK_DIAGNOSTICO |
| Ato 2 | Resposta ao Ato 1 (persona 1-4) | H+0 a H+0.5 | Todos | ENABLE_ACT_02_PROMESSA_MECANISMO |
| Ato 2.5 | Fim diagnóstico (3 respostas ao Ato 2) | H+0 a H+1 | Todos | ENABLE_ACT_1 (usa act_1) |
| Ato 3 | Primeira análise entregue | H+0 a H+72 | Todos | ENABLE_ACT_03 |
| Ato 4 | ≥3 interações + ≥2h | H+2 a H+72 | Todos | ENABLE_ACT_04_REVEAL_PAPO |
| Ato 5 | ≥5 interações + ≥12h | H+12 a H+72 | Todos | ENABLE_ACT_05_IDENTIFICACAO_AMPLIFICADA |
| Ato 6 | ≥2 prints + ≥24h (não Pro) | H+24 a H+72 | Trial/Free | ENABLE_ACT_06_REVEAL_AUDIT |
| Ato 7 | Free bate limite diário | Qualquer dia | Free | ENABLE_ACT_7 |
| Ato 8 | encontro mencionado OU ≥36h | H+36 a H+72 | Trial/Free não-Pro | ENABLE_ACT_08_REVEAL_PREDATE |
| Ato 9 | ≥60h de conta | H+60 | Trial/Free | ENABLE_ACT_09_SUMARIO_USO |
| Ato 10 | Ato 9 enviado + ≥66h | H+66 | Trial/Free | ENABLE_ACT_10_OFERTA |
| Ato 11 | ≥2h após Ato 10 (ou link clicado ≥60min) | H+68+ | Trial/Free | ENABLE_ACT_11_OBJECAO_GARANTIA |
| Ato 12 | H+71.5 a H+72 (últimos 30min) | H+71.5-72 | Trial | ENABLE_ACT_12_ULTIMA_CHAMADA |
| Ato 13 | Free + ≥24h pós-trial + bate limite | D+1 free | Free | ENABLE_ACT_13_REOFERTA_D1 |

## 1.4 Fluxo de Pagamento Completo

```
User digita "mensal" / "anual" / "pro" / "24h"
   │
   ├─ enviarCobrancaPix() / enviarCobrancaPixPro()
   │   ├─ criarCobrancaPix(phone, amount) → insere em payments (status=pending)
   │   ├─ Cria cobrança no MP
   │   └─ BOT ENVIA:
   │       1. Texto explicativo + nome do responsável (Rafael Cabral Ibraim)
   │       2. QR Code como imagem PNG
   │       3. Código Pix para copiar
   │       4. "_Confirmação chega em menos de 1 minuto. Se demorar: digita *paguei*_"
   │
User paga o Pix
   │
   ├─ MP envia POST /webhook/mercadopago
   ├─ Valida assinatura HMAC
   ├─ Busca detalhes do payment no MP
   ├─ determinarPlano(amount):
   │   ├─ ≤R$9,99 → parceiro, 1 dia (24h)
   │   ├─ ≈R$79,90 (±R$2) → parceiro_pro, 30 dias
   │   ├─ ≥R$100 → parceiro, 365 dias (anual)
   │   └─ Demais → parceiro, 30 dias (mensal)
   ├─ Lock otimista: atualiza payments SET status='approved' WHERE status='pending'
   ├─ Acumula expiração (soma ao vencimento atual se já tinha plano ativo)
   ├─ Atualiza users: plan, plan_expires_at, renewal_notified=false
   └─ Envia sequência de boas-vindas via WhatsApp (CONFIRMACAO_*)

User digita "paguei" (poll manual):
   ├─ Rate limit: 1/minuto por phone
   ├─ Verifica se já tem plano ativo (retorna "✅ Parceiro ativo")
   ├─ Busca pagamento mais recente
   ├─ Se pending + tem mp_payment_id: consulta MP diretamente
   └─ Ativa plano se aprovado, ou responde "ainda processando"
```

---

# SEÇÃO 2 — CATÁLOGO COMPLETO DE COPIES

## 2.1 Boas-Vindas (Trial)

### WELCOME_MSG_0
**Arquivo:** `index.js:158`  
**Trigger:** Novo usuário (isNewUser=true)  
**Público:** Todos os novos  
```
Boa, você chegou.

Aqui é o MandaAssim. Eu leio o que ela quis dizer antes de sugerir o que responder. Não é técnica de pegação, não é coach. É leitura de situação.

Funciona simples: você manda o print da conversa ou descreve o que tá rolando. Eu olho o contexto dela e te devolvo 3 opções de resposta prontas — você escolhe a que mais combina com você e copia.

*3 dias ilimitados. Sem cartão.*
```

### WELCOME_MSG_1 (padrão, sem Ato 1)
**Arquivo:** `index.js:159`  
**Trigger:** Novo usuário, ENABLE_ACT_01_HOOK_DIAGNOSTICO=false  
```
Antes da gente começar — em qual desses momentos você tá?

1️⃣ Voltei pro mercado depois de muito tempo fora (separação, divórcio)
2️⃣ Tô nos apps já faz tempo, mas as conversas não engrenam
3️⃣ Tenho uma conversa rolando agora e cada mensagem importa
4️⃣ Outro

Manda o número. Ou descreve do seu jeito. Ou já cola o print direto que eu leio.
```

### WELCOME_MSG_1 (Ato 1 ativo)
**Arquivo:** `src/narrative/acts/act_1_welcome_diagnosis.js`  
**Trigger:** Novo usuário, ENABLE_ACT_1=true  
```
Antes de te explicar o que faço — me conta em qual momento você tá:

1️⃣ Voltei pro mercado depois de muito tempo fora
2️⃣ Tô nos apps mas não tô conseguindo evoluir as conversas
3️⃣ Tô conversando com alguém agora e quero não cagar
4️⃣ Outro

Manda o número.
```
**Nota:** Este .js existe mas a narrativeInline.js aponta para o ato do .md de acts.js. Existem duas implementações paralelas do Ato 1.

### WELCOME_MSG_2
**Arquivo:** `index.js:161`  
**Trigger:** Sempre (3ª msg de boas-vindas)  
```
Manda o print da conversa ou descreve a situação. Eu leio e te devolvo as opções.
```

## 2.2 Ato 1 (Hook + Diagnóstico) — do .md
**Arquivo:** `docs/narrative/acts/act_01_hook_diagnostico.md`  
**Trigger:** Signup, quando ENABLE_ACT_01_HOOK_DIAGNOSTICO=true  
**Enviado como:** 3 mensagens (separadas por `---`)  
```
[msg 1] Antes de te explicar como funciono, me responde uma coisa.

[msg 2] Aqui vai do primeiro oi até o encontro real — análise de conversa, perfil, quando chamar pra sair, preparação pro encontro, como foi depois.

[msg 3] Em qual desses momentos você tá?

1️⃣ Voltando pro mercado depois de muito tempo casado
2️⃣ Solteiro há um tempão, nos apps, mas nada decola
3️⃣ Numa conversa específica agora — e cada mensagem importa
4️⃣ Outro

---

[msg 4] Só o número.
```

## 2.3 Atos 2-13 (Narrativa Progressiva)

### Ato 2 — Promessa + Mecanismo (Variante Persona 1 — voltou pro mercado)
**Arquivo:** `docs/narrative/acts/act_02_promessa_mecanismo_op1.md`  
```
[msg 1] Quem volta pro mercado depois de muito tempo casado descobre uma coisa rápido: o jogo mudou.
Não é só o app — é o jeito de falar, o tempo de resposta, o que ela quer ler na primeira mensagem, o que mata a conversa em 30 segundos.
A maioria dos caras nessa situação não tá perdendo por causa da idade, do físico ou do salário. Tá perdendo porque manda o que parece certo, mas ela lê outra coisa.

[msg 2] Por isso eu não te dou roteiro pronto.
Eu leio o que ela quis dizer — antes de te sugerir o que responder.
*O ChatGPT chuta. Eu decifro.*

[msg 3] Manda o próximo print. A gente lê junto.
```
**Variantes:** op1 (voltou), op2 (nos apps), op3 (conversa ativa), op4 (outro)  
[PENDENTE: copies de op2, op3, op4 não foram lidas — requerem verificação]

### Ato 3 — Template da Primeira Análise
**Arquivo:** `docs/narrative/acts/act_03_first_analysis_template.md`  
**ALERTA:** Este arquivo contém placeholders literais que NÃO são substituídos dinamicamente. Ele é documentação do template, não copy real enviada ao usuário. O sufixo real está em `src/narrative/acts/act_3_first_analysis.js`.

**Sufixo real (act_3_first_analysis.js):**  
[PENDENTE: arquivo não lido completamente — verificar src/narrative/acts/act_3_first_analysis.js]

### Ato 4 — Revela "Conversar sobre o que tá rolando"
**Arquivo:** `docs/narrative/acts/act_04_reveal_papo.md`  
Enviado em 4 blocos:
```
[1] Metade do problema com mulher não é o que mandar.

[2] É a hora em que ela some por 2 dias e você não sabe se foi alguma coisa que você falou, se ela perdeu o interesse, ou se ela só tá ocupada.
É a hora em que ela manda "kk" e você fica olhando pra tela tentando entender se aquilo é boa onda ou desinteresse.
É a hora em que rolou um beijo e a próxima mensagem não pode soar carente, mas também não pode soar fria.

[3] Pra essas horas, me chama.
*Conversar comigo* tá liberado pra você.
Me conta a situação — em texto, sem precisar de print — e a gente lê junto.

[4] Sem autoajuda, sem guru, sem terapeuta
Sem coach que cobra R$300 pra sessão
*Direto. Como amigo mais velho que já passou por isso.*
Tô aqui pra isso também.
```

### Ato 5 — Identificação Amplificada (Variant A)
**Arquivo:** `docs/narrative/acts/act_05_identificacao_amplificada.md`  
**Placeholder:** `[N]` = número de interações do usuário  
```
[1] Tem uma diferença entre o cara que consegue evoluir conversa e o cara que não consegue.

[2] Não é dinheiro, não é físico, não é idade.
É o que ele faz nos *30 segundos* depois dela mandar "kk".
Esses 30 segundos definem se a próxima mensagem entra com peso ou se a conversa morre ali.
E a maioria dos caras manda exatamente o tipo de mensagem que mata.

[3] Eu sei o que mata e o que mantém. É pra isso que eu tô aqui.

[4] Você já trouxe *[N]* situações comigo essas últimas horas.
*Pergunta honesta:*
_Quantas dessas você teria mandado errado sem eu ler a intenção primeiro?_

[5] Manda o último "kk" que você recebeu. Vou te mostrar o que mudaria.
```

### Ato 5 — Variant B
**Arquivo:** `docs/narrative/variants/act_05_variant_b.md`  
**Placeholder:** `[N]` = número de interações  
```
[1] Tem um cara — vamos chamar de João — que tem 39 anos, divorciado há dois, mora em São Paulo.
João não é o mais bonito, não é o mais alto, não ganha 30 mil. Mas João tá saindo em três encontros por mês...

[2] João não tem nada que você não tem. Ele só sabe ler o que ela quer ler...

[3] Quando ela manda _"kk"_ — ele não chuta o tom. Ele lê.
Quando ela demora pra responder — ele não entra em espiral. Ele entende o cenário.
Quando ela troca o tom — ele percebe antes de mandar a mensagem errada.

[4] Você já trouxe *[N]* situações comigo nessas horas.
Cada uma dessas, eu li a intenção antes de te dar resposta.
*Você tá fazendo o que o João faz. Sem perceber.*
Bora continuar.
```

### Ato 6 — Revela Auditoria de Perfil Próprio (Variant A)
**Arquivo:** `docs/narrative/acts/act_06_reveal_audit.md`  
```
[1] Vou ser sincero com você.
[2] Tô te ajudando a responder mensagem. Mas e se o problema não tiver na resposta?
[3] Antes de você abrir a boca, ela já viu uma coisa: seu perfil. As fotos, a bio, a ordem das fotos...
[4] Eu olho seu perfil foto por foto, leio sua bio, vejo a ordem, e te falo na lata o que tira match e o que ajuda.
[5] Coisa que amigo nenhum faz contigo de verdade. Eu faço.
[6] Tá no Pro. Quer ver? Manda print do seu perfil aí. Digita *pro* pra liberar 👇
```

### Ato 6 — Variant B
**Arquivo:** `docs/narrative/variants/act_06_variant_b.md`  
```
Em apps de paquera, você tem 1 segundo pra prender atenção.
Não 10. Não 5. *Um.*
[...] Manda print do seu perfil. Vou te dizer qual foto tá funcionando como primeira — ou pior, escolheu errado e nem percebeu.
```

### Ato 7 — Livre Friction (Free Limit)
**Arquivo:** `src/narrative/acts/act_7_free_friction.js`  
[PENDENTE: arquivo não lido — verificar conteúdo real das variantes A/B]

### Ato 8 — Revela Coach Pré/Pós Encontro
**Arquivo:** `docs/narrative/acts/act_08_reveal_predate.md`  
```
[1] Tem mais uma coisa que talvez você vá precisar em breve.
[2] Quando der certo — ela aceitar sair com você — pode bater um nervosismo...
[3] Pra essa hora, você me avisa o quê, onde, quando. Eu te ajudo a preparar:
✓ Roupa pro lugar / ✓ O que conversar / ✓ O que evitar / ✓ Como encerrar em alta
[4] E quando voltar do encontro, a gente conversa sobre como foi.
[5] Tá tudo no Pro. Quando chegar o momento, me chama.
```

### Ato 9 — Sumário de Uso
**Arquivo:** `docs/narrative/acts/act_09_sumario_uso.md`  
**Placeholders:** `[N_INTERACTIONS]`, `[N_PRINTS]`, `[N_PAPO]`, `[IF_PRO_BLOCK]`  
```
Olha só o que rolou nessas ~60h:
✓ *[N_INTERACTIONS]* situações analisadas
✓ *[N_PRINTS]* prints de conversa decifrados antes de você responder
✓ *[N_PAPO]* vezes que você trouxe uma dúvida e eu te falei na lata o que fazer
[IF_PRO_BLOCK] (só pro Pro — audits + analyses)
Você tá usando o que era pra usar.
[Benchmark: R$50-300/análise com humano; R$300-800/sessão coach]
Faltam ~12h pro trial acabar. Em breve te mostro como continuar tendo isso.
```

### Ato 10 — A Oferta (Variant A)
**Arquivo:** `docs/narrative/acts/act_10_oferta.md`  
```
Bora falar de continuar.
A partir de amanhã você tem três caminhos...
🚫 Free: 3 análises por dia
✅ Parceiro (R$29,90/mês): sem limite
🚀 Pro (R$79,90/mês): tudo + perfil + predate + debrief
[Benchmark: coach sério R$300-800/sessão; equivale a R$2,66/dia]
Pra escolher: *mensal*, *anual* ou *pro*
_PS: você já provou que funciona nessas 70 horas..._
```

### Ato 10 — Variant B
**Arquivo:** `docs/narrative/variants/act_10_variant_b.md`  
(Variante mais story-first, mantém os mesmos preços e CTAs)

### Ato 11 — Quebra de Objeções + Garantia
**Arquivo:** `docs/narrative/acts/act_11_objecao_garantia.md`  
Responde: "E se não funcionar?" / "E se cancelar?" / "ChatGPT já faz isso?" / "R$79,90 é caro"  
```
_"E se eu cancelar?"_ → Cancela na hora, digita *cancelar*. Prefiro perder cliente bem do que segurar à força.
_"E se o ChatGPT já faz isso?"_ → Faz alguma coisa parecida. Mas eu tenho contexto da sua situação...
_"R$ 79,90 é caro"_ → R$29,90 é R$1 por dia. [...] *O risco é R$ 0.*
```

### Ato 12 — Última Chamada
**Arquivo:** `docs/narrative/acts/act_12_ultima_chamada.md`  
```
*30 minutos.*
Em meia hora seu trial fecha e você volta pras 3 análises por dia.
Pra continuar: *mensal* (R$29,90) / *anual* (R$299) / *pro* (R$79,90)
Sem decisão, cai no Free. Tudo bem também.
_PS: quem você era 72h atrás não sabia ler a conversa antes de responder..._
```

### Ato 13 — Re-oferta D+1 Free
**Arquivo:** `docs/narrative/acts/act_13_reoferta_d1.md`  
```
E aí.
Você bateu o limite de hoje — e a sensação de _"queria mandar mais um print agora"_ é exatamente a hora em que o Parceiro faz diferença.
R$29,90/mês. Sem limite. Cancela quando quiser.
Pra ativar: digita *mensal*
```

## 2.4 Comandos de Navegação

### Resposta a saudação pura (oi, olá, hey, etc.)
**Arquivo:** `index.js:2819`  
```
Manda o print ou descreve o que tá rolando — eu leio e gero as opções.
```

### Resposta a texto longo (>2000 chars)
**Arquivo:** `index.js:2031`  
```
Tá longo demais. Resume o essencial em até 2000 caracteres e manda de novo.
```

### Resposta a tipo de mídia não suportado
**Arquivo:** `index.js:3634`  
```
Manda o *texto*, um *print* ou um *áudio* — eu analiso e gero as opções.
```

### Resposta a imagem ambígua (conversa ou perfil?)
**Arquivo:** `index.js:3235`  
```
Isso é uma *conversa* ou o *perfil* dela? Me fala pra eu analisar certo 📱

_Responde: "conversa" ou "perfil"_
```

### Resposta a perfil ambíguo (meu ou dela?)
**Arquivo:** `index.js:3256`  
```
Esse perfil é *teu* ou *dela*?

_Responde: "meu" ou "dela"_
```

### Pedido de outra/mais (sem contexto)
**Arquivo:** `index.js:3017`  
```
Me manda a situação primeiro, aí eu gero as variações.
```

### Ajuste de tom (sem contexto)
**Arquivo:** `index.js:3042`  
```
Me conta a situação primeiro, aí eu refaço no tom que quiser 😉
```

### Mensagens de espera (análise de texto)
**Arquivo:** `index.js:1420-1431`  
Pool aleatório de 10 variações: "Lendo o contexto... ⏳", "Deixa eu ver o que tá rolando aqui... ⏳", "Analisando ela... ⏳", etc.

### Mensagens de espera (análise de perfil)
```
"Analisando o perfil dela... ⏳" / "Vendo o que tem aqui pra trabalhar... ⏳" / etc.
```

### Mensagens de espera (áudio)
```
"Ouvindo o áudio... ⏳" / "Processando o que ela disse... ⏳" / etc.
```

## 2.5 Geração de Pix

### Mensagem pré-QR (Parceiro mensal/anual)
**Arquivo:** `index.js:1911`  
```
Gerado 👇

_O Pix aparece no nome *Rafael Cabral Ibraim* — é o responsável pelo MandaAssim. Pode pagar tranquilo ✅_
```
Seguida do QR Code (imagem PNG) + código Pix em texto + instrução paguei.

### Mensagem pré-QR (Parceiro Pro)
**Arquivo:** `index.js:1884-1891`  
```
*Parceiro Pro — R$79,90/mês*

O que entra:
• Mensagens ilimitadas
• Análise de conversa (sem limite)
• Analisar o perfil dela (30/dia)
• Olhar e revisar seu perfil (30/dia)

O Pix aparece no nome *Rafael Cabral Ibraim* — é o responsável pelo MandaAssim. Pode pagar tranquilo ✅
```

### Após QR (sempre)
```
_Confirmação chega em menos de 1 minuto. Se demorar: digita *paguei*_
```

### Erro na geração do Pix
```
Deu um problema na hora de gerar o Pix 😕 Tenta de novo daqui a pouco.
```

## 2.6 Confirmações de Pagamento

### CONFIRMACAO_PARCEIRO (4 msgs)
**Arquivo:** `src/webhook.js:57`  
```
[1] ✅ *Parceiro ativado*
[2] A partir de agora você tem:
• Resposta de mensagem — sem limite
• Análise de conversa inteira — sem limite
• Conversar comigo sobre o que tá rolando — sem limite
[3] Sem teto diário, sem travamento. Toda vez que precisar, é só me chamar.
[4] Manda o próximo print, ou me conta a próxima situação.
```

### CONFIRMACAO_PRO (8 msgs)
**Arquivo:** `src/webhook.js:64`  
```
[1] 🚀 *Parceiro Pro liberado*
[2] Tudo do Parceiro continua valendo. E entram mais quatro coisas:
[3] ✓ *Olhar seu perfil* — você manda print do seu Tinder/Bumble e eu te falo, foto por foto, o que tá funcionando, o que tira match e o que trocar
[4] ✓ *Analisar o perfil dela* — você manda print do perfil de quem deu match e eu monto a primeira mensagem com base no que ela mostra ali (não aquele "oi tudo bem")
[5] ✓ *Antes do encontro* — quando você marcar um date, me avisa. Eu te ajudo com roupa, papo, o que evitar e como sair em alta
[6] ✓ *Depois do encontro* — me conta como foi e eu leio os sinais que talvez você não tenha visto, e a gente decide o próximo passo
[7] Esse é o pacote do começo ao fim — antes do match até o pós-encontro.
[8] Pra gente começar: manda print do seu próprio perfil. Quero ver como ele tá te vendendo no app.
```

### CONFIRMACAO_UPGRADE_PRO (5 msgs)
**Arquivo:** `src/webhook.js:75`  
```
[1] 🚀 *Agora você tá no Pro*
[2] Tudo que você já usava continua. E mais:
[3] ✓ Olhar seu perfil / ✓ Analisar o perfil dela / ✓ Preparar o encontro + conversar depois sobre como foi
[4] Esse é o pacote do começo ao fim — antes do match até o pós-encontro.
[5] Manda print do seu próprio perfil aí. Vou começar te falando o que não tá funcionando.
```

### CONFIRMACAO_24H (2 msgs)
**Arquivo:** `src/webhook.js:83`  
```
[1] ✅ *24h ativadas*
[2] Acesso ilimitado pelas próximas 24 horas. Manda o que tiver rolando.
    _Se quiser continuar depois disso: digita *mensal* ou *anual*_
```

## 2.7 Avisos de Trial

### 1ª msg do dia, trial em andamento (dias normais)
**Arquivo:** `index.js:2416`  
```
Você ainda tem *N dia(s)* ilimitados. Manda o que tiver rolando.

_(Pra ver seu plano: digita *status*)_
```

### 1ª msg do dia, último dia de trial
**Arquivo:** `index.js:2409`  
```
Hoje é o último dia ilimitado.

A partir de amanhã: *3 análises por dia*.

Se quiser continuar sem limite:
• *mensal* — R$29,90
• *anual* — R$299
```

### 1ª msg, últimas 2h do trial
**Arquivo:** `index.js:2404`  
```
O acesso ilimitado fecha em menos de *2h*.

Pra continuar:
• *mensal* — R$29,90
• *anual* — R$299
```

### Upsell no pico emocional (isLastDay + ≥3 msgs)
**Arquivo:** `index.js:1844`  
```
Hoje é seu último dia ilimitado. Tem três jeitos de continuar:

⚡ *24h* por R$4,99 → digita *24h*
📅 *Mensal* a R$29,90/mês → digita *mensal*
📆 *Anual* a R$299/ano (economiza R$60) → digita *anual*
```

### Upsell nas últimas 2h + ≥1 msg
**Arquivo:** `index.js:1853`  
```
Fecha em menos de *2h*. Se quiser continuar:

⚡ *24h* por R$4,99 → digita *24h*
📅 *Mensal* a R$29,90/mês → digita *mensal*
📆 *Anual* a R$299/ano (economiza R$60) → digita *anual*
```

### Aviso de renovação (3 dias antes de vencer)
**Arquivo:** `index.js:152`  
```
Seu acesso ilimitado vence em *3 dias*.

Se quiser renovar antes: *mensal* ou *anual*.
```

## 2.8 Limites e Upsells

### Limite Free esgotado (mensagens) — genérico
**Arquivo:** `index.js:169`  
```
Deu 3 por hoje. Amanhã cedo renova.

Se não dá pra esperar: *mensal* (R$29,90) ou *anual* (R$299).
```

### Limite Free + conversa quente
**Arquivo:** `index.js:2388`  
```
Bateu o limite de hoje — e logo agora que a conversa tá rolando.

Se não dá pra esperar amanhã:
• *mensal* — R$29,90
• *anual* — R$299
```

### Contador restante free (última análise do dia)
**Arquivo:** `index.js:1862`  
```
Essa foi a última de hoje. Se não dá pra esperar amanhã:
• *mensal* — R$29,90
• *anual* — R$299
```

### Win-back (ex-premium, 2-15d após expirar)
**Arquivo:** `index.js:2383`  
```
Deu 3 por hoje. Como você já assinou antes, tem uma oferta de volta:

*voltar* — R$19,90 no primeiro mês
```

### Print upsell (free quer análise de print)
**Arquivo:** `index.js:177`  
```
Análise de print é do *Parceiro* 🔍

Você manda o print da conversa, eu leio o que tá rolando ali — interesse dela, temperatura, o que faz sentido responder agora.

Pra liberar:
⚡ *24h* — R$4,99 → *24h*
📅 *Mensal* — R$29,90 → *mensal*
📆 *Anual* — R$299 → *anual*
```

### Print limite atingido (Premium — 5/dia)
**Arquivo:** `index.js:184`  
```
Deu 5 análises de print hoje — o limite do plano.

Amanhã cedo renova. Enquanto isso, descreve em texto o que ela mandou — funciona igual.
```

### Print limite atingido (Trial — 1/dia)
**Arquivo:** `index.js:187`  
```
Deu 1 análise de print por hoje — limite do trial.

Quer ilimitado? *mensal* (R$29,90) ou *anual* (R$299).
```

### Profile upsell (não-Pro quer análise de perfil dela)
**Arquivo:** `index.js:190`  
```
Análise de Perfil é do *Parceiro Pro* (R$79,90/mês) 🔍

Você manda print do perfil dela. Eu leio o que tá ali — gosto, vibe, o que ela quer mostrar — e te entrego a primeira mensagem certa pra abrir conversa. Não aquele "oi tudo bem". Uma feita pra ela.

No Pro entra também:
• Análise de conversa (sem limite)
• Olhar o perfil dela (30/dia)
• Olhar seu próprio perfil (30/dia)
• Mensagens sem limite

Pra liberar: digita *pro*
```

### Profile limite atingido (Pro — 30/dia)
**Arquivo:** `index.js:200`  
```
Deu 30 análises de perfil hoje — o limite do plano.

Amanhã cedo renova.
```

### Transition Coach upsell (free)
**Arquivo:** `index.js:204`  
```
Tem um momento na conversa em que dá pra chamar pra sair — e tem um momento em que ainda não.

Mandar a mensagem certa nessa hora é o que separa conversa boa de encontro marcado.

Eu leio onde a conversa tá e te falo *quando* e *como* chamar.

Tá no *Parceiro* (R$29,90/mês) ou no *Anual* (R$299).

Pra liberar: digita *mensal* ou *anual*
```

### Transition Coach limite (Parceiro — 2/mês)
**Arquivo:** `index.js:212`  
```
Você já usou as 2 sessões de transição do mês.

Renova mês que vem — ou faz upgrade pro *Parceiro Pro*, que é sem limite. Pra ver: digita *pro*
```

### Predate upsell (não-Pro)
**Arquivo:** `index.js:218`  
```
Preparação pra encontro é do *Parceiro Pro* (R$79,90/mês) 🗓️

Você me conta quando, onde e o que tá te preocupando — eu te dou o plano: roupa, papo, o que evitar, como encerrar em alta.

E quando voltar do encontro, a gente conversa sobre como foi.

Digita *pro* 👇
```

### Postdate debrief upsell (não-Pro)
**Arquivo:** `index.js:228`  
```
Conversar sobre como foi o encontro é do *Parceiro Pro* (R$79,90/mês) 🔍

Você me conta o que rolou — eu leio o que aconteceu, o que ela sinalizou, onde você acertou, o que melhorar.

Sem rodeio. Honestidade total.

Digita *pro* 👇
```

## 2.9 Cancelamento

### Solicitação de motivo (cmd='cancelar')
**Arquivo:** `index.js:2249`  
```
Entendido. Antes de finalizar, me conta o motivo:

1️⃣ Preço
2️⃣ Não uso o suficiente
3️⃣ Não gostei dos resultados
4️⃣ Problema técnico
5️⃣ Outro[expiresMsg]

_Manda o número._
```

### Confirmação de cancelamento
**Arquivo:** `index.js:2281`  
```
Cancelamento registrado ✅[expiresMsg]

Se mudar de ideia: *mensal*, *anual* ou *pro*. Tô por aqui 👋
```

### Tentativa de cancelar sem plano ativo
**Arquivo:** `index.js:2240`  
```
Você tá no plano *free* — não há assinatura ativa pra cancelar.

Se quiser assinar:
• *mensal* — R$29,90
• *anual* — R$299
```

## 2.10 Mindset (Cápsulas Opt-In)

### Convite (após 14 dias Pro)
**Arquivo:** `index.js:237`  
```
Tenho um material extra que mando algumas vezes por semana de manhã.

Recados curtos: o que tá funcionando no mercado de paquera hoje, o que não tá, e como ler situação sem se enganar.

Não é autoajuda. É papo direto.

Quer receber? *sim* ou *não*
```

### Mindset ativado
**Arquivo:** `index.js:243`  
```
Ativado ✅

Vou mandar 3x por semana — segunda, quarta e sexta de manhã.

Pra mudar a frequência:
• *mindset 1x* — 1 por semana
• *mindset 3x* — 3 por semana (padrão)
• *mindset 5x* — dias úteis
• *mindset diário* — todo dia

Pra pausar: *cancelar mindset*
```

### Mindset recusado
**Arquivo:** `index.js:251`  
```
Tudo bem. Se quiser ativar depois: *ativar mindset*.
```

### Mindset status (cmd='mindset')
**Arquivo:** `index.js:2352`  
```
✅ *Mindset ativo* — [frequência] às [hora]h

Pra mudar: *mindset 1x*, *mindset 3x*, *mindset 5x* ou *mindset diário*
Pra pausar: *cancelar mindset*
```

## 2.11 Follow-ups (Automáticos)

### day1_inactive (H+27 ±45min)
**Arquivo:** `src/followup/followupMessages.js:5`  
Aleatório entre:
- `Tem alguma conversa rolando? Manda o print ou descreve a situação. Eu leio e te devolvo as opções.`
- `E aí, sumido. Alguma situação pra desenrolar? Manda aqui.`
- `Tô por aqui. Se trancar uma conversa ou bater dúvida, me chama.`

### limit_drop_3 (H+1 pós-trial, ±30min)
- `A partir de hoje são 3 análises por dia. Se quiser mais: *mensal* (R$29,90) ou *anual* (R$299).`
- `Trial encerrado. Agora são 3/dia. Usa nas situações que realmente precisam. Quer ilimitado? *mensal* (R$29,90) ou *anual* (R$299).`

### limit_exhausted_3 (5min após esgotar)
- `Deu 3 por hoje. Amanhã tem mais 3. Se não dá pra esperar: • *mensal* (R$29,90) ou *anual* (R$299).`
- `Por hoje, fechou. Renova amanhã. Quer ilimitado? *mensal* (R$29,90) ou *anual* (R$299).`
- `3 por hoje, encerrou. Se precisar agora: *mensal* (R$29,90) ou *anual* (R$299).`

### predate_reminder_day_before
- `Amanhã é o encontro 🗓️ Confirma o local hoje. Define a roupa à noite... Barba feita, perfume sutil. Chega 5 min antes, não 30. Tá tudo encaminhado. _Pra parar os lembretes: digita *parar*_`
- (Versão personalizada se houver assessment_result.day_before_tip)

### predate_reminder_2h_before
- `Daqui a pouco é o encontro. Sai com calma. Chega 5 min antes. Quando ela chegar, guarda o celular, foca nela. Vai bem.`
- `Chegando a hora. Guarda o celular quando ela aparecer, foca no momento. Vai nessa.`

### predate_debrief (10h após encontro)
- `E aí, como foi o encontro? Me conta — pode ser curto 👇`
- `Como foi? Ela foi bem, esfriou, rolou alguma coisa? Me conta.`

### transition_coach_outcome (7 dias após sessão)
**Arquivo:** `src/followup/followupMessages.js:48`  
```
Semana passada te ajudei a chamar ela pra sair. E aí, como foi? Ela topou? Me conta — pode ser curto 👇
```

## 2.12 Feedback de Outcome do Transition Coach

### accepted_and_happened
```
Foi bem. Boa pra você 👊
Se tiver outra conversa rolando, manda aqui.
```

### accepted_but_postponed
```
Tá crescendo. Segura a ansiedade quando ela confirmar a data — aparece normal.[hint predate se ativo]
```

### accepted_but_canceled
```
Acontece. Não comenta sobre o cancelamento. Age normal quando ela retomar contato.
```

### rejected
```
Tudo bem. Pelo menos você tentou. Se quiser entender o que pode ter influenciado, manda a conversa aqui.
```

### never_responded
```
Ainda sem resposta? Espera mais 5-7 dias antes do próximo contato. Se precisar de ajuda, manda.
```

### user_didnt_send
```
Ainda dá tempo. Se travar na hora de mandar, me conta o que tá segurando — eu ajusto a mensagem.
```

## 2.13 Status e Diagnóstico

### cmd='status' — Pro ativo
```
🔥 *Parceiro Pro* — mensagens ilimitadas + Análise de Perfil[validade ou grace warning]
```

### cmd='status' — Parceiro ativo
```
🌟 *Parceiro* — mensagens ilimitadas[validade ou grace warning]
```

### cmd='status' — Trial ativo
```
⏳ *Trial* — ilimitado por mais *N dia(s)* [ou "fecha em menos de 2h"]
_Usado hoje: N análise(s)_
```

### cmd='status' — Free
```
🆓 *Free* — N/3 hoje · N restante(s)
```

## 2.14 Perfil Dela (Contexto Salvo)

### Ver perfil (sem dados)
```
Ainda não tem perfil salvo 📋

Manda assim:
*ela se chama [nome]*
*ela é [descrição]*

Ex: _"ela é agitada, fica no zap o dia todo, já ficamos uma vez"_
```

### Nome salvo
```
Salvo ✅ Ela se chama *[nome]*.

Agora manda o print ou descreve o que aconteceu — vou usar o contexto dela nas respostas.
```

### Perfil salvo
```
Perfil salvo ✅

Agora toda resposta vai ser personalizada pra ela. Manda o print ou descreve o que aconteceu 🎯
```

### Perfil limpo
```
Perfil limpo ✅

Nova conversa, do zero. Manda o print ou descreve a situação.
```

### Feedback positivo recebido
```
Anotei. Vou usar de referência nas próximas. Manda o próximo quando quiser.
```

### Feedback negativo recebido
```
Nem sempre cola na primeira. Manda como ela reagiu — ajusto a abordagem.
```

## 2.15 Erros e Edge Cases

| Situação | Mensagem |
|----------|----------|
| Áudio transcrito vazio | `Não consegui entender o áudio. Descreve em texto o que ela disse.` |
| Falha geral de análise | `Não consegui processar. Tenta de novo.` |
| Print muito grande (>10MB) | `Esse print tá muito pesado. Tira um screenshot menor e manda de novo.` |
| Print ilegível | `Hmm, não consegui ler bem essa imagem. Tenta um print mais nítido da conversa, mostrando as últimas 5-10 mensagens.` |
| Perfil ilegível | `Não consegui ler esse perfil. Manda um print mais claro — com nome, bio e pelo menos uma foto.` |
| Audio falhou | `Não consegui processar o áudio. Descreve em texto o que ela disse.` |
| Paguei — sem pagamento no banco | `Não achei nenhum pagamento pendente. Se quiser gerar um Pix novo, digita *mensal*.` |
| Paguei — Pix ainda processando | `O banco ainda não confirmou o Pix. Costuma cair em menos de 1 minuto. Tenta de novo daqui a pouco.` |
| Paguei — rate limited | `Espera 1 minuto e tenta de novo — o banco ainda pode estar processando.` |
| Paguei — erro ao consultar MP | `Tô verificando seu pagamento aqui. Tenta de novo em 1 minuto.` |
| Já é Parceiro (cmd='premium') | `Você já é *Parceiro*. Pode mandar à vontade.` |
| Já é Pro (cmd='pro') | `🔥 Você já tá no *Parceiro Pro*. Tudo liberado, pode usar à vontade.` |

---

# SEÇÃO 3 — TODOS OS COMANDOS QUE O USER PODE DIGITAR

## 3.1 Comandos de Plano e Pagamento

| Comando | Case-sensitive? | O que faz | Quem pode usar | Resposta |
|---------|----------------|-----------|---------------|----------|
| `mensal` | Não | Gera Pix R$29,90 (Parceiro 30d) | Todos | QR Code + código Pix |
| `anual` | Não | Gera Pix R$299 (Parceiro 365d) | Todos | QR Code + código Pix |
| `pro` | Não | Gera Pix R$79,90 (Pro 30d) | Todos | Texto descritivo + QR Code |
| `parceiro pro` | Não | Igual a `pro` | Todos | Idem |
| `wingman pro` | Não | Igual a `pro` (legado) | Todos | Idem |
| `upgrade` | Não | Igual a `pro` | Todos | Idem |
| `24h` | Não | Gera Pix R$4,99 (Parceiro 24h) | Todos | QR Code |
| `voltar` | Não | Gera Pix R$19,90 (win-back) | Todos (não só ex-clientes) | QR Code |
| `premium` | Não | Se já Parceiro: confirma; senão: mostra OPCOES_PREMIUM | Todos | Resposta contextual |
| `paguei` | Não | Poll manual de pagamento | Todos | Confirmação ou "aguarda" |
| `status` | Não | Mostra plano atual + uso do dia | Todos | Texto formatado |

## 3.2 Comandos de Cancelamento

| Comando | Variação | O que faz | Quem pode usar |
|---------|----------|-----------|---------------|
| `cancelar` | `/cancelar` | Inicia fluxo de cancelamento | Pagantes |
| `1` a `5` | — | Responde motivo de cancelamento | Quem está em awaitingCancelReason |

## 3.3 Comandos de Perfil da Conquista (Ela)

| Comando | Regex | O que faz |
|---------|-------|-----------|
| `ela se chama [nome]` | `DEFINE_GIRL_NAME` | Salva nome dela |
| `ela é [desc]` / `perfil dela: [desc]` / `sobre ela: [desc]` / `descreve ela: [desc]` | `DEFINE_GIRL_PROFILE` | Salva perfil dela |
| `situação: [texto]` / `modo: [texto]` / `contexto: [texto]` | `DEFINE_SITUATION` | Salva situação atual |
| `perfil` / `ver perfil` / `perfil dela` | Regex exato | Exibe perfil salvo |
| `limpar perfil` / `apagar perfil` / `nova mina` / `nova menina` / `outra mina` / `esquece ela` | `LIMPAR_PERFIL` | Apaga perfil + contexto |

## 3.4 Comandos de Feedback

| Comando | Regex | O que faz |
|---------|-------|-----------|
| `funcionou` / `deu certo` / `ela respondeu` / `foi bem` / `colou` / `deu boa` / `respondeu bem` / `ela topou` / `ela gostou` / `foi ótimo` / `mandou bem` | `FEEDBACK_POSITIVO` | Registra feedback positivo, anota no what_worked |
| `não funcionou` / `nao funcionou` / `não rolou` / `nao rolou` / `não respondeu` / `nao respondeu` / `foi mal` / `não colou` / `nao colou` / `ignorou` / `ela ignorou` | `FEEDBACK_NEGATIVO` | Responde com incentivo |

## 3.5 Comandos de Navegação de Sessão

| Comando | Regex | O que faz |
|---------|-------|-----------|
| `outra` / `mais` / `outro` / `manda outra` / `mais uma` / `repete` / `tenta outra` / `varia` / `variação` | `PEDE_OUTRA` | Gera variações diferentes do contexto anterior |
| `mais sensual` / `mais curto` / `menos formal` / `mais engraçado` / etc. | `AJUSTE_TOM` | Refaz com tom pedido |
| `parar` / `parar lembretes` | Regex | Cancela lembretes de pré-date |

## 3.6 Comandos de Features Premium

| Comando | Regex | O que faz | Plano mínimo |
|---------|-------|-----------|-------------|
| `como marco encontro` / `como chamo ela pra sair` / `quero marcar encontro` / variações | `TRANSITION_COACH_KEYWORDS` | Inicia Transition Coach (5 perguntas) | Parceiro |
| `tenho encontro` / `encontro amanhã` / `encontro marcado` / variações | `PREDATE_COACH_KEYWORDS` | Inicia Pre-Date Coach (4 perguntas) | Pro |
| `preparar encontro` | Regex exato | Inicia Pre-Date Coach | Pro |
| `como foi o encontro` / `debrief` / `analisar encontro` / variações | `POSTDATE_DEBRIEF_KEYWORDS` | Inicia Post-Date Debrief (6 perguntas) | Pro |
| `debrief encontro` | Regex exato | Inicia Post-Date Debrief | Pro |
| `ativar mindset` / `mindset ativar` | Regex | Ativa cápsulas de mindset | Pro |
| `cancelar mindset` / `pausar mindset` / `mindset cancelar` / `mindset pausar` | Regex | Pausa mindset | Pro |
| `mindset 1x` / `mindset 3x` / `mindset 5x` / `mindset diário` | freqMatch regex | Altera frequência | Pro |
| `mindset` | Regex exato | Mostra status do mindset | Pro |

## 3.7 Respostas a Estados de Espera

| Contexto | Resposta aceita | O que faz |
|----------|----------------|-----------|
| Imagem ambígua (conversa/perfil) | `conversa`, `print`, `chat` / `perfil`, `foto`, `tinder`, `bumble`, `instagram` | Direciona análise |
| Perfil ambíguo (meu/dela) | `meu`, `minha`, `meu perfil`, `é meu`, `próprio` / `dela`, `o dela`, `perfil dela`, `é dela`, `de alguém` | Direciona análise |
| Convite mindset | `sim`, `s`, `ativar`, `quero`, `yes`, `ativo` / `não`, `n`, `nao`, `agora não`, `depois`, `talvez` | Ativa ou declina opt-in |
| Resposta ao Ato 1 | `1`, `2`, `3`, `4` (detectado por parseUserChoice) | Inicia persona flow |
| Outcome do Transition Coach | Texto livre (classificarOutcome() via IA) | Registra outcome |
| Motivo de cancelamento | `1` a `5` | Registra motivo |

## 3.8 Comandos Legados Aceitos

- `wingman pro`, `parceiro pro` → geram Pix Pro  
- Planos `wingman`, `premium`, `pro`, `direto`, `direto_pro` nos PLAN_NORMALIZE são aceitos em canUseFeature

## 3.9 Comandos Ausentes / Não Documentados para o Usuário

- Não há help / ajuda / ? / menu comando
- Não há comando para listar features disponíveis
- Não há `anual pro` para Pro anual (só existe plano mensal para Pro)
- Não há comando de histórico ou exportação

---

# SEÇÃO 4 — TODOS OS PONTOS DE DROP-OFF POSSÍVEIS

## DROP-01 — Boas-vindas → Sem resposta (H+0 a H+27)
**Severidade:** CRÍTICO  
**Por que o user pararia:** Recebeu 3 mensagens mas não sabia o que fazer; mensagem[1] (diagnóstico) confunde quem esperava algo mais direto; app fechou.  
**Sistema hoje:** follow-up em H+27 "Tem alguma conversa rolando? Manda o print."  
**Problema:** Workers proativos DESLIGADOS por default. Se PROACTIVE_MESSAGES_ENABLED=false, o follow-up é agendado mas NUNCA enviado.  
**Sugestão:** Ligar PROACTIVE_MESSAGES_ENABLED ou criar mecanismo inline para processar follow-ups de onboarding.

## DROP-02 — Trial H+72 sem conversão
**Severidade:** CRÍTICO  
**Por que pararia:** Nunca voltou pro bot; usou o trial mas não viu valor suficiente pra pagar; esqueceu.  
**Sistema hoje:** Ato 12 (últimos 30min), avisos de trial. Mas sem mensagem proativa logo APÓS o fim do trial (H+73).  
**Problema:** Não há mensagem "seu trial acabou" proativa. O usuário só descobre quando manda uma msg e bate no limite de 3.  
**Sugestão:** Mensagem proativa no H+73 ou H+74 ("Seu trial encerrou. Você tem 3 análises por dia agora.") — requer worker ativo.

## DROP-03 — Free não usa as 3 análises por dia
**Severidade:** ALTO  
**Por que pararia:** Percebeu que só tem 3/dia, achou pouco, desistiu antes de atingir o limite.  
**Sistema hoje:** Nada. Sem mensagem de ativação ou incentivo pro free que não usa.  
**Sugestão:** Follow-up "você ainda tem 3 análises hoje — mandou o print?" entre 12h-18h para free inativo.

## DROP-04 — Depois de pagar, nunca usa as features Pro
**Severidade:** ALTO  
**Por que pararia:** Não entendeu como usar perfil, predate, debrief. A CONFIRMACAO_PRO pede print do perfil, mas se ele não mandar, nada acontece.  
**Sistema hoje:** CONFIRMACAO_PRO[8] pede "manda print do seu próprio perfil", mas só funciona se flags de self-audit estiverem ativas.  
**Problema:** Todas as features Pro estão atrás de feature flags (false por default). Novo cliente Pro pode pagar R$79,90 e não conseguir usar nada além de mensagens ilimitadas.  
**Sugestão:** Verificar se features Pro estão ativas em produção. Se não, a promessa do Pro está sendo descumprida.

## DROP-05 — Transition Coach iniciado mas abandonado durante as 5 perguntas
**Severidade:** MÉDIO  
**Por que pararia:** Ficou impaciente com as 5 perguntas; não entendia onde estava indo.  
**Sistema hoje:** State machine em memória — se o bot reiniciar, o estado some. Se user não responder, o estado fica pendurado.  
**Sugestão:** Timeout de estado (se não responder em 2h, limpa o estado e manda "se quiser continuar, é só dizer que quero chamar ela pra sair").

## DROP-06 — Limite atingido antes de ver valor (1ª vez no free)
**Severidade:** ALTO  
**Por que pararia:** Usou as 3 análises mas ainda não vivenciou um sucesso real. Vai embora sem converter.  
**Sistema hoje:** LIMITE_FREE_ESGOTADO + Ato 13. Razoável mas sem prova social ou depoimento.  
**Sugestão:** Adicionar 1 prova social concreta no LIMITE_FREE_ESGOTADO ("Mais de X caras viraram encontro com isso").

## DROP-07 — Pagamento gerado mas não pago
**Severidade:** ALTO  
**Por que pararia:** Abriu o Pix mas voltou pra ver se é confiável, ou simplesmente esqueceu.  
**Sistema hoje:** Nenhum follow-up de Pix abandonado.  
**Sugestão:** Follow-up em +30min "Você gerou um Pix mas não concluiu — o link ainda tá válido por alguns minutos, quer eu gerar outro?"

## DROP-08 — Upgrade Pro: usuário pede "pro" mas abandona antes de pagar
**Severidade:** MÉDIO  
**Por que pararia:** R$79,90 é objeção de preço. O usuário viu o preço, hesitou, foi embora.  
**Sistema hoje:** O Ato 11 responde objeções mas só chega a quem está em trial/free. Pro que hesita não recebe nada.  
**Sugestão:** Se cmd='pro' foi executado e 30min depois ainda está no mesmo plano → mensagem de reforço.

## DROP-09 — State machine de coaching pendurada
**Severidade:** MÉDIO  
**Por que pararia:** Usuário está no meio do fluxo de coaching multi-turno (coachingState) e não responde por dias. Quando volta, qualquer mensagem vai continuar o fluxo de contexto "antigo".  
**Sistema hoje:** Sem timeout de estado.  
**Sugestão:** Checar idade do estado na memória — se > 24h, limpar e retomar normalmente.

## DROP-10 — Grace period expirado sem notificação ativa
**Severidade:** MÉDIO  
**Por que pararia:** O plano virou free "silenciosamente" durante o grace period de 3 dias. O usuário descobre só quando manda uma mensagem.  
**Sistema hoje:** Grace period mantém acesso por 3 dias, mas sem aviso proativo.  
**Sugestão:** Notificar no início do grace period: "Sua assinatura venceu. Você ainda tem acesso por 3 dias — aqui estão suas opções."

---

# SEÇÃO 5 — INCONSISTÊNCIAS E BUGS DETECTADOS

## BUG-01 — CRÍTICO: Dois sistemas paralelos para o Ato 1
**Arquivos:** `src/narrative/acts/act_1_welcome_diagnosis.js` (flag: `ENABLE_ACT_1`) e `docs/narrative/acts/act_01_hook_diagnostico.md` (flag: `ENABLE_ACT_01_HOOK_DIAGNOSTICO`)  
**Problema:** Existem duas implementações do Ato 1 com feature flags diferentes. O `act_1_welcome_diagnosis.js` é carregado em `narrativeInline.js` via `require('./acts/act_1_welcome_diagnosis')` mas a engine em `acts.js` usa o .md file com flag `ENABLE_ACT_01_HOOK_DIAGNOSTICO`. O texto das duas versões é difer. Quem controla qual dispara?  
**Impacto:** Usuários podem receber a mensagem errada ou nenhuma mensagem de diagnóstico.

## BUG-02 — CRÍTICO: Workers proativos desligados por default
**Arquivo:** `index.js:3717`  
**Problema:** `PROACTIVE_MESSAGES_ENABLED=false` por default. Significa que follow-ups de inatividade (`day1_inactive`), limites (`limit_drop_3`, `limit_exhausted_3`) e mensagens pré-date são **agendados no banco mas nunca enviados**.  
**Impacto:** Todo o sistema de nurturing de H+27 está morto em produção.

## BUG-03 — CRÍTICO: Limites de profile_analysis inconsistentes
**Features.js (linha 72):** `parceiro_pro: { daily: 10 }` para `profile_analysis`  
**PROFILE_LIMIT_REACHED_PRO (index.js:200):** "Deu 30 análises de perfil hoje"  
**profileLimits.js:** Não lido completamente — possivelmente usa limite diferente  
**Impacto:** Usuário Pro vê mensagem dizendo "30/dia" mas o sistema bloqueia em 10. Ou o contrário.

## BUG-04 — ALTO: Ato 3 (.md) tem placeholders literais que não são substituídos
**Arquivo:** `docs/narrative/acts/act_03_first_analysis_template.md`  
**Problema:** O arquivo .md contém `[ANALISE_TEMPERATURA]`, `[SINAIS_OBSERVADOS]`, `[TEXTO_RESPOSTA_SUGERIDA]`, etc. como placeholders literais. O comentário no arquivo diz "NÃO é mensagem proativa — é estrutura que o bot usa na PRIMEIRA análise do user / Usar como referência pro engineer". Mas se a engine tentar carregar este arquivo como copy (via `loadAndApplyCopy`), os placeholders vão vazar para o usuário.  
**Impacto:** Potencial exposição de placeholders não substituídos se a flag ENABLE_ACT_03_FIRST_ANALYSIS_TEMPLATE for ativada sem adaptação.

## BUG-05 — ALTO: recentSuccessAudio é undefined no bloco de áudio
**Arquivo:** `index.js:3618`  
```javascript
if (recentSuccessAudio) { ... }  // linha 3618
```
`recentSuccessAudio` nunca é definida no escopo do bloco de áudio. No bloco de texto, a variável é `recentSuccess`. No bloco de áudio, o código tenta usar `recentSuccessAudio` que é `undefined`, então o `if` sempre é falso. O efeito é que feedback positivo anterior não é resetado após análise por áudio.

## BUG-06 — ALTO: Análise de print de Free via feedback bypass
**Arquivo:** `index.js` — fluxo de imagem, `isPrintAnalysisEnabled(phone)=false`  
Quando `PRINT_ANALYSIS_MODE=false`, o código cai no fallback `analisarPrintComClaude` (Gemini Flash) sem verificar plano. Usuário free pode enviar print e receber análise completa sem restrição, se o feature flag estiver desligado.  
**Impacto:** Upsell de print bypassed por design do fallback.

## BUG-07 — MÉDIO: Estado de coaching (multi-turno) não tem timeout
**Arquivo:** `index.js:3069`  
Fluxo `coachingState`, `transitionCoachState`, `predateCoachState`, `postdateDebriefState` todos em memória sem TTL. Se o bot reiniciar, o estado some. Se o usuário não responder por dias, o estado persiste.

## BUG-08 — MÉDIO: Inconsistência de tom — "você" vs "tu" nas copies
**Exemplos:**
- System prompt do TransitionCoach (linha 47): `PRONOME: use "você". "tu" só em momentos de alta intimidade`
- act_03_first_analysis_template.md: `"Toda mensagem que tu trouxer pra mim"` — usa "tu"
- WELCOME_MESSAGES usa "você" consistentemente
**Impacto:** Tom inconsistente percebido pelo usuário.

## BUG-09 — MÉDIO: `verificarExpiracoes` usa `@c.us` hard-coded
**Arquivo:** `index.js:3661`  
```javascript
await client.sendMessage(`${user.phone}@c.us`, MENSAGEM_RENOVACAO);
```
Para usuários que têm `wa_chat_id` no banco (formato `@lid`), a mensagem vai para `@c.us` que pode ser diferente. O Webhook e Follow-up worker consultam `wa_chat_id` corretamente — o cron de renovação não.

## BUG-10 — MÉDIO: "voltar" (win-back) disponível para qualquer um
**Arquivo:** `index.js:2148`  
O comando `voltar` gera um Pix de R$19,90, mas qualquer usuário pode digitar (não só ex-premium). O win-back condicional na mensagem de limite (index.js:2382) verifica `trial.expiredAt`, mas o comando direto não.

## BUG-11 — BAIXO: Limite de `predate` diferente entre features.js e descrição Pro
**features.js linha 99:** `parceiro: { monthly: 0 }` para predate_coach — parceiro sem acesso ao predate  
**PREDATE_COACH_UPSELL_FREE diz:** "Preparação pra encontro é do *Parceiro Pro*"  
Consistente, mas TRANSITION_COACH é Parceiro (2/mês) — usuário pode confundir onde cada coach pertence.

## BUG-12 — BAIXO: Texto do Ato 9 menciona "~12h pro trial acabar"
**Arquivo:** `docs/narrative/acts/act_09_sumario_uso.md` (última linha)  
O Ato 9 dispara em H+60. O trial dura H+72. Portanto deveriam restar ~12h. CORRETO — mas o texto é hard-coded "~12h" sem verificação dinâmica. Se o Ato 9 disparar mais tarde (H+64, H+68), o número estará errado.

## BUG-13 — BAIXO: Palavras banidas aparecem no próprio sistema
**Arquivo:** `index.js:393` (system prompt, seção BANIDAS)  
A lista de palavras banidas inclui "situação" e "momento" — mas essas palavras aparecem em copies do bot:
- `"Tô verificando seu pagamento aqui. Tenta de novo em 1 minuto."` → ok
- POSTDATE_DEBRIEF_UPSELL_FREE usa "o que ela sinalizou" (ok)
- Mensagens do TransitionCoach: o system prompt banidas só se aplica às **respostas de IA** — não às mensagens hardcoded. Consistente.

## BUG-14 — BAIXO: Atos 2.5 (mirroring) e o fluxo de diagnóstico são mencionados mas o arquivo `act_2_5_mirroring.js` não foi auditado completamente
**Arquivo:** `src/narrative/act_2_5_mirroring.js`  
O sistema chama `generateMirroringAct25()` após 3 respostas do diagnóstico mas o arquivo não foi verificado em detalhes.

---

# SEÇÃO 6 — MOMENTOS DE DECISÃO DE COMPRA

## 6.1 Primeira Vez que o User Vê Preço

**Trial — 1ª mensagem do dia (D+2, último dia):**  
WELCOME_MSG_1 (padrão) menciona "3 dias ilimitados. Sem cartão." mas sem preço.  
→ Preço aparece no `isLastDay`:  
`"Se quiser continuar sem limite: *mensal* — R$29,90 / *anual* — R$299"`  
→ **Ou** no upsellPicoPremium se usar 3+ msgs no último dia.  
**Primeira exposição ao preço:** D+2, 1ª mensagem, ou quando digita algum comando de pagamento.

## 6.2 Quantas Vezes Vê Preço Durante o Trial

| Evento | Quando | Frequência |
|--------|--------|-----------|
| Último dia (D+2), 1ª msg do dia | 1 vez por dia | 1x total |
| Últimas 2h, 1ª msg | 1x | 1x |
| upsellPicoPremium (isLastDay + ≥3 msgs) | 1x | 1x |
| Ato 10 (oferta principal) | H+66 | 1x (se flag ativa) |
| Ato 12 (última chamada) | H+71.5 | 1x (se flag ativa) |
| Se digita cmd de pagamento | Cada vez | Ilimitado |

**Total exposto a preço sem ação do usuário:** 3-5 vezes durante o trial inteiro (se flags ativas). Muito baixo.

## 6.3 Quantas Vezes Vê Preço Após o Trial (Free)

| Evento | Frequência |
|--------|-----------|
| Ao esgotar as 3 análises | 1x/dia |
| Ato 13 (re-oferta) | 1x lifetime |
| follow-ups limit_drop_3, limit_exhausted_3 | 1x cada (se workers ativos) |
| Ao tentar usar print, profile, coach | Cada tentativa |

## 6.4 Objeções Respondidas e Onde

| Objeção | Onde respondida | Qualidade |
|---------|----------------|-----------|
| "E se não funcionar?" | Ato 11 | BOA — usa prova de uso real |
| "E se cancelar?" | Ato 11 + mensagem cancelamento | BOA |
| "ChatGPT já faz isso?" | Ato 11 | BOA — diferenciação concreta |
| "R$79,90 é caro" | Ato 11 | BOA — benchmark + R$ 0 risk |
| "R$29,90 é caro" | Ato 10 (R$1/dia) + Ato 13 | RAZOÁVEL |
| "É confiável?" | Mensagem do Pix (nome real) | PARCIAL |
| "Vai funcionar pra mim?" | Não respondida explicitamente no free | AUSENTE |

## 6.5 Prova Social

**Presente:**
- Ato 5 Variant B: persona "João" (histórico social fictício — é ficção, não depoimento real)
- Ato 10: benchmarks de preço de coach real (R$300-800/sessão)
- Ato 9: personalização de números ("X situações analisadas")

**Ausente:**
- Nenhum depoimento real de usuário
- Nenhum número de usuários ativos
- Nenhuma prova de sucesso (match, encontro marcado) com base em dados reais

## 6.6 Urgência

| Urgência | Fonte | Genuína? |
|----------|-------|---------|
| "Últimos 30 minutos" (Ato 12) | Trial real acaba | SIM |
| "Fecha em menos de 2h" | Trial real | SIM |
| "Hoje é o último dia ilimitado" | Real | SIM |
| Ato 10 Variant B: "Em ~4h o trial fecha" | Real | SIM |
| "a sensação de 'queria mandar mais um print agora'" (Ato 13) | Emocional/real | SIM |

Urgência é sólida e baseada em fato real — não fake urgency.

## 6.7 Garantias Mencionadas

- Ato 11: "Cancela na hora, sem ligação, sem retenção forçada. Digita *cancelar* aqui dentro mesmo."  
- Ato 11: "Se em 7 dias você não achar que valeu, cancela. Não pergunto o motivo."  
- Ato 11: "*O risco é R$ 0.*"  
**Problema:** Não há garantia de devolução de dinheiro mencionada. "Risco R$0" é sobre cancelamento futuro, não sobre reembolso de um mês já pago.

## 6.8 Clareza do Processo

**Positivo:** Comando `mensal` gera QR code imediatamente — menos de 3 passos até pagar.  
**Negativo:** Nenhuma landing page ou página de checkout. O usuário paga direto pelo WhatsApp sem ver um contrato, termos ou política de privacidade.  
**Positivo:** Nome real do responsável (Rafael Cabral Ibraim) no Pix — passa segurança.  
**Negativo:** Não há CNPJ, endereço ou qualquer dado empresarial exibido.

---

# SEÇÃO 7 — ANÁLISE DE EXPERIÊNCIA POR PLANO

## 7.1 Trial (D+0 a D+2)

**Features disponíveis:**
- Análise de mensagens de texto: ILIMITADA
- Análise de print de conversa: 1/dia (via printLimits.js)
- Profile analysis (dela): BLOQUEADA (daily: 0)
- Profile self-audit: BLOQUEADA
- Profile her analysis: BLOQUEADA
- Transition Coach: BLOQUEADO (monthly: 0)
- Pre-Date Coach: BLOQUEADO
- Post-Date Debrief: BLOQUEADO
- Mindset Capsules: BLOQUEADO

**Comunicação de limites:**
- Print bloqueado no trial após 1ª: PRINT_LIMIT_REACHED_TRIAL
- Profile: PROFILE_UPSELL_MESSAGE
- Coach features: upsells inline

**Mensagens proativas recebidas:**
- H+0: 3 msgs de boas-vindas
- D+2 (1ª msg do dia): aviso último dia
- H+71.5-72: Ato 12 (se flag ativa + usuário manda msg)
- Atos narrativos 1-9 progressivos (se flags ativas)

**Clareza das regras:** BOA. "3 dias ilimitados. Sem cartão." é claro. Limites de features específicas (print, perfil) aparecem só quando tentados.

**Features ocultas que o user pode não saber:**
- Pode descrever situação em texto (além de prints)
- Pode enviar áudio
- Pode salvar perfil dela com "ela se chama" / "ela é"
- Pode dar feedback com "funcionou"/"não funcionou"
- Pode pedir variações com "outra"/"mais"

## 7.2 Free (D+3 em diante sem upgrade)

**Features disponíveis:**
- Análise de texto: 3/dia
- Análise de print: BLOQUEADA (daily: 0 em features.js, mas fallback path pode deixar passar — veja BUG-06)
- Todas as outras features: BLOQUEADAS

**Comunicação de limites:**
- Ao esgotar: LIMITE_FREE_ESGOTADO ou contextual (conversa quente, win-back)
- Primeiro follow-up de limite (se workers ativos): limit_drop_3

**Clareza das regras:** RAZOÁVEL. O usuário descobre os 3/dia na transição — não é comunicado proativamente na chegada ao free.

**Problema crítico:** Não há onboarding de "bem-vindo ao free". O usuário acorda no D+3 e descobre o limite ao usar.

## 7.3 Parceiro (R$29,90/mês)

**Features disponíveis:**
- Análise de texto: ILIMITADA
- Análise de print: 5/dia (printLimits.js premium)
- Transition Coach: 2 sessões/mês
- Pre-Date Coach: BLOQUEADO (Pro exclusivo — features.js linha 102: monthly: 0)
- Post-Date Debrief: BLOQUEADO
- Profile analysis (dela/próprio): BLOQUEADO
- Mindset: BLOQUEADO

**Comunicação de features bloqueadas:**
- Print ao atingir 5: PRINT_LIMIT_REACHED_PREMIUM
- Transition Coach ao atingir 2/mês: TRANSITION_COACH_UPSELL_PREMIUM_LIMIT
- Profile: PROFILE_UPSELL_MESSAGE

**Problemas:**
1. A CONFIRMACAO_PARCEIRO NÃO menciona o limite de 5 prints/dia ou 2 transição/mês. Usuário descobre só quando tenta.
2. Print via `canUseFeature` tem limite de 5 (features.js), mas printLimits.js também verifica 5 para premium. Dupla verificação potencialmente redundante.

## 7.4 Parceiro Pro (R$79,90/mês)

**Features disponíveis:**
- Análise de texto: ILIMITADA
- Análise de print: 5/dia (printLimits.js)
- Profile self-audit: 30/dia
- Profile her analysis: 30/dia
- Profile analysis (features.js): 10/dia ← INCONSISTENTE
- Transition Coach: ILIMITADO
- Pre-Date Coach: ILIMITADO
- Post-Date Debrief: ILIMITADO
- Mindset Capsules: opt-in disponível após 14 dias

**Comunicação após upgrade:**
- CONFIRMACAO_PRO (8 msgs): lista features claramente
- Msg[8]: "Manda print do seu próprio perfil" — ação concreta imediata

**Problema:**
1. Todas as features de visão (self-audit, profile analysis, predate, debrief) estão atrás de feature flags (`false` por default). Se não ativadas, usuário Pro paga R$79,90 e só tem "mensagens ilimitadas" na prática.
2. Mindset capsule só é disponível após 14 dias Pro — não mencionado na CONFIRMACAO_PRO. Usuário Pro pode achar que vai receber mindset imediatamente.
3. Limite de análise de perfil: features.js diz 10/dia, mensagem de erro diz 30. Confusão.

---

# SEÇÃO 8 — TOP 20 RECOMENDAÇÕES PRIORIZADAS

## ALTA PRIORIDADE — Fazer essa semana

### 🔴 REC-01 — Ativar workers proativos (ou criar mecanismo alternativo)
**O que mudar:** Setar `PROACTIVE_MESSAGES_ENABLED=true` no .env de produção (ou criar mecanismo inline para follow-ups de onboarding).  
**Onde:** `.env` no VPS  
**Por quê:** Todo o sistema de nurturing (H+27, limit_drop, limit_exhausted) está agendado mas nunca executado. É o principal mecanismo de reativação e conversão.  
**Impacto estimado:** Alto. Recupera usuários que se esqueceram do bot nas primeiras 24h.

### 🔴 REC-02 — Resolver a duplicidade do Ato 1
**O que mudar:** Escolher UMA implementação do Ato 1: ou `act_1_welcome_diagnosis.js` (flag ENABLE_ACT_1) ou `act_01_hook_diagnostico.md` (flag ENABLE_ACT_01_HOOK_DIAGNOSTICO). Remover ou desativar a outra.  
**Onde:** `src/narrative/acts/act_1_welcome_diagnosis.js` + `src/narrative/narrativeInline.js` + `src/narrative/acts.js`  
**Por quê:** Dois sistemas com comportamentos levemente diferentes, flags diferentes, podem conflitar ou produzir UX inconsistente.  
**Impacto estimado:** Médio. Elimina risco de comportamento não-determinístico.

### 🔴 REC-03 — Verificar e resolver inconsistência de limite de profile_analysis
**O que mudar:** Alinhar features.js (10/dia para Pro em profile_analysis) com a mensagem PROFILE_LIMIT_REACHED_PRO ("Deu 30 análises") e com profileLimits.js.  
**Onde:** `src/config/features.js:72`, `index.js:200`, `src/lib/profileLimits.js`  
**Por quê:** Usuário Pro vê mensagem errada ao atingir o limite. Ou está sendo bloqueado em 10 quando a promessa é 30, ou em 30 quando o sistema registra 10.  
**Impacto estimado:** Alto. Afeta trust se o limite real for menor que o comunicado.

### 🔴 REC-04 — Corrigir bug de recentSuccessAudio
**O que mudar:** Linha 3618 de index.js: substituir `recentSuccessAudio` por `recentSuccess` (variável definida no escopo externo).  
**Onde:** `index.js:3618`  
```javascript
// Antes:
if (recentSuccessAudio) {
// Depois:
if (recentSuccess) {
```
**Por quê:** Bug silencioso que impede o bot de usar "o que funcionou" como contexto após análise por áudio.  
**Impacto estimado:** Baixo isolado, mas corrige comportamento prometido.

### 🔴 REC-05 — Adicionar mensagem de "bem-vindo ao free" no D+3
**O que mudar:** Em `verificarExpiracoes()` (já checa trial_ended), adicionar envio proativo de mensagem quando trial expira.  
**Onde:** `index.js:3670-3681`  
**Mensagem sugerida:** `"Seu trial de 3 dias encerrou. A partir de hoje: *3 análises por dia*, reiniciando todo dia às meia-noite. Quando precisar de mais, digita *mensal*."`  
**Por quê:** Sem essa mensagem, o usuário descobre o limite de 3 só quando bate nele — experiência frustrante.  
**Impacto estimado:** Alto. Reduz churn surpresa.

### 🔴 REC-06 — Fixar cron de renovação para usar wa_chat_id
**O que mudar:** `index.js:3661` — usar `wa_chat_id` do banco em vez de construir `@c.us` hard-coded.  
**Onde:** `index.js:3647-3666`  
```javascript
// Atual:
const { data: expirando } = await supabase.from('users').select('phone')...
await client.sendMessage(`${user.phone}@c.us`, MENSAGEM_RENOVACAO);

// Correto:
const { data: expirando } = await supabase.from('users').select('phone, wa_chat_id')...
const chatId = user.wa_chat_id || `${user.phone}@c.us`;
await client.sendMessage(chatId, MENSAGEM_RENOVACAO);
```
**Por quê:** Usuários com `@lid` não recebem aviso de renovação. Perda de receita.  
**Impacto estimado:** Médio.

### 🔴 REC-07 — Tornar aviso de trial informativo sem preço no D+0 e D+1
**O que mudar:** O aviso diário de trial (index.js:2416) atualmente inclui apenas "Você ainda tem N dia(s) ilimitados" nos primeiros 2 dias. Isso está correto, mas não inclui convite para agir. Adicionar um CTA suave.  
**Onde:** `index.js:2415`  
**Sugestão:** `"Você ainda tem *N dia(s)* ilimitados. Manda tudo que tiver rolando 👇"` (remove "(Pra ver seu plano: digita *status*)" — noise desnecessário no primeiro dia)  
**Impacto estimado:** Baixo/Médio.

## MÉDIA PRIORIDADE — Fazer esse mês

### 🟡 REC-08 — Adicionar onboarding de feature discovery
**O que mudar:** Criar uma mensagem "dicas do MandaAssim" enviada ao free na primeira vez que usa as 3 análises, listando o que mais pode fazer (áudio, salvar perfil dela, feedback).  
**Por quê:** Usuários free podem estar embaixo-utilizando o bot sem saber das features textuais.  
**Impacto estimado:** Médio.

### 🟡 REC-09 — Comunicar limites do Parceiro no CONFIRMACAO_PARCEIRO
**O que mudar:** Adicionar ao CONFIRMACAO_PARCEIRO[2] ou [3] uma menção ao limite de prints e sessões de transição.  
**Onde:** `src/webhook.js:59`  
**Sugestão:** "• Análise de conversa inteira — 5 prints por dia" (atualmente diz "sem limite" de forma genérica)  
**Por quê:** Usuário parceiro se decepciona quando descobre o limite de 5 prints na prática.  
**Impacto estimado:** Médio. Gerencia expectativa.

### 🟡 REC-10 — Adicionar timeout de estado nos fluxos de entrevista
**O que mudar:** Ao iniciar coachingState, transitionCoachState, predateCoachState, postdateDebriefState — salvar o timestamp. Na próxima mensagem, verificar se passou > 6h; se sim, limpar o estado e responder normalmente.  
**Onde:** `index.js:2656-2808`  
**Por quê:** Estados pendurados confundem usuários que voltam dias depois.  
**Impacto estimado:** Médio.

### 🟡 REC-11 — Criar follow-up de Pix abandonado
**O que mudar:** Quando `criarCobrancaPix()` é chamado, agendar um follow-up de "Pix ainda válido?" para 30-45min depois, cancelado automaticamente se o pagamento for confirmado.  
**Por quê:** Taxa de abandono de pagamento é alta em todos os canais. Um lembrete resgataria conversões.  
**Impacto estimado:** ALTO.

### 🟡 REC-12 — Adicionar prova social real ao LIMITE_FREE_ESGOTADO
**O que mudar:** Substituir ou complementar a mensagem de limite esgotado com um dado real.  
**Onde:** `index.js:169`  
**Sugestão:** Adicionar algo como "Mais de X caras viraram o limite em encontro marcado." com número real do banco.  
**Por quê:** A mensagem atual é só urgência. Prova social reduz objeção de "não sei se funciona".  
**Impacto estimado:** Médio.

### 🟡 REC-13 — Ativar pelo menos as flags das features Pro em produção
**O que mudar:** Verificar quais features Pro estão com flag `false` no .env de produção e ativar as que já estão prontas.  
**Onde:** `.env` no VPS — verificar: ENABLE_PRINT_ANALYSIS, ENABLE_PROFILE_ANALYSIS, ENABLE_PROFILE_SELF_AUDIT, ENABLE_PROFILE_HER_ANALYSIS, ENABLE_TRANSITION_COACH, ENABLE_PREDATE_COACH, ENABLE_POSTDATE_DEBRIEF  
**Por quê:** Usuário Pro que paga R$79,90 pode estar recebendo só mensagens ilimitadas. Isso é descumprimento de contrato.  
**Impacto estimado:** CRÍTICO para confiança do produto.

### 🟡 REC-14 — Mencionar mindset no CONFIRMACAO_PRO
**O que mudar:** Adicionar ao CONFIRMACAO_PRO que mindset capsules estão disponíveis após 14 dias.  
**Onde:** `src/webhook.js:64-73`  
**Sugestão:** Adicionar msg: `"Mais pra frente (depois de você estar aqui por 14 dias), vou te convidar pra um material extra de mindset. Por agora, manda o print do seu perfil."`  
**Por quê:** Remove surpresa positiva futura de surpresa confusa.  
**Impacto estimado:** Baixo.

### 🟡 REC-15 — Criar comando `ajuda` ou `menu`
**O que mudar:** Adicionar handler para `ajuda`, `help`, `?`, `menu` que lista os principais comandos disponíveis para o plano atual.  
**Onde:** `index.js:2075-` (bloco de comandos)  
**Por quê:** Atualmente não há forma de o usuário descobrir comandos como `status`, `perfil`, `parar`, `cancelar`, `mindset` sem que o bot mencione.  
**Impacto estimado:** Médio. Reduz frustração de usuários que não sabem o que podem fazer.

## BAIXA PRIORIDADE — Fazer quando der

### 🟢 REC-16 — Adicionar comando `anual pro` para Pro anual
**O que mudar:** Criar plano parceiro_pro com 365 dias de acesso no determinarPlano e expor o comando.  
**Onde:** `src/mercadopago.js:18-22`, `index.js`  
**Por quê:** Não existe forma de comprar Pro anual (seria ~R$715 com 25% off) mesmo que seja desejo do usuário.  
**Impacto estimado:** Baixo agora, mas melhora LTV a longo prazo.

### 🟢 REC-17 — Remover o texto hardcoded "~12h" no Ato 9
**O que mudar:** Substituir "Faltam ~12h pro trial acabar" por cálculo dinâmico no templateVars do Ato 9.  
**Onde:** `docs/narrative/acts/act_09_sumario_uso.md` + `src/narrative/acts.js` templateVars do act_09  
**Por quê:** Se o Ato 9 disparar mais tarde que H+60 (ex: H+68), a informação estará errada.  
**Impacto estimado:** Baixo de reputação.

### 🟢 REC-18 — Adicionar garantia explícita de reembolso
**O que mudar:** Adicionar ao Ato 11 ou à mensagem de confirmação de pagamento uma garantia de 7 dias com reembolso.  
**Por quê:** "O risco é R$0" atualmente se refere a cancelar, não a devolver. Uma garantia de devolução reduz significativamente a barreira de compra.  
**Impacto estimado:** Médio.

### 🟢 REC-19 — Adicionar "comando de emergência" para sair de estados
**O que mudar:** Detectar palavras como "sair", "cancela", "esquece", "para" e limpar qualquer estado de entrevista em andamento.  
**Por quê:** Atualmente, se o usuário começou uma entrevista de coaching e quer voltar ao uso normal, qualquer mensagem continua a entrevista.  
**Impacto estimado:** Médio. UX.

### 🟢 REC-20 — Revisar a copy do MENSAGEM_RENOVACAO para ser mais específica ao plano
**O que mudar:** A MENSAGEM_RENOVACAO (`"Seu acesso ilimitado vence em *3 dias*"`) é idêntica para Parceiro e Parceiro Pro. Criar versão diferenciada para Pro.  
**Onde:** `index.js:152-154`  
**Pro:** `"Seu *Parceiro Pro* vence em 3 dias. Renova com *pro* para manter análise de perfil, predate e debrief."`  
**Impacto estimado:** Baixo.

---

# SEÇÃO 9 — ACHADOS EXTRAS

## 9.1 Arquitetura de Feature Flags — Risco Operacional

O sistema tem **8 feature flags separadas** para features do produto (PRINT_ANALYSIS, PROFILE_ANALYSIS, PROFILE_SELF_AUDIT, PROFILE_HER_ANALYSIS, TRANSITION_COACH, PREDATE_COACH, POSTDATE_DEBRIEF, MINDSET_CAPSULES) **mais 13 flags para os atos narrativos** (ENABLE_ACT_01 a ENABLE_ACT_13).

Isso significa que o .env tem ~21 flags de feature para gerenciar. Se alguma estiver errada:
- Um cliente Pro pode pagar e não receber features
- Um trial pode receber features pagas (se flag='all' e plano não for verificado)
- A narrativa pode disparar fora de ordem

**Recomendação:** Criar um endpoint `/admin/feature-status` que lista todas as flags e seus estados atuais. Isso reduz o risco de bugs silenciosos.

## 9.2 Falta de Controle de Qualidade da IA

O sistema usa `validateResponseArray` + `logViolations` para detectar formatação incorreta (aspas, formatação WhatsApp nas sugestões), mas não há:
- Verificação de tamanho de resposta antes de enviar
- Detecção de placeholders não substituídos nas respostas da IA
- Nenhum fallback de copy quando a IA retorna texto fora do formato esperado — `parsearOpcoes()` retorna array vazio e o fallback envia o texto bruto.

## 9.3 Memória de Sessão em Memória (sem persistência)

Todos os estados de estado de entrevista (`coachingState`, `transitionCoachState`, `predateCoachState`, `postdateDebriefState`, `pendingImageClassification`, `pendingProfileClassification`, `pendingMindsetOptIn`, `diagnosticState`) são armazenados no Map `userContext` **em memória**.

Isso significa que **qualquer restart do processo (deploy, crash, PM2 restart) perde todos os estados em andamento**. Usuário em meio a uma entrevista de 5 perguntas perde o contexto completamente.

O histórico de texto (`history`) também é em memória — contexto de conversa perdido a cada restart.

## 9.4 Dependência de OpenRouter + Anthropic sem Circuit Breaker

O sistema tem fallback Haiku → Gemini Flash para falha de modelo, mas:
- Não há circuit breaker: se OpenRouter cair, cada mensagem tenta e falha antes do fallback
- O classificador de intent (Gemini Flash no OpenRouter) não tem fallback — se falhar, retorna 'volume' silenciosamente
- Se o Anthropic API key ficar sem crédito, o sistema degrada para Gemini sem aviso

## 9.5 Dados Sensíveis no Pix

A mensagem de geração do Pix expõe o nome pessoal completo: *"Rafael Cabral Ibraim"*. Isso é uma escolha consciente de transparência (bom para conversão), mas o mesmo nome aparece no código-fonte (`index.js:1891`) sem ser configurável via .env. Se o produto mudar de pessoa física para pessoa jurídica, será necessário alterar o código.

## 9.6 Sem Termos de Uso ou Política de Privacidade Acessíveis

Nenhuma mensagem do bot menciona termos de uso ou política de privacidade. Considerando que o produto coleta dados de conversa (prints, situações pessoais) e os envia para APIs externas (OpenRouter, Anthropic, Google Gemini), isso pode ser um risco regulatório (LGPD).

---

## RESUMO EXECUTIVO

### 5 Achados Mais Críticos

1. **Workers proativos DESLIGADOS por default** (BUG-02 + DROP-01 + REC-01): Todo o sistema de nurturing — follow-ups de onboarding (H+27), avisos de limite, mensagens pré-date — é agendado no banco mas nunca executado. É o equivalente a ter um time de SDR mas não ligar para os leads.

2. **Features Pro possivelmente inexistentes em produção** (DROP-04 + REC-13): Todas as features diferenciadas do Parceiro Pro (análise de perfil, predate, debrief, mindset) estão atrás de feature flags com default `false`. Um cliente que paga R$79,90/mês pode estar recebendo apenas mensagens ilimitadas — o mesmo que o Parceiro de R$29,90.

3. **Inconsistência crítica de limite no profile_analysis** (BUG-03 + REC-03): features.js define 10/dia para Pro, mas a mensagem de erro diz "30 análises". Um dos dois está errado — e o usuário Pro vai descobrir quando bater no limite real.

4. **Dois sistemas paralelos do Ato 1 com flags diferentes** (BUG-01 + REC-02): `act_1_welcome_diagnosis.js` e `act_01_hook_diagnostico.md` coexistem com flags diferentes (`ENABLE_ACT_1` vs `ENABLE_ACT_01_HOOK_DIAGNOSTICO`). Risco de UX inconsistente.

5. **Estados de sessão em memória sem persistência** (Seção 9.3): Qualquer deploy ou crash destrói o contexto de todos os usuários em meio a uma entrevista (coaching, predate, debrief). Em produção com deploys frequentes, isso cria uma experiência quebrada repetidamente.

### 5 Quick Wins Implementáveis em < 1h

1. **Corrigir `recentSuccessAudio` → `recentSuccess`** (BUG-05, index.js:3618): 1 linha, 5 minutos.

2. **Fixar `verificarExpiracoes` para usar `wa_chat_id`** (BUG-09, index.js:3661): Adicionar `wa_chat_id` no select e usar na mensagem. ~10 linhas.

3. **Setar `PROACTIVE_MESSAGES_ENABLED=true` no .env do VPS**: 1 variável, imediato. Ativa todo o sistema de nurturing já implementado.

4. **Remover o `_(Pra ver seu plano: digita *status*)_` do aviso de trial no D+0**: Linha 2419 — ruído desnecessário no momento de maior entusiasmo do usuário.

5. **Adicionar resposta ao comando `ajuda` / `help`**: ~20 linhas de código, elimina confusão de usuários que não sabem o que podem fazer.

### 1 Pergunta Importante que Precisa do Rafa para Responder

**Quais feature flags estão setadas como `true` ou `all` no .env de produção do VPS?**

Toda a análise de "o que o usuário Pro recebe" depende disso. Se todas as flags de features Pro estão `false` em produção, o produto está entregando uma versão significativamente inferior ao prometido — e a análise de drop-off e experiência por plano desta auditoria está baseada num cenário ideal que não existe na prática.

---

*Auditoria gerada em 2026-05-05. Baseada em leitura estática do código — comportamento em produção pode diferir dependendo dos valores reais do .env.*
