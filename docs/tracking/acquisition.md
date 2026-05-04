# Rastreamento de Aquisição — Slug Attribution

Sistema para cruzar canal de aquisição com conversão de plano.

## Como funciona

1. Você cria um slug vinculado a um canal/vídeo/post
2. O sistema gera um link `wa.me` com o slug pré-preenchido
3. Usuário clica, abre o WhatsApp com o texto preenchido, e envia
4. Bot captura o slug silenciosamente na primeira mensagem e salva no usuário
5. Relatório mostra: de qual canal vieram + quantos converteram

## Fluxo técnico

```
Usuário clica no link → WhatsApp abre com "mandaassim_ig_reel_001" preenchido
→ Usuário envia → bot detecta padrão → lookup em acquisition_links
→ Salva source/medium/campaign/slug no users → continua fluxo normal
```

- **First-touch**: atribuição nunca sobrescreve. Se o usuário já existe, o slug é ignorado silenciosamente.
- **Sem slug**: usuários que chegam direto são atribuídos como `source=direct`.
- **Slug inválido** (não existe na tabela): fallback para parsear o slug como `source_medium`.

## Criar um link de rastreamento

```bash
# Obrigatório: --slug, --source, --medium
npm run create-slug -- --slug=ig_reel_001 --source=instagram --medium=reel

# Com campanha e notas
npm run create-slug -- --slug=tiktok_divorciado_001 --source=tiktok --medium=shorts --campaign=hook_divorciado_001 --notes="Hook sobre voltar pro mercado"

# Indicação pessoal
npm run create-slug -- --slug=indicacao_alex --source=indicacao --medium=boca_a_boca --notes="Alex do grupo de dads"
```

**Output:**
```
✅ Slug criado com sucesso!

  Slug      : ig_reel_001
  Source    : instagram
  Medium    : reel

  Link wa.me ↓

  https://wa.me/5511999999999?text=mandaassim_ig_reel_001
```

Cole esse link na bio, no vídeo, ou onde o tráfego vai passar.

## Rodar relatório

```bash
# Últimos 30 dias (padrão)
npm run acquisition-report

# Período específico
npm run acquisition-report -- --since=2026-05-01
npm run acquisition-report -- --since=2026-04-01 --until=2026-04-30
```

**Output:**
```
📊 Relatório de Aquisição
   Período: 2026-04-01 → 2026-04-30

Source        Medium        Campaign              Cadastros    Trial    Free  Wingman    Pro  Conv%  Custo IA   LTV Méd
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
instagram     reel          hook_divorciado_001          48       12       8       18     10  58.3%    R$4.21   R$38.50
tiktok        shorts        —                            31        8       7       12      4  51.6%    R$2.90   R$31.00
direct        direct        —                            12        5       4        2      1  25.0%    R$1.10   R$12.50
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
TOTAL                                                    91       25      19       32     15  51.6%    R$8.21   R$30.00

   Funil: 91 cadastros → 25 em trial → 19 free → 32 wingman → 15 pro
```

## Tabelas no Supabase

### `acquisition_links`
| Campo | Tipo | Descrição |
|-------|------|-----------|
| slug | text PK | ex: `ig_reel_001` |
| source | text | `instagram`, `tiktok`, `youtube`, `indicacao`, `direct` |
| medium | text | `reel`, `shorts`, `story`, `post`, `boca_a_boca` |
| campaign | text? | ex: `hook_divorciado_001` |
| notes | text? | descrição livre |
| created_by | text | `rafa` |
| created_at | timestamptz | |

### `users` — campos de aquisição
| Campo | Tipo | Descrição |
|-------|------|-----------|
| acquisition_slug | text? | slug bruto capturado |
| acquisition_source | text? | copiado de acquisition_links |
| acquisition_medium | text? | copiado de acquisition_links |
| acquisition_campaign | text? | copiado de acquisition_links |
| acquisition_first_message_at | timestamptz? | quando chegou |

## Adicionar `BOT_PHONE` no .env

```
BOT_PHONE=5511999999999
```

Sem esse campo, o `create-slug` falha. É o número do WhatsApp do bot sem `+` e sem espaço.

## Migrations necessárias

Rode no Supabase SQL Editor, em ordem:

1. `migrations/002_acquisition_tracking.sql` — tabela acquisition_links + campos no users
2. `migrations/012_acquisition_slug_field.sql` — campo acquisition_slug + acquisition_first_message_at
