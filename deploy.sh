#!/usr/bin/env bash
#
# deploy.sh — deploy à prova de bala do mandaassim-bot.
#
# Garante que a PRODUÇÃO roda exatamente o que está em origin/<branch atual>,
# roda o smoke como trava de seguranca e SO reinicia o bot se o smoke passar.
# Nunca abre pager (era o que travava a tela do terminal).
#
# Branch-agnostico DE PROPOSITO: sincroniza com o remoto da branch que estiver
# checked-out no servidor no momento (nao hardcoded em "main"). Isso evita o
# incidente de 2026-07: o servidor rodou "deploy/gpt5-mini" por semanas via
# deploy manual enquanto "origin/main" ficava 15+ commits pra tras — se
# alguem tivesse rodado este script hardcoded em main, teria REGREDIDO a
# producao. Pra trocar de branch em producao: `git checkout <branch>` uma vez
# no servidor, dai `bash deploy.sh` sempre acompanha essa branch dali em diante.
#
# Uso no servidor, sempre que quiser publicar uma mudança:
#   bash deploy.sh
#
set -euo pipefail

# Nunca abrir o pager do git (aquela tela com ":" que travava tudo).
export GIT_PAGER=cat
export PAGER=cat
export GIT_TERMINAL_PROMPT=0

APP="mandaassim-bot"
DIR="${MANDAASSIM_DIR:-$HOME/mandaassim-bot}"

echo "=================================================="
echo "   DEPLOY  $APP"
echo "=================================================="

cd "$DIR"

BRANCH="$(git branch --show-current)"
if [ -z "$BRANCH" ]; then
  echo "X  HEAD desanexado (detached) — sem branch pra saber de onde sincronizar. Aborta."
  exit 1
fi
echo "Branch no servidor        : $BRANCH"

ANTES="$(git rev-parse --short HEAD)"
echo "Commit atual no servidor  : $ANTES"

echo "-> Buscando a ultima versao do GitHub..."
git fetch --quiet origin "$BRANCH"

REMOTO="$(git rev-parse --short "origin/$BRANCH")"
echo "Commit mais recente (repo): $REMOTO"

if [ "$ANTES" = "$REMOTO" ]; then
  echo "-> Ja esta na ultima versao. Reiniciando mesmo assim pra garantir."
fi

# Trava de seguranca: se o HEAD atual do servidor nao e ancestral do remoto
# (historia divergente — ex.: alguem trocou de branch/fez deploy manual de
# outro lugar), um reset --hard aqui jogaria commits fora silenciosamente.
# Avisa e pede confirmacao explicita em vez de descartar sem falar nada.
if ! git merge-base --is-ancestor "$ANTES" "origin/$BRANCH" 2>/dev/null; then
  echo ""
  echo "AVISO: o commit atual do servidor ($ANTES) NAO e ancestral de"
  echo "       origin/$BRANCH ($REMOTO) — historia divergente."
  echo "       Um reset --hard aqui pode DESCARTAR trabalho que nao esta"
  echo "       em nenhum lugar do GitHub. Confirme antes de continuar:"
  read -r -p "       Digite 'sim' pra prosseguir mesmo assim: " CONFIRMA
  if [ "$CONFIRMA" != "sim" ]; then
    echo "Abortado — nada foi alterado."
    exit 1
  fi
fi

# Transparencia: se alguem editou algo direto no servidor, mostra antes de descartar.
if [ -n "$(git status --porcelain)" ]; then
  echo ""
  echo "AVISO: havia mudancas locais nao commitadas no servidor."
  echo "       Vao ser DESCARTADAS pra producao bater 100% com o repo:"
  git status --short
  echo ""
fi

echo "-> Sincronizando o codigo com origin/$BRANCH..."
git reset --hard "origin/$BRANCH"

echo "-> Rodando o smoke test (trava de seguranca)..."
if ! npm run smoke; then
  echo ""
  echo "=================================================="
  echo "  X  SMOKE FALHOU — o codigo novo NAO carrega."
  echo "     O bot NAO foi reiniciado: a producao segue no ar"
  echo "     com a versao anterior. Manda o erro acima pro chat."
  echo "=================================================="
  exit 1
fi

echo "-> Reiniciando o bot..."
pm2 restart "$APP" --update-env

RODANDO="$(git rev-parse --short HEAD)"
echo ""
echo "=================================================="
echo "  OK - NO AR. Producao rodando o commit $RODANDO :"
git --no-pager log --oneline -1
echo "=================================================="
