# Planos MandaAssim

> Referência definitiva do sistema de planos atual.

---

## Os 4 Planos

| Plano | Preço | Mensagens | Print Analysis | Profile Analysis | Coaching (3/4/5) |
|-------|-------|-----------|----------------|------------------|------------------|
| **Trial** | Grátis | Ilimitado (3 dias) | 1/dia | ✗ | ✗ |
| **Free** | Grátis | 3/dia | ✗ | ✗ | ✗ |
| **Wingman** | R$29,90/mês · R$299/ano | Ilimitado | 5/dia | ✗ | 2 sessões/mês (C3) · 1/mês (C4, C5) |
| **Wingman Pro** | R$79,90/mês | Ilimitado | 5/dia | 10/dia | Ilimitado |

### Plano 24h
- R$4,99 — acesso Wingman por 24 horas
- Útil para conversas pontuais

### Win-back
- R$19,90 — primeiro mês Wingman para ex-assinantes (janela 2–15 dias após expirar)

---

## Valores no Banco (`users.plan`)

| Valor | Significado |
|-------|-------------|
| `trial` | Usuário novo, dentro dos 3 dias gratuitos |
| `free` | Pós-trial sem upgrade, ou trial expirado |
| `wingman` | Assinante Wingman com plano ativo |
| `wingman_pro` | Assinante Wingman Pro com plano ativo |

**Transição trial→free:** ocorre lazily na primeira mensagem após `created_at + 3 dias`.

---

## Colunas Relevantes em `users`

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `plan` | TEXT | Plano atual (ver tabela acima) |
| `plan_expires_at` | TIMESTAMPTZ | Expiração do plano pago (null = vitalício) |
| `trial_started_at` | TIMESTAMPTZ | Data de cadastro (= início do trial) |
| `trial_ended_at` | TIMESTAMPTZ | Data em que o trial expirou |
| `plan_started_at` | TIMESTAMPTZ | Data de início do plano atual |
| `winback_unlock_at` | TIMESTAMPTZ | Data de desbloqueio da oferta win-back |
| `renewal_notified` | BOOL | Já enviou aviso de renovação |

---

## Limites de Features (`src/config/features.js`)

| Feature Key | Trial | Free | Wingman | Wingman Pro |
|-------------|-------|------|---------|-------------|
| `messages` | ∞ | 3/dia | ∞ | ∞ |
| `print_analysis` | 1/dia | bloqueado | 5/dia | 5/dia |
| `profile_analysis` | bloqueado | bloqueado | bloqueado | 10/dia |
| `transition_coach` | bloqueado | bloqueado | 2/mês | ∞ |
| `predate_coach` | bloqueado | bloqueado | 1/mês | ∞ |
| `postdate_debrief` | bloqueado | bloqueado | 1/mês | ∞ |

---

## Pagamentos (`src/mercadopago.js`)

`determinarPlano(amount)` — lógica de ativação:

| Valor pago | Plano ativado | Duração |
|------------|---------------|---------|
| ≤ R$9,99 | `wingman` | 1 dia (24h) |
| R$79,90 (±2) | `wingman_pro` | 30 dias |
| ≥ R$100 | `wingman` | 365 dias |
| Outros | `wingman` | 30 dias |

---

## Comandos WhatsApp

| Comando | Ação |
|---------|------|
| `status` | Mostra plano atual + uso do dia |
| `premium` | Mostra opções de upgrade |
| `mensal` | Gera Pix Wingman R$29,90 |
| `anual` | Gera Pix Wingman R$299 |
| `24h` | Gera Pix 24h R$4,99 |
| `pro` | Gera Pix Wingman Pro R$79,90 |
| `voltar` | Gera Pix win-back R$19,90 |
| `paguei` | Verifica pagamento pendente |

---

## Camadas e Acesso

| Camada | Feature | Free | Wingman | Wingman Pro |
|--------|---------|------|---------|-------------|
| 1 | Análise de Print | ✗ | 5/dia | 5/dia |
| 2 | Análise de Perfil | ✗ | ✗ | 10/dia |
| 3 | Coach de Transição | ✗ | 2/mês | ∞ |
| 4 | Coach Pré-Date | ✗ | 1/mês | ∞ |
| 5 | Debrief Pós-Date | ✗ | 1/mês | ∞ |
| 6 | Cápsulas de Mindset | ✗ | ✗ | Opt-in |
