# Audit — Quebra de Mensagens (Message Breaks)
**Data:** 2026-05-05
**Critério:** máx 6 linhas de conteúdo por bloco; máx 1 ideia por mensagem WhatsApp; usa `---` como separador.

---

## Resumo executivo

| Arquivo | Status | Problema |
|---------|--------|---------|
| act_01_hook_diagnostico.md | ✅ OK | Blocos bem divididos (linhas em branco = respiração, não paredão) |
| act_02_promessa_mecanismo_op1.md | ✅ OK | 3–4 linhas de conteúdo por bloco |
| act_02_promessa_mecanismo_op2.md | ✅ OK | 3–4 linhas de conteúdo por bloco |
| act_02_promessa_mecanismo_op3.md | ✅ OK | 3–4 linhas de conteúdo por bloco |
| act_02_promessa_mecanismo_op4.md | ✅ OK | 3–4 linhas de conteúdo por bloco |
| act_03_first_analysis_template.md | ✅ OK | Sufixo curto |
| act_04_reveal_papo.md | ✅ OK | Blocos curtos com respiração |
| act_05_identificacao_amplificada.md | ✅ OK | Blocos intencionalmente curtos (Schwartz) |
| act_06_reveal_audit.md | ⚠️ CORRIGIDO | 3 blocos com 6–9 linhas de conteúdo |
| act_07_reveal_analise_dela.md | ⚠️ CORRIGIDO | 2 blocos com 6–7 linhas de conteúdo |
| act_08_reveal_predate.md | ⚠️ CORRIGIDO | Checklist de 6 ✓ items sem divisão |
| act_09_sumario_uso.md | ✅ OK | Blocos curtos |
| act_10_oferta.md | ❌ CORRIGIDO | CAMINHO 1/2/3 com 9+ linhas de conteúdo |
| act_11_objecao_garantia.md | ✅ OK | Cada FAQ é 1 bloco, 4–5 linhas |
| act_12_ultima_chamada.md | ✅ OK | Urgência curta |
| act_13_reoferta_d1.md | ✅ OK | Blocos curtos |
| act_05_variant_b.md | ✅ OK | Blocos ok |
| act_06_variant_b.md | ⚠️ CORRIGIDO | 2 blocos com 8–9 linhas |
| act_10_variant_b.md | ⚠️ CORRIGIDO | CAMINHO block com 9+ linhas |

---

## Problemas identificados

### act_10_oferta.md — CRÍTICO
Cada CAMINHO (plano) tem 9–11 linhas de conteúdo em um único bloco.
- CAMINHO 1: título + "Tu continua com limites" + 3 itens ✗ + pitch = 8 content lines
- CAMINHO 2: título + "Tudo que tu já usou" + 3 itens ✓ + preço + pitch = 9 content lines
- CAMINHO 3: título + "Tudo do Parceiro +" + 4 itens ✓ = 7 content lines

**Fix:** Separar features do pitch dentro de cada CAMINHO.

### act_06_reveal_audit.md
- Bloco "Pensa: / Tu tá conseguindo match suficiente? / Quantas...": 3 perguntas embutidas
- Bloco "No teu trial, agora...": 6 linhas listando features
- Bloco "Não é 'ah tá bonito' / É 'essa foto 3 sai'...": 3 linhas OK

### act_08_reveal_predate.md
- Bloco checklist "Eu te preparo: ✓ O que vestir / ✓ Sobre o que falar..." — 6 itens sem intro separada

### act_06_variant_b.md
- Bloco "Não é 10 segundos. Não é 5. *Um.*..." — 8+ linhas
- Bloco "No teu trial agora..." — 7+ linhas

### act_07_reveal_analise_dela.md
- Bloco "Eu leio: ✓ O que ela curte / ✓ O que as fotos comunicam..." — 6 itens
- Bloco "E te entrego *a primeira mensagem*..." — 5 linhas OK

---

## Problemas nos prompts dinâmicos (MAIOR IMPACTO)

Os arquivos .md são usados pelos atos proativos (desabilitados por default).
O impacto REAL está nos system prompts que geram respostas dinâmicas:

| Prompt | Problema | Fix |
|--------|---------|-----|
| `SYSTEM_PROMPT_COACH` (index.js) | `corpo` enviado como bloco único de 8–10 linhas | Adicionar `---` no format spec; split em `enviarResposta` |
| `SYSTEM_PROMPT` full/premium | `📍 + 💡` combinados numa mensagem; `💡` pode ser 3–4 linhas | Separar 📍 e 💡 em mensagens distintas |
| Loops de envio (index.js) | `for (const m of msgs) await client.sendMessage(...)` sem delay | Substituir por `sendWithDelay()` |

---

## Notas sobre "linhas em branco"

Linhas em branco entre frases curtas no WhatsApp **não são paredão** — são respiração visual.
```
Tudo mudou.

Os apps mudaram.

E ninguém te avisou.
```
Isso são 3 mensagens curtas num bloco coeso. ✅

Paredão real é:
```
Tu tá nos apps mas as conversas morrem antes de ir a lugar algum, isso é clássico. Eu funciono diferente. ChatGPT te dá uma resposta. Eu faço Leitura de Intenção primeiro — entendo o que ela quis dizer com aquela mensagem antes de sugerir o que responder. A conversa avança quando a resposta é certa pra aquele momento. Não quando é boa no geral.
```
Isso é o problema a evitar. ❌
