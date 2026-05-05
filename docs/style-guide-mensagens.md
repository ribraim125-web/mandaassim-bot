# Style Guide — Mensagens WhatsApp (MandaAssim)

> Princípio central: **WhatsApp não é email.**
> Cara lê em 3 segundos no banheiro. Bloco de 8 linhas força releitura.
> Sequência de mensagens curtas = ritmo de conversa + picos de dopamina.

---

## A regra de ouro

**UMA IDEIA POR MENSAGEM.**

| Tipo de conteúdo | É uma mensagem |
|-----------------|---------------|
| 1 pergunta | ✅ |
| 1 reflexão / observação | ✅ |
| 1 sugestão de ação | ✅ |
| 1 frase de transição | ✅ |
| Diagnóstico (📍) | ✅ |
| Análise (💡) | ✅ |
| 1 opção de resposta (🔥/😏/⚡) | ✅ |
| Pergunta + contexto + outra pergunta | ❌ |
| Lista de features + pitch + preço | ❌ |
| Análise + ações + avisos juntos | ❌ |

---

## Limites de linhas

| Medida | Valor |
|--------|-------|
| Ideal por mensagem | 2–4 linhas de conteúdo |
| Máximo absoluto | 6 linhas de conteúdo |
| Linhas em branco | Não contam — são respiração visual |

> **Nota**: "linha de conteúdo" = linha não-vazia. Linhas em branco entre frases curtas são estilísticas.

---

## O separador `---`

Todo arquivo `.md` de copy e toda resposta gerada dinamicamente usa `---` (três traços em linha própria) como separador de mensagens.

```
Mensagem 1 aqui.

---

Mensagem 2 aqui.

---

Mensagem 3 aqui.
```

O `copyLoader.js` parseia `.md` pelo separador `---`.
O `enviarResposta` em `index.js` chama `splitByDashes()` nas respostas dinâmicas.
O `sendWithDelay()` envia cada parte com 1.2–2.5s de delay.

---

## Exemplos

### ❌ Errado — paredão

```
Preciso saber mais contexto. Se ela está se fazendo difícil, significa seis coisas. Me diz: há quanto tempo vocês conversam, quem mandou mensagem por último, tu já tentou marcar encontro. Sem isso a resposta é chute. Manda aí.
```

### ✅ Certo — sequência

```
Espera.
```
```
"Se fazendo difícil" pode significar 6 coisas diferentes.
```
```
Cada uma pede uma jogada diferente.
```
```
Antes de eu chutar, me responde 3 coisas:
```
```
*1.* Há quanto tempo vocês conversam?
```
```
*2.* Quem mandou mensagem por último?
```
```
*3.* Tu já tentou marcar encontro?
```
```
Manda. Aí eu te falo.
```

---

### ❌ Errado — coaching paredão

```
Ela está testando você. Mulheres que somem depois de interações positivas geralmente estão verificando o nível de interesse. O que você deve fazer é esperar 2-3 dias e então mandar uma mensagem casual. Não mencione a ausência. Não pergunte o que aconteceu. Age como se a vida continuou normalmente. Isso demonstra que você não está ansioso.
```

### ✅ Certo — coaching em sequência

```
Ela não sumiu por falta de interesse.
```
```
*Ela está verificando se você vai cobrar.*
```
```
Cara ansioso cobra. Cara seguro age como se nada aconteceu.
```
```
*O que fazer:*
• Espera 2-3 dias
• Manda algo casual, sem referência ao sumiço
• Age como se a vida continuou normalmente
```

---

## Como adicionar a regra em novos prompts

Adiciona este bloco ao final do `=== FORMATO DE SAÍDA ===` de qualquer system prompt:

```
REGRA CRÍTICA DE FORMATAÇÃO: use `---` (três traços em linha própria) para separar cada bloco.
Cada bloco entre `---` = uma mensagem WhatsApp separada. UMA IDEIA POR BLOCO. Máx 4 linhas por bloco.
```

---

## Arquitetura de envio

```
Modelo gera resposta com --- → splitByDashes() → sendWithDelay(chatId, mensagens)
                                                         ↓
                                             1.2-2.5s entre cada mensagem
```

Funções relevantes em `index.js`:
- `splitByDashes(text)` — divide pelo separador
- `sendWithDelay(chatId, messages)` — envia com delay dopamínico
- `enviarResposta(message, sugestoes, intent, phone)` — handler principal

---

## Checklist antes de criar copy nova

- [ ] Cada bloco tem no máximo 1 ideia
- [ ] Cada bloco tem no máximo 6 linhas de conteúdo
- [ ] Perguntas estão em blocos separados (cada pergunta = 1 mensagem)
- [ ] Listas com ✓/✗ têm máx 6 itens por bloco
- [ ] Preço/pitch separado das features por `---`
- [ ] Blocos separados por `---` em linha própria
