# Microconceitos MandaAssim 2026

> Glossário dos conceitos que fundamentam a lógica do bot. Usados nos system prompts e na comunicação com o usuário.

---

## Leitura de Intenção

**O quê:** Ler o que ela quis dizer — não só o que ela disse — antes de sugerir qualquer resposta.

**Por quê funciona:** A maioria dos apps e coaches geram respostas sem entender o sinal. Uma "resposta de impacto" no momento errado queima o trabalho. Ler a intenção primeiro é o que separa uma resposta que avança a conversa de uma que a encerra.

**Como aplicar:**
- "To ocupada" → pode ser verdade, pode ser teste, pode ser perda de interesse. Cada leitura pede uma resposta diferente.
- Ela sumiu e voltou com "oi" → não é reabertura entusiasmada. É tentativa. Resposta calma, não comemorativa.
- Ela mandou emoji apaixonado → interesse alto, mas elogio genérico agora mata o clima.

**No output:** É o que aparece em `📍 _[uma linha: o sinal dela]_` antes de qualquer sugestão.

---

## Temperatura da Conversa

**O quê:** O estado emocional da troca de mensagens naquele momento — quente, morna, fria, testando, aberta, fechada.

**Por quê importa:** A temperatura determina qual tipo de resposta faz sentido. Temperatura fria + resposta quente = pressão. Temperatura quente + resposta fria = perde o embalo.

**Referência rápida:**
| Temperatura | Sinal | Resposta certa |
|-------------|-------|----------------|
| Quente | Emojis, iniciativa, perguntas pessoais | Avança, cria tensão |
| Morna | Respostas curtas, educada mas sem energia | Muda de ângulo, não insiste no mesmo |
| Fria | Seco, "kkk", demora longa | Calmaria, sem cobrar |
| Testando | Desculpa, sumiço, recuo depois de quente | Não reage, age normal |

---

## Hinge Penpal Trap

**O quê:** O buraco que a conversa de app cria quando fica boa demais no chat — e não vai pra lugar nenhum. Ele está animado, ela está animada, a troca flui, mas ninguém marca nada.

**Por quê acontece:** Conversa boa vicia. Ela já tem a sensação de conexão sem o risco de um encontro. Ele acha que "está indo bem" e não sente urgência de marcar.

**Como identificar:** Mais de 5-7 dias de conversa fluindo sem proposta de encontro. Ela responde bem mas não dá nenhum sinal de querer sair do digital.

**O que fazer:** A conversa boa é capital. É hora de usar — não de acumular. A mensagem certa não é "vamos sair?", é criar um pretexto natural de encontro presencial.

---

## Janela de Convite

**O quê:** O momento específico em que chamar pra sair tem a maior probabilidade de sim. Normalmente é quando a temperatura está quente e a conversa acabou de ter uma troca boa.

**Como reconhecer:**
- Ela acabou de mandar algo animado, pessoal ou curioso
- A conversa teve uma piada que funcionou
- Ela respondeu rápido várias vezes seguidas
- Ela mencionou um lugar, atividade ou plano que abre gancho

**O que NÃO é Janela de Convite:**
- Logo depois de um momento estranho
- Quando ela acabou de dar uma resposta seca
- Quando a conversa está em ritmo de cordialidade

---

## Reset Pós-Rejeição

**O quê:** O movimento de recalibrar a abordagem depois de um não — sem drama, sem desaparecimento, sem pressão.

**Por quê importa:** A rejeição de um convite específico não é rejeição da pessoa. Mas a maioria dos caras ou desaparece (parece sensível) ou insiste (parece que não entendeu). O Reset é a terceira via: acusa o recibo sem fazer grande coisa e segue a conversa.

**Como fazer:**
- "Tá bom, fica pra próxima" + continua o assunto dela. Nada mais.
- Não explica, não pede desculpa, não desaparece.
- Na próxima oportunidade de Janela de Convite: tenta de novo com naturalidade.

**O que NÃO é Reset:**
- Sumir por 2 semanas (childish)
- "Tudo bem, entendo, sem problemas" (muito formal, cria distância)
- Insistir no mesmo dia com argumento diferente

---

## Sinal vs Ruído

**O quê:** A diferença entre o comportamento dela que realmente significa algo e o que é ruído de contexto (humor do dia, trânsito, trabalho, cansaço).

**Por quê importa:** Caras em modo ansioso tratam tudo como sinal. Ela demorou 2 horas → "ela perdeu o interesse". Ela mandou "kkk" seco → "eu falei errado". Na maioria das vezes é ruído.

**Como calibrar:**
- Padrão de comportamento > um comportamento isolado
- Se o padrão dela sempre foi assim: é o jeito dela, não é sinal de nada
- Sinal real muda o padrão: antes respondia rápido, agora demora dias seguidos

**Uso no sistema:**
- Na leitura de situação: identificar o que é sinal real antes de sugerir o que fazer
- No coaching: ajudar o usuário a não superinterpretar uma resposta isolada
