# Audit — Aspas e Formato nos Arquivos .md

> Data: 2026-05-05
> Escopo: `docs/narrative/acts/` + `docs/narrative/variants/`
> Critério: identificar aspas em mensagens que o usuário deve copiar (violação) vs. aspas narrativas (OK)

---

## Resultado Geral

**Todos os arquivos .md estão OK.** Nenhuma violação das 4 Propriedades Sagradas foi encontrada.

---

## O que foi analisado

Dois tipos de aspas existem no copy:

### Tipo A — Aspas Narrativas (✅ OK, não são mensagens a copiar)

São aspas dentro do texto de copy do bot que ilustram situações ou pensamentos. O usuário NÃO as copia — são parte do storytelling.

Exemplos encontrados:

| Arquivo | Linha | Conteúdo | Diagnóstico |
|---------|-------|----------|-------------|
| `act_02_op4.md` | 11 | `_"o que isso significa?"_` | Pensamento imaginado — narrativa |
| `act_04_reveal_papo.md` | 18 | `_"tá tudo bem?"_` | Exemplo de mensagem a NÃO mandar |
| `act_04_reveal_papo.md` | 26-30 | `_"ela não responde..."_` | Exemplos de situações do user |
| `act_05_identificacao.md` | 16 | `_"kk"_` | Citação de mensagem dela |
| `act_06_reveal_audit.md` | 52-54 | `_"ah, tá bonito"_ / _"essa foto 3 sai"_` | Contraste narrativo |
| `act_07_reveal_analise.md` | 10-50 | `_"oi tudo bem"_` / `_"oi linda"_` | Exemplos negativos (o que NÃO mandar) |
| `act_08_reveal_predate.md` | 20 | `_"tenho encontro sábado."_` | Exemplo de trigger de ativação |
| `act_11_objecao_garantia.md` | 8-44 | `_"E se não funcionar?"_` | Objeções do user (FAQ format) |
| `act_06_variant_b.md` | 48-52 | `_"Foto 1: pose travada..."_` | Exemplo de feedback técnico |
| `act_05_variant_b.md` | 29 | `_"kk"_` | Citação de mensagem dela |

**Padrão comum:** todas as aspas nos .md estão dentro de `_italic_` e representam falas/exemplos dentro do copy, não mensagens que o user vai copiar para o match.

### Tipo B — Mensagens Sugeridas a Copiar (verificadas ✅)

Os arquivos .md **não têm** mensagens sugeridas para o user copiar com aspas duplas ou simples. As mensagens prontas que aparecem são sempre em blocos limpos:

- `act_06_variant_b.md` — os exemplos de feedback (`_"Foto 1: pose travada"_`) são feedback técnico do MandaAssim sobre o perfil, não mensagens que o user copia para o match.
- `act_08_reveal_predate.md` — nenhuma mensagem sugerida com aspas.
- `act_10_oferta.md` — nenhuma mensagem sugerida com aspas.

---

## Onde as violações estavam (já corrigidas no código)

As violações eram exclusivamente nos formatadores de lib, não nos arquivos .md:

| Arquivo | Linha original | Tipo | Status |
|---------|---------------|------|--------|
| `src/lib/predateCoach.js` | 260 | `"${postMsg}"` | ✅ Corrigido |
| `src/lib/postdateDebrief.js` | 339-347 | `"${sugestoes.*}"` | ✅ Corrigido |
| `src/lib/transitionCoach.js` | 286 | `"${sugestao}"` | ✅ Corrigido |
| `src/lib/printAnalysis.js` | 182 | `"${sugestao}"` | ✅ Corrigido |
| `src/lib/profileAnalysis.js` | 187 | `"${sugestao}"` | ✅ Corrigido |
| `src/lib/profileAnalysis.js` | 199-200 | `"${softCurious}"` | ✅ Corrigido |
| `src/lib/profileSelfAudit.js` | 184 | `"${bio.rewritten_suggestion}"` | ✅ Corrigido |

---

## Monitoramento contínuo

Violações futuras são detectadas automaticamente por:

- **`src/lib/messageFormatValidator.js`** — valida cada array de mensagens antes do envio
- **`migrations/017_format_violations.sql`** — persiste violações no Supabase para análise
- **`scripts/test-message-paste-format.js`** — suite de testes E2E que roda por intent

Para checar se algum prompt regrediu:
```sql
SELECT intent, violation_type, COUNT(*), MAX(created_at)
FROM format_violations
GROUP BY intent, violation_type
ORDER BY COUNT(*) DESC;
```

---

## Checklist para novos arquivos .md

Quando criar copy nova em `docs/narrative/`:

- [ ] Mensagens que o user copia ficam em bloco próprio (separadas por `---`)
- [ ] ZERO `"aspas"` envolvendo uma mensagem copiável
- [ ] ZERO `emoji + "aspas"` na mesma linha
- [ ] Aspas narrativas (exemplos, pensamentos) devem sempre usar `_italic_` para diferenciar
