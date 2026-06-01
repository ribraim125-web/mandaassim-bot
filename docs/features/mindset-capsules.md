# Camada 6 — Cápsulas de Mindset Opt-In

## Visão Geral

Sistema proativo de envio de cápsulas curtas de mindset para usuários Wingman Pro que optaram voluntariamente. Conteúdo 100% curado por humano — o bot só seleciona/prioriza, nunca gera.

**Regra absoluta: bot NUNCA empurra cápsula sem opt-in explícito do usuário.**

## Diferença vs Camadas 1–5

Camadas 1-5 são **reativas**: usuário traz situação, bot responde.
Camada 6 é **proativa**: bot manda conteúdo opt-in regular no horário configurado.

## Acesso

**EXCLUSIVO Wingman Pro.** Sem versão limitada ou upsell visível para Free/Premium.

## Fluxo Completo

```
Pro user com 14+ dias de assinatura
    ↓
Bot envia convite (1x, na próxima interação após 14 dias)
    ↓
Usuário responde SIM → ativado (3x/semana, Seg/Qua/Sex, 9h BRT)
Usuário responde NÃO → arquivado (não pergunta por 90 dias)
    ↓
Worker (30min) verifica: dia certo + hora certa + não enviou hoje
    ↓
Seleciona cápsula priorizada pelo contexto do usuário
    ↓
Envia + registra em mindset_deliveries
```

## Categorias (10 categorias × 10 cápsulas = 100 total)

| Categoria | Descrição |
|-----------|-----------|
| `postura_masculina_madura` | Como agir com presença, sem precisar de aprovação |
| `lidar_com_rejeicao` | Rejeição como dado, não como definição |
| `construir_abundancia` | Ter opções vs precisar daquela |
| `honestidade_emocional` | Compartilhar sem despejar |
| `identidade_pos_divorcio` | Quem você é depois do casamento |
| `equilibrio_paquera_vida` | Paquera é parte da vida, não a vida |
| `ler_intencao_dela` | Distinguir interesse real de educação |
| `boundaries_saudaveis` | Limite como postura, não punição |
| `quando_insistir_soltar` | 2 tentativas é o suficiente |
| `auto_percepcao` | Identificar seus próprios padrões |

## Tom das Cápsulas

### O que é ✅
- Amigo mais velho que viu coisas, fala franco
- 1-3 frases diretas, pé-no-chão
- Pode ter pergunta reflexiva no final
- Sem CTA de produto
- Sem emoji excessivo

### O que NÃO é ❌
- Self-help cringe ("acredite em você!")
- Alpha tóxico ("dominate, alpha frame")
- Pickup artist ("inner game, IOI, frame")
- Terapia barata ("respira fundo, criança interior")
- Misoginia disfarçada de conselho

### Exemplo bom
> "Quando ela demora pra responder, isso normalmente não é sobre você. Pessoas têm vida — trabalho, problema, distração. Não monta novela na sua cabeça enquanto espera. Vai viver a sua. Quando ela responder, tu responde."

### Exemplo ruim (NUNCA fazer)
> "Você é o prêmio. Ela tá com sorte de te conhecer. Não chase, faça ela chase você. ALPHA MENTALITY 🦁"

## Curadoria Obrigatória

**NÃO deixar Haiku/AI gerar cápsulas livremente.**

1. Rafa escreve (ou revisa) cada cápsula pessoalmente
2. 30 cápsulas seed já no banco (3/categoria) — para teste
3. Completar para 100 antes do lançamento geral
4. Bot só faz seleção/priorização inteligente

## Priorização por Contexto

O worker analisa o histórico do usuário para priorizar a categoria mais relevante:

| Sinal detectado | Categoria priorizada |
|-----------------|---------------------|
| 2+ debriefs "poor/neutral" recentes | `lidar_com_rejeicao` |
| Outcome "rejected" no transition coach | `lidar_com_rejeicao` |
| Outcome "never_responded" no transition coach | `quando_insistir_soltar` |
| Sem sinal claro | Round-robin por categoria menos enviada |

## Comandos WhatsApp

| Comando | Ação |
|---------|------|
| `ativar mindset` | Opt-in manual |
| `cancelar mindset` / `pausar mindset` | Opt-out |
| `mindset` | Ver status atual |
| `mindset 1x` | 1 cápsula/semana (Seg) |
| `mindset 3x` | 3/semana — Seg/Qua/Sex (padrão) |
| `mindset 5x` | 5/semana — dias úteis |
| `mindset diário` | Todos os dias |

## Frequências

| Opção | Dias |
|-------|------|
| 1x/semana | Segunda |
| 3x/semana | Seg, Qua, Sex |
| 5x/semana | Seg a Sex |
| Diário | Todos os dias |

Horário padrão: 9h BRT. Configurável via `schedule_hour` no banco.

## Feature Flag

```
ENABLE_MINDSET_CAPSULES=false    # desabilitado (padrão)
ENABLE_MINDSET_CAPSULES=test     # só MINDSET_CAPSULES_TEST_PHONE
ENABLE_MINDSET_CAPSULES=all      # todos os Pro
```

Sem `beta` — lança direto para todos os Pro após 100 cápsulas curadas.

## Banco de Dados

### Tabelas

**`mindset_capsules`** — conteúdo curado
- `id`, `category`, `body`, `is_active`, `display_order`, `created_at`

**`mindset_opt_ins`** — estado de opt-in por usuário
- `phone` (PK), `enabled`, `frequency`, `schedule_days[]`, `schedule_hour`
- `first_pro_at`, `invite_sent_at`, `invite_declined_at`, `opted_in_at`, `opted_out_at`

**`mindset_deliveries`** — log de entregas
- `id`, `phone`, `capsule_id` (FK), `category`, `sent_at`

Migration: `migrations/009_mindset_capsules.sql`

## Critérios de Aceite (pré-lançamento)

- [ ] 100 cápsulas no banco, revisadas por Rafa
- [ ] Opt-in flow testado com 5 usuários reais
- [ ] Worker testado com `ENABLE_MINDSET_CAPSULES=test`
- [ ] Confirmar que convite chega exatamente 14 dias após Pro ativar
- [ ] Confirmar que `cancelar mindset` funciona no mesmo dia
- [ ] Métrica: % de Pro users que mantêm opt-in ativo após 30 dias > 40%

## Roadmap Futuro (não implementar agora)

- Cápsulas em formato áudio (voz do Rafa)
- Cápsulas semanais temáticas (5 dias, mesma categoria, profundidade)
- Painel de administração para adicionar/editar cápsulas sem deploy
- Feedback do usuário: 👍 / comentário após cápsula
- Cápsulas adaptadas ao dia da semana (segunda = motivação, sexta = saída)
