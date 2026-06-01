# Auditoria MandaAssim — 2026-05-03 (v2)


## 🔧 Correções vs versão anterior (v1)


Três bugs foram identificados e corrigidos nesta versão:


**Bug 1 — Inatividade incluía usuários novos (corrigido)**

Na v1, "% inativos há +7 dias" dividia pelo total de usuários incluindo os cadastrados há menos de 7 dias. Um usuário que entrou ontem era contado como inativo. A métrica agora só considera a base elegível: usuários com `created_at <= hoje - 7 dias`.


**Bug 2 — Taxa de conversão subestimada (corrigido)**

Na v1, a tabela de conversão por janela filtrava pagamentos por data (`payment.created_at >= janela`), o que excluía usuários que entraram recentemente mas pagaram antes. Agora filtramos apenas por data de cadastro do usuário.


**Bug 3 — Mensagens por fase usava fase atual, não histórica (corrigido)**

Na v1, um usuário que enviou mensagens durante o trial mas hoje está no `free_3` tinha todas as mensagens contadas como `free_3`. Agora a fase é calculada com base na idade do usuário na data de cada mensagem.


**Métricas novas adicionadas:** Ativação D1, Ativação D7, Retenção W2, Retenção M1 — todas com base elegível correta.


---


## 📌 Resumo Executivo

- 🚨 Base premium muito pequena (1 usuário(s)) — receita mensal de ~R$30

- ⚠️  Ativação D1 baixa: apenas 10.3% ativaram no primeiro dia

- 🚨 Retenção W2 crítica: apenas 0.0% ainda usavam na segunda semana

- 💰 Custo estimado de IA nos últimos 30 dias: R$0.89 (247 msgs, ~R$0.05/usuário ativo/mês)

- 📊 247 msgs em 30 dias | 19 usuários ativos no mês | 17 na semana | 1 hoje


> ⚠️  **Atenção:** distribuição de intents e tokens continuam sendo **estimativas** — tracking real começou hoje (tabela `api_requests`). Seções marcadas com `[ESTIMATIVA]` usam médias assumidas.


## 1. Distribuição de Usuários por Estado

**Total de usuários cadastrados:** 39


| Fase | Usuários | % do total |

|------|----------|-----------|

| Trial (dias 1-3, ilimitado) | 15 | 38.5% |

| Free 10/dia (dias 4-5) | 15 | 38.5% |

| Free 3/dia (dia 6+) | 8 | 20.5% |

| Premium ativo | 1 | 2.6% |

| Premium expirado/cancelado | 0 | 0.0% |


**Usuários novos por dia — últimos 30 dias:**


| Data | Novos usuários |

|------|---------------|

| 2026-04-09 | 1 |

| 2026-04-10 | 1 |

| 2026-04-13 | 1 |

| 2026-04-15 | 1 |

| 2026-04-18 | 1 |

| 2026-04-21 | 1 |

| 2026-04-24 | 1 |

| 2026-04-25 | 1 |

| 2026-04-28 | 1 |

| 2026-04-29 | 8 |

| 2026-04-30 | 11 |

| 2026-05-01 | 8 |

| 2026-05-02 | 3 |


## 2. Volume de Mensagens

| Período | Total msgs | Usuários ativos |

|---------|-----------|----------------|

| Últimos 7 dias  | 219  | 17 |

| Últimos 30 dias | 247 | 19 |


**Mensagens por fase — fase na data da mensagem `[BUG 3 CORRIGIDO]`:**


| Fase | Msgs 7d | Msgs 30d |

|------|---------|---------|

| Trial (dias 1-3, ilimitado) | 147 | 166 |

| Free 10/dia (dias 4-5) | 47 | 52 |

| Free 3/dia (dia 6+) | 3 | 6 |

| Premium ativo | 22 | 23 |

| Premium expirado/cancelado | 0 | 0 |


## 3. Engajamento — DAU / WAU / MAU

| Métrica | Valor |

|---------|-------|

| DAU (ativos hoje) | 1 |

| WAU (ativos nos últimos 7 dias) | 17 |

| MAU (ativos nos últimos 30 dias) | 19 |

| Base elegível para inatividade (idade ≥ 7 dias) | 8 usuários |

| Inativos há >7 dias (base elegível) `[BUG 1 CORRIGIDO]` | 4 (50.0%) |

| Inativos há >7 dias (% da base total) `[v1 — referência]` | 22 (56%) |

| Premium engajados (>5 msgs/semana) | 1 de 1 |


## 4. Funil de Ativação e Retenção `[NOVO]`


| Métrica | Base elegível | Ativados/Retidos | Taxa |

|---------|--------------|-----------------|------|

| Ativação D1 (mandou msg no D0 ou D1) | 39 usuários (idade ≥ 1 dia) | 4 | 10.3% |

| Ativação D7 (mandou msg nos primeiros 7 dias) | 8 usuários (idade ≥ 7 dias) | 5 | 62.5% |

| Retenção W2 (ativo entre D7 e D14) | 5 usuários (idade ≥ 14 dias) | 0 | 0.0% |

| Retenção M1 (ativo entre D21 e D30) | 0 usuários (idade ≥ 30 dias) | 0 | N/A% |


> ⚠️  **Amostra pequena:** base de usuários ainda jovem. W2 e M1 terão mais significância com ≥20 usuários elegíveis cada.


## 5. Conversão Free → Premium `[BUG 2 CORRIGIDO]`

| Janela de cadastro | Usuários | Converteram | Taxa |

|-------------------|----------|------------|------|

| Últimos 30 dias | 39 | 1 | 2.6% |

| Últimos 60 dias | 39 | 1 | 2.6% |

| Últimos 90 dias | 39 | 1 | 2.6% |


| Métrica | Valor |

|---------|-------|

| Tempo médio até conversão | 10.4 dias |

| Msgs médias antes de converter | 9 |

| Total de pagamentos aprovados | 4 |

| Total de pagamentos pendentes | 0 |

| Total de pagamentos rejeitados | 0 |


**Em qual fase do funil converteu:**


| Fase | Conversões |

|------|-----------|

| No trial (dias 1-3) | 1 |

| Free 10/dia (dias 4-5) | 0 |

| Free 3/dia (dia 6+) | 1 |


## 6. Churn Premium

| Métrica | Valor |

|---------|-------|

| Premium ativos | 1 |

| Premium expirados/cancelados | 0 |

| Total que já foram premium | 1 |

| Taxa de churn histórica | 0.0% |


## 7. Custo Estimado de IA `[ESTIMATIVA]`

> Tracking real ativo a partir de hoje na tabela `api_requests`. Valores abaixo são estimativas por distribuição assumida de intents.


| Período | Msgs | Custo USD | Custo BRL |

|---------|------|-----------|-----------|

| Últimos 7 dias  | 219  | $0.1363  | R$0.79  |

| Últimos 30 dias | 247 | $0.1538 | R$0.89 |


**Custo médio por usuário ativo/mês:** R$0.05


## 8. Sinais de Alerta e Oportunidades


⚠️  **Ativação D1 baixa (10.3%):** muitos se cadastram mas não usam no primeiro dia. Welcome message pode não estar convertendo.

🚨 **Retenção W2 crítica (0.0%):** quase ninguém volta na segunda semana. O produto resolve o problema pontual mas não cria hábito.

⚠️  **15 em trial vs 1 premium:** oportunidade de upsell mais agressivo no D2-D3 do trial.


---

_Relatório v2 gerado em 2026-05-03T13:33:45.718Z | Dados reais: users, daily_message_counts, payments | Seções [ESTIMATIVA] usam médias assumidas_
