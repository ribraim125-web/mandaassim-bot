# Auditoria MandaAssim — 2026-05-03


## 📌 Resumo Executivo

- 🚨 Base premium muito pequena (1 usuarios) — receita mensal de ~R$30

- ⚠️  Conversão demorada: média de 10.4 dias para assinar

- ⚠️  56% dos usuários inativos há >7 dias — problema de retenção

- 💰 Custo estimado de IA nos últimos 30 dias: R$0.89 (247 msgs, ~R$0.05/usuário ativo/mês)

- 📊 247 msgs em 30 dias | 19 usuários ativos no mês | 17 na semana | 1 hoje


> ⚠️  **Atenção:** distribuição de intents, modelos usados e tokens são **estimativas** — não há tracking em banco. Seções marcadas com `[ESTIMATIVA]` usam médias assumidas. Ver seção "O que precisa ser instrumentado" ao final.


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


**Mensagens por fase (últimos 30 dias):**


| Fase | Msgs 7d | Msgs 30d |

|------|---------|---------|

| Trial (dias 1-3, ilimitado) | 36 | 36 |

| Free 10/dia (dias 4-5) | 27 | 27 |

| Free 3/dia (dia 6+) | 134 | 160 |

| Premium ativo | 22 | 24 |

| Premium expirado/cancelado | 0 | 0 |


## 3. Engajamento — DAU / WAU / MAU

| Métrica | Valor |

|---------|-------|

| DAU (ativos hoje) | 1 |

| WAU (ativos nos últimos 7 dias) | 17 |

| MAU (ativos nos últimos 30 dias) | 19 |

| Usuários inativos >7 dias | 22 (56% da base) |

| Premium engajados (>5 msgs/semana) | 1 de 1 |


## 4. Conversão Free → Premium

| Janela | Usuários na coorte | Converteram | Taxa |

|--------|-------------------|------------|------|

| Últimos 30 dias | 39 | 2 | 2.6% |

| Últimos 60 dias | 39 | 2 | 2.6% |

| Últimos 90 dias | 39 | 2 | 2.6% |


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


## 5. Churn Premium

| Métrica | Valor |

|---------|-------|

| Premium ativos | 1 |

| Premium expirados/cancelados | 0 |

| Total que já foram premium | 1 |

| Taxa de churn histórica | 0.0% |


## 6. Custo Estimado de IA `[ESTIMATIVA]`

> Sem tracking real de tokens/modelo — custo calculado com distribuição de intents assumida (one_liner: 25%, volume: 40%, premium: 20%, coaching: 10%, ousadia: 5%) e tokens médios por tipo de chamada.


| Período | Msgs | Custo USD | Custo BRL |

|---------|------|-----------|-----------|

| Últimos 7 dias  | 219  | $0.1363  | R$0.79  |

| Últimos 30 dias | 247 | $0.1538 | R$0.89 |


**Custo médio por usuário ativo/mês:** R$0.05


**Projeção se base dobrar/triplicar:**


| Cenário | Msgs/mês estimadas | Custo IA/mês |

|---------|-------------------|-------------|

| Atual   | 247 | R$0.89 |

| 2× base | 494 | R$1.78 |

| 3× base | 741 | R$2.68 |


## 7. O Que Não Temos Rastreado


As seções abaixo do briefing original **não podem ser respondidas** com os dados atuais:


| Dado solicitado | Status | Como instrumentar |

|----------------|--------|------------------|

| Distribuição por intent (one_liner/volume/premium/ousadia) | ❌ Não rastreado | INSERT em `api_requests` com campo `intent` |

| Modelo efetivamente chamado | ❌ Não rastreado | INSERT em `api_requests` com campo `model_used` |

| Tokens input/output/cache por chamada | ❌ Não rastreado | INSERT em `api_requests` com `tokens_in`, `tokens_out`, `cache_read`, `cache_write` |

| Cache hit rate do Haiku | ❌ Não rastreado | Derivado de `cache_read / tokens_in` na tabela acima |

| Fallbacks acionados | ❌ Não rastreado | Campo `fallback_used BOOLEAN` na tabela acima |

| Tier de degradação acionando | ❌ Não rastreado | Campo `tier_used TEXT` em `api_requests` |

| Horário das mensagens | ❌ Não rastreado | Tabela `api_requests` com `created_at TIMESTAMPTZ` |

| Tamanho médio input/output | ❌ Não rastreado | Campos `input_chars`, `output_chars` |

| Feedback do usuário (gostou/não gostou) | ❌ Só RAM | Persistir em tabela |


## 8. Sinais de Alerta e Oportunidades


⚠️  **Muitos em trial, poucos convertendo:** 15 em trial vs 1 premium. Oportunidade de upsell mais agressivo no dia 2-3 do trial.

💡 **Sem observabilidade de IA:** sem saber quais modelos estão sendo chamados, não dá pra otimizar custo. Instrumentar `api_requests` deve ser prioridade.

💡 **Prompt caching do Haiku não verificável:** a economia estimada não pode ser confirmada sem logging de tokens. Pode estar funcionando ou não — não sabemos.


---

_Relatório gerado em 2026-05-03T12:20:59.647Z | Dados reais: users, daily_message_counts, payments | Seções com [ESTIMATIVA] usam médias assumidas_
