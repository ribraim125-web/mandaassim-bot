# Feature 1 — Auditar Meu Perfil

**Flag:** `ENABLE_PROFILE_SELF_AUDIT`  
**Plano:** Wingman Pro  
**Limite:** 30 auditorias/dia  
**Cooldown:** 60s entre análises  
**Tracking:** `intent='profile_self_audit'`, tabela `profile_audits`

## Trigger

Usuário Pro manda imagem → classificador detecta que é o perfil próprio dele (`classificarPerfilSelfVsOther` retorna `'self'`).

## Pipeline

1. Validar plano (`wingman_pro`)
2. Validar limite diário (`profile_self_audit`, 30/dia)
3. Verificar cooldown (60s)
4. Classificador de imagem confirma `type='profile'` e `selfVsOther='self'`
5. Haiku 4.5 vision com `SYSTEM_PROMPT_SELF_AUDIT` retorna JSON
6. Formatar 4 mensagens WhatsApp
7. Salvar em `profile_audits` (sem imagem)
8. Tracking em `api_requests`

## Resposta (4 mensagens)

**Msg 1:** `📍 Lendo teu perfil [no plataforma]...` + veredicto geral + conselho de ordem  
**Msg 2:** `📸 Tuas fotos:` + ✅/🔄/❌ foto por foto com rationale e feedback específico  
**Msg 3:** `✍️ Bio:` + análise + bio reescrita  
**Msg 4:** `🎯 Faz essas N mudanças primeiro:` + top 3 + elementos faltando  

## Tom

Honesto na lata, sem rebaixar. "Troca essa foto" / "Sai" / "Reescreve" — direto mas com razão clara.

## Fallback

Se classificador retorna `'ambiguous'`: perguntar "esse perfil é teu ou dela?"

## Arquivos

- `src/lib/profileSelfAudit.js` — implementação completa
- `src/config/features.js` — entrada `profile_self_audit`
- `migrations/011_profile_features.sql` — tabela `profile_audits`
