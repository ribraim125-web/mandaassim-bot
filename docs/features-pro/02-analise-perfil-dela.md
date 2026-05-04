# Feature 2 — Analisar o Perfil Dela

**Flag:** `ENABLE_PROFILE_HER_ANALYSIS`  
**Plano:** Wingman Pro  
**Limite:** 30 análises/dia  
**Cooldown:** 60s entre análises  
**Tracking:** `intent='profile_her_analysis'`, tabela `profile_her_analyses`

## Trigger

Usuário Pro manda imagem → classificador detecta que é o perfil dela (`classificarPerfilSelfVsOther` retorna `'other'`).

## Pipeline

1. Validar plano (`wingman_pro`)
2. Validar limite diário (`profile_her_analysis`, 30/dia)
3. Verificar cooldown (60s)
4. Classificador de imagem confirma `type='profile'` e `selfVsOther='other'`
5. Haiku 4.5 vision com `SYSTEM_PROMPT_PROFILE` retorna JSON
6. Formatar 3 mensagens WhatsApp
7. Salvar em `profile_her_analyses` (sem imagem)
8. Tracking em `api_requests`

## Resposta (3 mensagens)

**Msg 1:** `📍 Lendo a intenção dela...` + nome/plataforma + sinais de personalidade + hook mais forte + alerta (se houver)  
**Msg 2:** `Manda isso pra abrir 👇` + mensagem principal (playful_clever)  
**Msg 3:** Variações (soft_curious, direct_charming) + o que não mandar  

## Princípio

"Leitura de Intenção" — entender o que ela sinalizou (fotos, bio, interesses) antes de sugerir o que dizer. Específico > genérico sempre.

## Fallback

Se classificador retorna `'ambiguous'`: perguntar "esse perfil é teu ou dela?"

## Arquivos

- `src/lib/profileAnalysis.js` — implementação (atualizada com novos campos)
- `src/config/features.js` — entrada `profile_her_analysis`
- `migrations/011_profile_features.sql` — tabela `profile_her_analyses`
