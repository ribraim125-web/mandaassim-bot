# Spike: Vision Features — Validação de Viabilidade

**Branch:** `spike/vision-features`  
**Script:** `scripts/spike-vision.js`

## Objetivo

Validar antes de implementar em produção:
- Haiku 4.5 vision consegue parsear perfis de apps de relacionamento e retornar JSON estruturado
- Latência P95 < 10s por análise
- Custo médio < R$0,30 por análise

Se o spike **não passar**, não prosseguir com as features de produção.

---

## Como rodar

### Pré-requisitos

```bash
# .env deve ter:
ANTHROPIC_API_KEY=sk-ant-...
```

### Modo single — uma imagem por vez

```bash
node scripts/spike-vision.js --type perfil_meu  --image /caminho/para/perfil.jpg
node scripts/spike-vision.js --type perfil_dela --image /caminho/para/perfil.jpg
```

### Modo batch — pasta com subpastas

```bash
node scripts/spike-vision.js --batch ./scripts/spike-images/
```

Estrutura esperada:
```
scripts/spike-images/
  perfil_meu/     # 5 prints do perfil próprio (bom, mediano, ruim, selfie, atividade)
  perfil_dela/    # 5 prints de perfis dela (tinder, bumble, hinge, instagram, variados)
```

---

## Critérios de aprovação

| Métrica       | Limite       |
|---------------|-------------|
| Latência P95  | < 10.000ms  |
| Custo médio   | < R$0,30    |
| JSON válido   | 100%        |

---

## Resultados

Resultados salvos em `docs/features-pro/spike-results.json` após cada execução.

---

## JSON de saída esperado

### perfil_meu

```json
{
  "platform_detected": "tinder",
  "photos_analyzed": [
    {
      "position": 1,
      "type": "selfie",
      "verdict": "replace",
      "rationale": "luz ruim, expressão fechada",
      "specific_feedback": "tira em ambiente natural com luz natural, sorrindo"
    }
  ],
  "bio_analysis": {
    "current_text": "Engenheiro. Amo viajar e cozinhar.",
    "verdict": "bad",
    "issues": ["genérico", "não diz nada específico"],
    "rewritten_suggestion": "Cozinho melhor do que a maioria dos restaurantes aqui da cidade. Ainda não provei."
  },
  "ordering_advice": "Coloca a foto de atividade primeiro — mostra quem você é.",
  "missing_elements": ["foto sorrindo", "foto de atividade"],
  "overall_verdict": "Perfil funcional mas genérico. As mudanças são simples e o impacto é alto.",
  "top_3_changes": [
    "Troca a foto 1 por uma com luz natural e sorrindo",
    "Reescreve a bio — específico bate genérico sempre",
    "Coloca foto em atividade (esporte, cozinha, trilha) como foto 2"
  ]
}
```

### perfil_dela

```json
{
  "platform": "tinder",
  "name_detected": "Ana",
  "age_detected": "28",
  "bio_text": "apaixonada por café e trilhas 🏔️",
  "interests_detected": ["café", "trilhas", "viagens"],
  "photos_themes": ["natureza", "viagem"],
  "personality_signals": ["aventureira", "tranquila"],
  "potential_hooks": [
    {
      "hook": "qual foi a trilha mais difícil que você fez?",
      "rationale": "abre a foto de montanha — específico do que ela mostrou"
    }
  ],
  "risks_to_watch": ["bio muito curta — não dá muito pra trabalhar"],
  "recommended_first_message": {
    "soft_curious": "qual foi a trilha mais difícil que você fez?",
    "playful_clever": "café antes ou depois da trilha? pergunta importante.",
    "direct_charming": "alguém que trilha e toma café sério. já tenho respeito."
  },
  "what_NOT_to_send": [
    "oi, tudo bem? — parece robô",
    "que perfil lindo — genérico e ansioso"
  ]
}
```
