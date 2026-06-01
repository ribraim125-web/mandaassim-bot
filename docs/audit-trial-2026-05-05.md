# Auditoria DR — Sequência de Trial MandaAssim
**Data:** 2026-05-05  
**Auditor:** Claude (postura de copywriter sênior DR)  
**Referências:** Schwartz, Halbert, Hopkins, Bencivenga, Makepeace

---

## 1. Resumo Executivo

Cinco achados que você precisa ler antes do doc completo:

1. **🔴 Ato 12 ("Tá tudo certo qualquer caminho") mata a conversão no gol.** A última mensagem antes do trial virar free reassegura o prospect que está OK não comprar. É o equivalente a um vendedor de carro falar "não precisa comprar hoje" no momento da assinatura.

2. **🔴 Zero prova social em toda a sequência.** Nenhum número real de usuários, nenhum resultado concreto, nenhum depoimento. Bencivenga e Hopkins são unívocos: sem prova, claim vira ruído. Uma sequência que vende coach de relacionamento sem mostrar que funcionou pra outros é puro ato de fé do comprador.

3. **🔴 Ato 3 (template de análise) coloca aspas na mensagem sugerida.** `_"[TEXTO_RESPOSTA_SUGERIDA]"_` — a primeira análise, o produto mais importante da primeira hora, entrega o texto pronto dentro de aspas e itálico. O usuário não consegue copiar em um toque. Destrói o aha moment na entrega.

4. **🟡 Nenhum PS em nenhum ato de oferta.** Schwartz e Makepeace são categóricos: em DR, o PS é o segundo elemento mais lido depois do título. Atos 10, 11 e 12 não têm PS. Dinheiro deixado na mesa.

5. **🟢 O Ato 13 (D+1) é o mais forte da sequência.** "Sente a fricção?" é a melhor linha de CTA do produto inteiro. Se o Ato 12 tivesse essa energia, a conversão subiria.

---

## 2. Mapa da Sequência Completa

| # | ID | Arquivo | Trigger | Função DR | Variantes |
|---|---|---|---|---|---|
| 1 | act_01_hook_diagnostico | acts/act_01... | após first_message_sent | Segmentação + hook entrada | Não |
| 2 | act_02_promessa_mecanismo | acts/act_02_op[1-4] | resposta ao Ato 1 | Mecanismo único + identificação | 4 versões por persona |
| 2.5 | (dinâmico) | act_2_5_mirroring.js | resposta ao diagnóstico Ato 2 | Espelhamento + aha moment | Gerado por Haiku |
| 3 | act_03_first_analysis | acts/act_03... | primeira análise de print/msg | WOW moment, prova de produto | Não (template) |
| 4 | act_04_reveal_papo | acts/act_04... | H+2 a H+8 | Ampliar percepção do produto | Não |
| 5 | act_05_identificacao | acts/act_05... | H+12 a H+24 | Agitação + identificação profunda | Variant B |
| 6 | act_06_reveal_audit | acts/act_06... | H+24 a H+36 | Revelar feature Pro (auditoria) | Variant B |
| 7 | act_07_reveal_analise_dela | acts/act_07... | H+30 a H+48 | Revelar feature Pro (análise dela) | Não |
| 8 | act_08_reveal_predate | acts/act_08... | H+36 a H+60 | Revelar features Pro (predate/postdate) | Não |
| 9 | act_09_sumario_uso | acts/act_09... | H+60 a H+66 | Prova acumulada + ancoragem | Não |
| 10 | act_10_oferta | acts/act_10... | H+66 a H+70 | A oferta principal | Variant B |
| 11 | act_11_objecao_garantia | acts/act_11... | após Ato 10 | Quebra de objeções | Não |
| 12 | act_12_ultima_chamada | acts/act_12... | H+71:30 | Urgência final | Não |
| 13 | act_13_reoferta_d1 | acts/act_13... | D+1, após bater limite free | Re-oferta por perda sentida | Não |

### Mensagens fora dos atos narrativos

| Tipo | Localização | Momento |
|---|---|---|
| Welcome trial | index.js | Primeira mensagem do usuário |
| Upsell feature bloqueada | index.js | Quando free tenta usar Pro |
| Welcome Parceiro | src/webhook.js + index.js | Após pagamento aprovado |
| Welcome Parceiro Pro | src/webhook.js + index.js | Após pagamento aprovado |
| Welcome upgrade (Parceiro→Pro) | src/webhook.js + index.js | Após upgrade |
| Limite diário atingido | index.js | Quando free bate limite |
| Última chamada 24h | src/narrative/narrativeLog.js | H+48 free (D+1) |

---

## 3. Análise por Princípios DR

### Ato 1 — Hook + Diagnóstico

**Schwartz — Nível de consciência**
Acerta o nível 2-3 (consciente do problema, buscando solução). O cara que baixou o bot já sabe que tem um problema com paquera digital. A segmentação por persona é sólida. Nota: 8/10.

**Halbert — Conversação natural**
"E aí." é perfeito. Tom de bar imediato. A pergunta de segmentação soa natural, não como formulário de cadastro. Nota: 9/10.

**Hopkins — Especificidade**
Fraco aqui. A abertura não tem número, não tem claim. Hopkins teria começado com uma estatística que ancora o problema: "95% dos caras voltam pro mercado sem saber que o app de 2010 virou outro jogo." Nota: 5/10.

**Bencivenga — Credibilidade vs hype**
Limpo. Sem claims. Só segmentação. OK pra ato 1. Nota: 7/10.

**Makepeace — Emoção dominante**
Curiosidade + leveza. Adequado pra entrada. Não força. Nota: 8/10.

**Issue específico:** "Voltando pro mercado depois de tempo casado" — limita. Muitos do ICP tiveram relações longas sem casamento. Recomendo: "Voltando pro mercado depois de tempo junto com alguém" ou simplesmente "Depois de separação ou término longo."

---

### Ato 2 — Promessa + Mecanismo (4 variantes)

**Op1 (voltou pro mercado) — MELHOR VARIANTE**

"Tudo mudou. Os apps mudaram. O jeito de conversar mudou. O que funcionava em 2010 hoje espanta. E ninguém te avisou." — Schwartz nível 3 puro. Agita uma verdade que o cara sente mas não articulou. Excelente.

O contraste ChatGPT vs Leitura de Intenção é a introdução do mecanismo único mais limpa da sequência. "ChatGPT chuta. Eu decifro." — melhor linha de mecanismo de todo o bot.

**Op2 (apps sem conversão)**

"90% das vezes não é teu perfil. Não é teu físico. Não é tua idade." — excelente inversão de crença. Hopkins adoraria. Remove as desculpas clássicas antes do cara as usar.

**Op3 (conversa quente) — MAIS FRACA**

Abre com ansiedade pura: "Conversa rolando, e cada mensagem importa. Porque uma errada quebra tudo." Sem identificação empática primeiro. O cara em conversa quente não precisa que aumentem a ansiedade dele — precisa que reduzam. Proposta: começa com "Você chegou no momento mais crítico. Bom sinal — quer dizer que a conversa foi longe o suficiente."

**Op4 (outro) — Aceitável**

Erro gramatical: "qualquer ChatGPT que tu já testado" → deve ser "testou". Pequeno mas lido por alguém criterioso como descuido.

**Estrutura DR geral das op2:**
Os quatro atos terminam com o mesmo CTA ("Manda print... Ou descreve a situação... Bora."). Consistência boa. O CTA poderia ser diferenciado por persona — pra quem voltou ao mercado, o CTA poderia ser: "Manda a última conversa que tá travada. Começa aqui."

---

### Ato 2.5 — Espelhamento Dinâmico (Haiku)

Não auditável diretamente — é gerado. Mas o system prompt (act_2_5_mirroring.js) tem:

**Pontos fortes:**
- A instrução de "ir mais fundo que o óbvio" está bem escrita
- O exemplo de resposta boa vs. ruim no system prompt é excelente guia
- A Bloco 3 (promessa específica) bem desenhada: "quando você mandar o print, eu te falo: temperatura real dela, o que você tá lendo errado, e qual a próxima jogada certa"

**Riscos:**
- Geração dinâmica significa variância. Se Haiku gerar um espelhamento genérico, o aha moment falha silenciosamente sem nenhum log de qualidade
- Recomendo: loggar o output do Ato 2.5 e amostrar 1 em cada 10 pra revisão manual

---

### Ato 3 — Template de Primeira Análise

**🔴 PROBLEMA CRÍTICO DE FORMATAÇÃO:**

```
*Manda assim:*
_"[TEXTO_RESPOSTA_SUGERIDA]"_
```

A mensagem sugerida está dentro de `_"..."_` — aspas + itálico. Quando renderiza no WhatsApp, o usuário vê:

> *"Ei, tudo bom?"*

Para copiar, precisa selecionar o texto, excluindo as aspas manualmente. Em 2 taps no celular, isso é fricção suficiente pra pular.

O Ato 3 é o WOW moment mais importante do produto. É a prova que valida tudo que os Atos 1 e 2 prometeram. Se a entrega tem atrito, o WOW vira "ah, interessante".

**Hopkins — Especificidade:**
A estrutura com `[ANALISE_TEMPERATURA]` e `[SINAIS_OBSERVADOS]` é correta — força a IA a ser específica. Mas o fechamento:

"Isso é Leitura de Intenção. Toda mensagem que tu trouxer pra mim, eu leio primeiro o que tá rolando. _Aí sim_ sugiro o que falar. Manda mais quando aparecer. Tô aqui."

Está bom mas genérico. Hopkins teria usado o contexto específico da análise que acabou de fazer: "Essa conversa estava [temperatura]. Quando ela mandou X, quis dizer Y. Tô aqui pra toda vez que aparecer um X."

---

### Ato 4 — Reveal Papo

**O melhor ato narrativo da sequência.**

"É a hora em que ela some por 2 dias e tu fica refazendo a mensagem na cabeça." — Schwartz nível 4. Agita uma dor emocional específica que o ICP sente mas raramente articula.

"É a vontade de mandar mais uma e perguntar 'tá tudo bem?' — e tu sabe que não é uma boa." — Halbert puro. Soa exatamente como conversa de bar.

A rejeição explícita do cringe self-help E da manosfera no mesmo parágrafo é diferenciação de produto embutida na copy. Raro. Efetivo.

"Direto. Como amigo mais velho que já passou por isso." — posicionamento excelente. Resolve autoridade sem arrogância.

**Único ajuste:** O ato começa com "Ei. Tô vendo que tu tá ativo. Bom." — levemente robótico. O "Bom." soa como feedback de professor. Sugestão: "Ei. Tu tá usando bastante. Bom de ver."

---

### Ato 5 — Identificação Amplificada

**Variante A:**

O placeholder `[N]` é crítico — se retornar "0" ou texto literal, o ato vira vexame. "Tu já mandou 0 mensagens essas últimas horas comigo." destrói credibilidade.

A pergunta final é forte: "Quantas dessas tu mandaria errado se eu não tivesse aqui pra ler a intenção primeiro?" — Hopkins chamaria de "razão pela qual", frame de custo de oportunidade.

O fechamento em itálico parênteses é fraco para a posição que ocupa: "_( Esse é o motivo do MandaAssim existir...)_" — parece endnote, não CTA. Deveria ser a linha mais forte, não a mais discreta.

**Variante B (Halbert story-first):**

"Tu acabou de virar o João sem perceber." — melhor linha de identidade de toda a sequência. Hopkins a teria em negrito, não escondida no final.

A Variant B é superior à A como peça de copy, mas a "João" como persona é ligeiramente forçada. O cara do ICP pode se distanciar de uma história sobre terceiro. Halbert usava histórias sobre o próprio leitor, não sobre um outro cara.

---

### Ato 6 — Reveal Auditoria de Perfil

**Variante A:**

"Vou ser cru contigo. Tu segura?" — abertura masculina, respeita o ICP. 9/10.

A pivot "e se o problema não for a resposta?" é sólida mudança de frame. Faz o cara questionar a solução que estava usando (responder bem) antes de apresentar a nova (perfil melhor).

"Coisa que amigo nenhum vai fazer com tu de verdade. Porque amigo tem medo de magoar. Eu não tenho." — Bencivenga puro. Credibilidade via diferenciação de motivo.

**Issue:** "Liberado por enquanto." — vago. Quando acaba? O user não sabe se tem 2h ou 2 dias. Isso gera ansiedade não produtiva (não converte, só incomoda). Se a feature está disponível durante o trial, diz "Disponível até o fim do teu trial (faltam ~[X]h)."

**Variante B (Hopkins):**

O "1 segundo" hook é forte e verificável. Mais convincente que a Variante A pra um ICP que pensa racionalmente sobre o problema.

Os exemplos de feedback são a melhor demonstração de especificidade da sequência: "_Foto 1: pose travada, troca por X_" — isso é o que Hopkins chama de "cópia específica".

Recomendo a Variante B como A/B winner para ICP com perfil mais analítico (38-45 anos, profissional).

---

### Ato 7 — Reveal Análise Dela

"Não é manipulação. É leitura. É respeito performado." — LINHA DE OURO. Resolve em 6 palavras a principal objeção ética que o ICP vai ter. Deveria aparecer em outros atos também.

"Caras que fazem isso têm taxa de resposta muito maior." — único claim vago do ato. Hopkins pediria: "Caras que fazem isso antes da primeira mensagem têm [X]% mais resposta que a média." Se não tem dado real, remove o claim ou usa linguagem de opinião: "Na minha experiência, a resposta inicial muda completamente."

O ritmo de mensagens é bom — cada bloco é uma ideia. Formatação WhatsApp adequada.

---

### Ato 8 — Reveal Predate/Postdate

Schwartz nível 5 (produto específico, features claras). Funciona como ato de revelação.

"Não tem vergonha nisso. Tem realidade." — empatia honesta sem condescendência. Perfeito pra ICP que passou por divórcio.

O checklist de itens do predate é excelente especificidade: horário de roupa, tópicos, quantidade de bebida, hora de sair. Isso é Hopkins: "Aqui está exatamente o que eu farei por você."

"E existem MUITOS sinais que tu não viu." — bom agitador pós-encontro. Poderia ser mais específico: "Quando ela cruzou os braços mas continuou sorrindo — eu teria te dito o que isso significa."

---

### Ato 9 — Sumário de Uso

**Este ato só funciona se os dados forem reais.**

`[N_INTERACTIONS]`, `[N_PRINTS]`, `[N_PAPO]` — se qualquer um retornar zero ou placeholder, o ato se destrói completamente. Pior: o cara vai ver que o bot está fingindo especificidade.

A âncora de valor é boa: "Cada uma dessas análises, com humano sério, custaria entre R$ 50 e R$ 300." — Hopkins: compara custo com alternativa conhecida.

`[IF_PRO_BLOCK]` — esse placeholder precisa ser verificado. Se não renderizar corretamente, o usuário vê "[IF_PRO_BLOCK]" literalmente.

"Tu fez tudo isso em 60h. De graça. No teste." — linha forte, cria perda iminente.

**Issue:** Não tem CTA direto. O ato termina com "Em breve te mostro como continuar tendo isso." — passivo demais. Poderia terminar com: "Amanhã eu te mostro como continuar. Mas se quiser garantir antes: [LINK]."

---

### Ato 10 — A Oferta

**Variante A vs B:**

A Variante B é claramente superior. "Ou volta pra ser o cara que tu era antes do MandaAssim" — identidade por contraste. Makepeace: emoção dominante certa (não é medo da compra, é medo da regressão).

**Problemas em ambas as variantes:**

1. **Zero prova social.** Não tem um único "X usuários já usaram" ou "após usar por 30 dias, João fechou 3 encontros". Bencivenga é categórico: sem prova de outros, o prospect tem que confiar só na sua palavra. Pra produto novo, isso é barreira enorme.

2. **Urgência apologética.** Variant A: "Sem pressa. Pensa hoje." Variant B: "Não vou te empurrar." Makepeace: nunca peça desculpa pela oferta. O produto tem valor real. Apresente com confiança. Proposta: remove "sem pressa" e substitui por: "Tu tem até as [HORA] de hoje."

3. **Sem PS.** Cada ato de oferta precisa de PS. O PS é o segundo elemento mais lido. Sugestão de PS: "PS: Todo mês que tu cancela, você volta pra zero. Toda conversa que tu ter sozinho vai ser sem leitura de intenção. Esse é o único custo real."

4. **Ancoragem de R$ 29,90 fraca.** "Menos que pizza grande" é clichê. Hopkins ancoraria em algo com custo emocional maior: "R$ 29,90 é menos que um Uber numa sexta que não levou a lugar nenhum."

---

### Ato 11 — Objeções

Estrutura correta. Cobre as 4 objeções reais.

**"E se não funcionar pra mim?"** — Resposta forte. "Não é hipótese. É histórico." — Bencivenga: prova pela experiência própria do usuário.

**"E se eu cancelar?"** — "Eu prefiro perder cliente bem do que segurar à força." — confiança genuína. Halbert adoraria. Soa como dono confiante do produto, não vendedor desesperado.

**"E se ChatGPT já faz isso?"** — Fraco. "Tu vai sentir a diferença em 1 troca." — joga o ônus da prova de volta pro prospect. Hopkins faria uma demonstração: "Cola o mesmo print no ChatGPT. Ele vai te dar uma resposta. Eu vou te dizer o que a temperatura da conversa estava, o que ela quis dizer com aquele 'kk', e por que o tom mudou na mensagem 3. Não é o mesmo produto."

**"R$ 79,90 é caro"** — OK mas genérico. Todos gastam R$ 79,90 em algo que não funciona. Proposta mais específica: "R$ 79,90 é menos que um mês de app premium no Tinder — que te dá mais alcance, mas não te ensina o que falar quando você chega lá."

**Falta:** Nenhuma garantia explícita. "Cancela em 1 mensagem" é garantia de saída mas não é garantia de resultado. Hopkins sempre inclui pelo menos uma garantia condicional: "Se em 7 dias você não achar que valeu, cancela sem pergunta."

---

### Ato 12 — Última Chamada

**🔴 MAIOR PROBLEMA DA SEQUÊNCIA INTEIRA:**

"Tá tudo certo qualquer caminho. Bora."

Isso é o OPOSTO do que se faz em DR às 30 minutos do fechamento.

Makepeace: o último ato deve ativar medo de perda, não conforto. Gary Halbert era brutal: "Eu não preciso que você compre. Você que precisa do que eu tenho."

"Tá tudo certo qualquer caminho" diz ao prospect: "não tem urgência real, não tem perda real, é ok ficar no free." Isso desfaz toda a urgência construída em 70h.

**O que funciona:** "30 minutos." — abertura perfeita. Brevidade máxima. Urgência real.

**Reescrita sugerida:**

```
*30 minutos.*

---

Em 30min tu volta pra 3 mensagens/dia.

Vai ter conversa nova hoje. Talvez já tenha.

Com o free, vai ter uma hora que ela vai responder e tu não vai poder analisar. Hoje.

---

Se quiser que isso não aconteça:

👉 [LINK_PARCEIRO_PRO]
```

Sem "tá tudo certo". Sem "bora" como fechamento falso-motivacional. Urgência real: "vai ter conversa hoje e você não vai poder analisar."

---

### Ato 13 — Re-oferta D+1

O ato mais forte de toda a sequência.

"Sente a fricção?" — Halbert perfeito. Usa a experiência que o cara ACABOU de ter (bater no limite) como evidência imediata do produto.

"Tava melhor antes, né?" — inversão do CTA. Não pede que o cara imagine um futuro melhor. Aponta pra um passado imediato que ele já viveu. Muito mais convincente.

"Sem stress. Mas tava melhor antes, né?" — o "sem stress" está OK aqui porque o produto de fato foi melhor. É confiança, não desculpa.

Se o Ato 12 tivesse a energia do Ato 13, a conversão no momento crítico seria outra.

---

## 4. Análise de Formatação WhatsApp

### Quebra de mensagens

| Ato | Blocos | Linhas max/bloco | Status |
|---|---|---|---|
| Ato 1 | 3 | 6 | ✓ |
| Ato 2 op1 | 4 | 4 | ✓ |
| Ato 2 op2 | 4 | 4 | ✓ |
| Ato 2 op3 | 4 | 3 | ✓ |
| Ato 2 op4 | 4 | 4 | ✓ (erro gramática) |
| Ato 3 | 4 | 3 | ⚠️ (aspas no CTA) |
| Ato 4 | 5 | 5 | ✓ |
| Ato 5A | 6 | 5 | ✓ |
| Ato 5B | 5 | 4 | ✓ |
| Ato 6A | 7 | 4 | ✓ |
| Ato 6B | 6 | 4 | ✓ |
| Ato 7 | 6 | 5 | ✓ |
| Ato 8 | 5 | 6 | ✓ |
| Ato 9 | 4 | 4 | ⚠️ ([IF_PRO_BLOCK]) |
| Ato 10A | 6 | 7 | ⚠️ (bloco Parceiro Pro tem 7 linhas) |
| Ato 10B | 6 | 5 | ✓ |
| Ato 11 | 5 | 6 | ✓ |
| Ato 12 | 3 | 2 | ✓ |
| Ato 13 | 3 | 2 | ✓ |

**Issue no Ato 10A:** O bloco do Parceiro Pro lista 4 features em linhas separadas, totalizando 7 linhas no bloco. Está acima do limite de 6. Divide em dois blocos.

### Mensagens copy-paste-friendly

**🔴 Ato 3:** `_"[TEXTO_RESPOSTA_SUGERIDA]"_` — aspas + itálico. Violação da regra de copy-paste. Este é o primeiro produto entregue ao usuário. Precisa ser corrigido.

Todos os outros atos não entregam mensagens pra copiar — são narrativas do bot, não sugestões para o usuário encaminhar. Portanto só o Ato 3 tem esse risco.

---

## 5. Análise de Tom

**Tom geral:** 7.5/10. Consistente na maioria dos atos. Problemas pontuais:

| Ato | Problema de tom | Frase específica |
|---|---|---|
| Ato 1 | Levemente formal demais pra entrada | "Antes de te explicar como funciono" — parece onboarding corporativo |
| Ato 2 op3 | Ansiedade sem empatia | "Porque uma errada quebra tudo." — agita sem ancorar |
| Ato 4 | Leve robótico | "Tô vendo que tu tá ativo. Bom." — "Bom." é feedback de professor |
| Ato 5A | Parênteses fraco pro fechamento | "_( Esse é o motivo do MandaAssim existir...)_" |
| Ato 10A | Apologético na oferta | "Sem pressa. Pensa hoje." |
| Ato 10B | Passivo demais no fechamento | "Não vou te empurrar." |
| Ato 12 | Urgência destruída | "Tá tudo certo qualquer caminho." |

**O que está certo:**
- Ausência total de manosfera e cringe self-help (Ato 4 endereça isso explicitamente e bem)
- Tom coloquial maduro consistente — "na lata", "saca", "cru" sem exagero
- Respeito ao ICP sem subestimar nem superestimar
- Ausência de emojis excessivos (só onde faz sentido)
- Sem palavras gringas na copy principal

---

## 6. Análise da Jornada de Aha Moment

### Primeira hora (Atos 1, 2, 2.5, 3)

**Diagnóstico:**
A segmentação do Ato 1 é boa, mas o Ato 2 entrega o mecanismo muito cedo para quem não usou o produto ainda. O Ato 2 fala "ChatGPT chuta. Eu decifro." — o cara ainda não experimentou nada. É claim antes de prova.

O design correto de DR seria: Ato 1 → Ato 2 → **usa o produto** → Ato 2.5 espelha a dor → Ato 3 prova o mecanismo.

A sequência atual faz exatamente isso (o Ato 2.5 vem depois do uso), o que é bom. O problema é que o Ato 2 faz um claim grande que só será validado depois. Se o usuário não usa o produto entre o Ato 2 e o Ato 3, o aha moment nunca acontece.

**Risco identificado:** Se o usuário passa pelos Atos 1, 2, e 2.5 mas nunca manda um print ou descrição de conversa, o Ato 3 nunca dispara. Ele chega no Ato 4 sem ter experienciado o WOW. Toda a sequência de vendas que segue é construída sobre uma fundação que ele não sentiu.

**Recomendação:** O Ato 4 deveria verificar se o usuário fez pelo menos 1 análise. Se não fez, o texto do Ato 4 muda para reforçar o CTA de "manda o primeiro print" em vez de revelar nova feature.

### Revelação progressiva (Atos 4-8)

Os reveals estão bem espaçados (H+2 a H+60). O ritmo é: usa → revela papo → identifica amplificada → revela auditar → revela analisar ela → revela predate/postdate.

Problema: Os Atos 6, 7 e 8 revelam features do Parceiro Pro a alguém que ainda está em trial. O cara experimenta as features gratuitamente. Quando chega a oferta (Ato 10), ele já usou tudo que o Pro tem. O desejo foi saciado antes da venda.

Hopkins chamaria isso de "queimar o desejo antes do ask". A sequência correta seria: revelar a existência da feature, dar uma amostra, e deixar a experiência completa como promessa da compra.

**Verificar:** O Ato 6 diz "Liberado por enquanto" e o Ato 7 menciona "Próximo match: faz e me prova." — esses são bons ganchos pra criar desejo sem entregar tudo. Mas se o sistema está realmente liberando as features Pro no trial, o desejo é saciado antes da venda.

### Crescendo pra oferta (Atos 9-12)

O Ato 9 (sumário) é excelente DR se os dados estiverem populados. É a prova de valor mais concreta possível: tuas próprias interações. Hopkins: "aqui estão os fatos, você decide".

O problema é o Ato 12 já descrito. O crescendo vai de 0 (Ato 1) até quase 10 (Ato 9) e cai pra 6 no Ato 12 quando deveria estar em 10.

---

## 7. Análise de Aumento de Consciência

**Mapa de progressão Schwartz:**

| Fase | Nível esperado | O que o sistema faz |
|---|---|---|
| Entrada (Ato 1) | 2 (consciente do problema) | Segmenta corretamente ✓ |
| Atos 2-2.5 | 3 (consciente da solução) | Introduz mecanismo único ✓ |
| Ato 3 | 4 (produto apresentado) | WOW moment ✓ (com issue das aspas) |
| Atos 4-8 | 4+ (consciência aprofundada) | Amplifica features ✓ |
| Atos 9-12 | 5 (totalmente consciente, decisão) | Oferta + urgência ⚠️ |

**O que está faltando no nível 3 (consciente da solução):**

O sistema pula diretamente de "tenho problema com paquera digital" para "o MandaAssim resolve". Nunca aborda que as soluções existentes falham: perguntar pra amigo, usar ChatGPT genérico, contratar coach caro. Esse é o "gap de credibilidade" que Schwartz chama de "solução suspeita" — o cara que passou por divórcio já tentou várias coisas que não funcionaram. Ele é cético.

Os Atos 2 tocam no ChatGPT mas brevemente. Um ato ou trecho dedicado a "por que as outras soluções falharam" aumentaria dramaticamente a receptividade do mecanismo único.

**Microconceitos:**

"Leitura de Intenção" é introduzido no Ato 2 e reforçado nos Atos 3, 4, 5. Bom.

"Temperatura da Conversa" aparece no template do Ato 3 mas não é definido explicitamente para o usuário em nenhum ato narrativo. O usuário vê o termo mas não entende o framework.

"Hinge Penpal Trap" — não foi identificado nos atos analisados. Se existe no produto, não está na narrativa de venda.

---

## 8. Top Issues por Gravidade

### 🔴 CRÍTICO

**C1 — Ato 12 destrói urgência no gol**

- Ato afetado: act_12_ultima_chamada.md
- Issue: "Tá tudo certo qualquer caminho. Bora." reassegura o prospect que não comprar é OK, a 30min do fechamento
- Correção: ver reescrita na Seção 9

---

**C2 — Ato 3 entrega mensagem sugerida com aspas**

- Ato afetado: act_03_first_analysis_template.md
- Issue: `_"[TEXTO_RESPOSTA_SUGERIDA]"_` — aspas + itálico bloqueiam copy-paste limpo no WhatsApp
- Correção: ver reescrita na Seção 9

---

**C3 — Zero prova social em toda a sequência**

- Atos afetados: Ato 9, Ato 10, Ato 11
- Issue: Não há número de usuários, taxa de resultados, nem depoimento em nenhum ato. Para produto de relacionamento, onde o ceticismo é alto, isso é barreira de conversão.
- Correção imediata possível: No Ato 9, adicionar "Tu faz parte de [N_USERS] caras que usaram o MandaAssim esse mês." (mesmo que N seja pequeno — 50 já é prova social). No Ato 10, adicionar 1 depoimento específico.

---

**C4 — Ato 9 tem placeholder [IF_PRO_BLOCK] não verificado**

- Ato afetado: act_09_sumario_uso.md
- Issue: `[IF_PRO_BLOCK]` pode aparecer literalmente para o usuário se a engine não substituir corretamente
- Correção: verificar se templateVars em acts.js substitui esse placeholder. Se não, remover.

---

### 🟡 IMPORTANTE

**I1 — Nenhum ato de oferta tem PS**

- Atos afetados: act_10, act_11, act_12
- Issue: PS é o segundo elemento mais lido em copy DR. Ausência é oportunidade perdida
- Recomendação: ver PS sugerido na Seção 9

---

**I2 — Ancoragem do Parceiro (R$ 29,90) em pizza é fraca**

- Ato afetado: act_10_oferta.md
- Issue: "Menos que pizza grande" é clichê de copy barata. Anthropologically, não move o ICP do produto (homem 35-45 que paga R$ 800 num jantar sem pensar)
- Correção: "R$ 29,90 é menos que o Uber de volta pra casa depois da noite que não foi a lugar nenhum."

---

**I3 — Op3 do Ato 2 agita ansiedade sem empatia**

- Ato afetado: act_02_promessa_mecanismo_op3.md
- Issue: O cara em conversa quente já está ansioso. Começar com "Porque uma errada quebra tudo" aumenta ansiedade sem oferecer empathy first
- Correção: ver reescrita na Seção 9

---

**I4 — Reveals do Parceiro Pro durante o trial podem queimar o desejo**

- Atos afetados: act_06, act_07, act_08
- Issue: Se as features Pro estão realmente liberadas durante o trial, o usuário usa e sacia o desejo antes da oferta
- Verificar: as features Pro estão limitadas no trial ou abertas? Se abertas, considerar dar uma amostra (1 auditoria) e não acesso ilimitado

---

**I5 — Sem garantia explícita de resultado**

- Ato afetado: act_11_objecao_garantia.md
- Issue: "Cancela em 1 mensagem" é garantia de saída, não de resultado. Hopkins e Bencivenga sempre incluem pelo menos um período de satisfação garantida
- Recomendação: "Se em 7 dias você não achar que valeu, cancela e eu não pergunto o motivo."

---

**I6 — Ato 2 op4 tem erro gramatical**

- Arquivo: act_02_promessa_mecanismo_op4.md
- Issue: "qualquer ChatGPT que tu já testado" → deve ser "testou"
- Correção: editar linha

---

### 🟢 NICE TO HAVE

**N1 — "Temperatura da Conversa" nunca explicado explicitamente**

O framework "temperatura" aparece no Ato 3 mas não tem um momento de explicação. Um parágrafo no Ato 4 poderia introduzir: "Pensa numa escala: fria (sem interesse), morna (interesse cauteloso), quente (interesse real). Toda conversa tem uma temperatura. Saber ler é o que separa..."

---

**N2 — Ato 1 poderia ter hook antes da apresentação**

Em vez de "Sou o MandaAssim", começar com o problema: "Já ficou olhando pra mensagem dela por 20 minutos sem saber o que mandar?" Depois: "Sou o MandaAssim."

---

**N3 — Ato 5 Variant B tem "João" como persona de terceiro**

Halbert usava histórias sobre o próprio leitor, não sobre outro cara. Considerar adaptar pra segunda pessoa: "Imagina um cara com teu perfil, tua idade..."

---

**N4 — Ato 7 tem claim sem dado: "taxa de resposta muito maior"**

Se há dado real, use. Se não, remova o claim ou substitua por: "Na minha experiência com caras que fazem isso..."

---

## 9. Reescritas Sugeridas

### C1 — Ato 12: Última Chamada (reescrita completa)

**ANTES:**
```
*30 minutos.*

---

Em 30min teu trial vira free.

Se quiser continuar como tá:

👉 [LINK_PARCEIRO_PRO]

---

Senão, te vejo amanhã com 3 mensagens/dia.

*Tá tudo certo qualquer caminho.*

Bora.
```

**DEPOIS:**
```
*30 minutos.*

---

Em 30min tu volta pra 3 mensagens/dia.

Vai ter conversa nova hoje. Talvez já tenha.

Sem o Parceiro, quando ela responder, tu vai ter que esperar amanhã pra analisar. Ou arriscar sozinho.

---

Pra isso não acontecer:

👉 Parceiro: [LINK_PARCEIRO]

🚀 Parceiro Pro: [LINK_PARCEIRO_PRO]

---

_PS: Todo mês que passa sem isso, as conversas que tu vai ter sozinho vão ser sem leitura de intenção. Esse é o único custo real de não continuar._
```

---

### C2 — Ato 3: Texto sugerido sem aspas

**ANTES:**
```
*Manda assim:*

_"[TEXTO_RESPOSTA_SUGERIDA]"_
```

**DEPOIS:**
```
*Manda isso 👇*

[TEXTO_RESPOSTA_SUGERIDA]
```

Sem aspas. Sem itálico no texto. Isolado no próprio bloco. Copia em 1 toque.

---

### C3 — Ato 10: Ancoragem do Parceiro

**ANTES:**
```
*R$ 29,90/mês.*

Menos que pizza grande.
```

**DEPOIS:**
```
*R$ 29,90/mês.*

Menos que o Uber de volta de uma noite que não foi a lugar nenhum.
```

---

### I3 — Ato 2 op3: Abertura empática

**ANTES:**
```
Beleza.

*Tu tá no momento crítico.*

Conversa rolando, e cada mensagem importa.

Porque uma errada quebra tudo.
```

**DEPOIS:**
```
Beleza.

*Tu chegou onde poucos chegam — a conversa foi longe o suficiente pra importar.*

Isso é sinal bom.

E agora cada mensagem tem mais peso do que parecia.
```

---

### I5 — Ato 11: Garantia de resultado

**ANTES (objeção "R$ 79,90 é caro"):**
```
Tu já gastou R$ 79,90 essa semana em coisa que não te trouxe match nenhum.

Conta aí: jantar fora, Uber, app premium, drink.

Eu peço o equivalente a 1 dessas coisas — e te entrego o oposto:

*Resultado.*
```

**DEPOIS:**
```
Tu já gastou R$ 79,90 essa semana em coisa que não te trouxe match nenhum.

Uber depois de noite que não deu. App premium do Tinder que aumenta o alcance mas não muda a conversa.

R$ 79,90 comigo é diferente: se em 7 dias tu não achar que valeu, cancela. Não pergunto o motivo. Não tem ligação.

*O risco é R$ 0.*
```

---

### PS sugerido para Ato 10

Adicionar ao final de ambas as variantes:

```
---

_PS: O free tem limites porque free é pra quem ainda tá testando. Tu já testou 72h. Já sabe o que é. A decisão agora não é "vou testar?" — é "quero continuar tendo isso?"_
```

---

### Correção de erro gramatical — Ato 2 op4

**ANTES:** `qualquer ChatGPT que tu já testado`
**DEPOIS:** `qualquer ChatGPT que tu já testou`

---

## 10. Checklist de Testes Manuais

### Teste 1 — Aha moment completo (20min)
1. Cria conta nova (número diferente ou usa conta de teste)
2. Manda "oi"
3. Espera Ato 1 chegar (deve chegar em segundos)
4. Responde "3" (conversa quente)
5. Espera Ato 2 op3 chegar
6. Responde as 3 perguntas do diagnóstico
7. Espera Ato 2.5 (espelhamento) chegar
8. **Critério de pass:** ao ler o espelhamento, tu pensa "EXATO, é isso"? Ou parece genérico?
9. Manda um print real de conversa
10. **Critério de pass:** a análise chega sem aspas no texto sugerido? Consegue copiar em 1 toque?

---

### Teste 2 — Formatação das respostas (5min)
1. Manda "ela mandou 'oi sumido' depois de 5 dias"
2. Observa a resposta
3. **Critério de pass:** chegou em múltiplas mensagens com delay? Cada mensagem tem 1 ideia? Nenhum bloco gigante?
4. Se chegou como 1 bloco: falhou. O separador `---` não está sendo processado.

---

### Teste 3 — Limites do free (5min)
1. Com conta no plano free, manda 4 mensagens
2. **Critério de pass:** na 4ª, bot informa o limite com mensagem de upsell contextualizada (não robótica)
3. Avalia o tom da mensagem de limite: empático ou mecânico?

---

### Teste 4 — Welcome do Parceiro (10min)
1. Use o admin endpoint para setar plan='free' no teu número
2. Simule um pagamento via comando 'paguei' (precisa ter um pagamento pending no banco)
3. Ou: atualize plan='parceiro' diretamente no banco
4. Se via webhook: veja se chegaram as 5 mensagens com delay
5. **Critério de pass:** chegaram 5 mensagens separadas com 1.2-2.5s de delay? A sequência celebra a decisão?

---

### Teste 5 — Ato 9 com dados reais (10min)
1. Depois de usar o bot por 2-3h, espera o Ato 9 disparar (H+60) ou força manualmente via banco
2. **Critério de pass:** `[N_INTERACTIONS]`, `[N_PRINTS]`, `[N_PAPO]` foram substituídos por números reais?
3. `[IF_PRO_BLOCK]` desapareceu ou mostrou conteúdo relevante?
4. Se qualquer placeholder aparecer literalmente: bug crítico na engine de templates

---

### Teste 6 — Predate/Postdate ativos (5min)
1. Manda "tenho encontro sábado às 19h"
2. **Critério de pass:** bot inicia mini-entrevista do predate (pergunta lugar, horário, contexto)?
3. Manda "voltei do encontro, foi bem"
4. **Critério de pass:** bot inicia debrief (pergunta detalhes, analisa sinais)?
5. Se bot responder genericamente sem fluxo estruturado: ENABLE_PREDATE_COACH ou ENABLE_POSTDATE_DEBRIEF não está ativo

---

### Teste 7 — Urgência do Ato 12 (15min)
1. Seta trial_started_at = now() - interval '71 hours' no banco pra conta de teste
2. Espera até 15min (cron roda a cada 15min)
3. Quando Ato 12 chegar, avalia:
4. **Critério de pass:** tem urgência real? Não tem "tá tudo certo qualquer caminho"?
5. **Critério de fail (antes da correção):** texto atual vai passar, mas não converte

---

### Teste 8 — Ato 13 D+1 (5min)
1. Com conta free que já bateu o limite, espera o D+1
2. Ou: faz conta free, bate o limite, e verifica se Ato 13 dispara no dia seguinte
3. **Critério de pass:** "Sente a fricção?" chega? O link do Parceiro está no texto?

---

*Fim da auditoria.*  
*Duração estimada de todos os testes: ~70 minutos com um número de teste dedicado.*
