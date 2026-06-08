#!/usr/bin/env bash
#
# deploy.sh — deploy à prova de bala do mandaassim-bot.
#
# Garante que a PRODUÇÃO roda exatamente o que está em origin/main, roda o smoke
# como trava de segurança e SÓ reinicia o bot se o smoke passar. Nunca abre pager
# (era o que travava a tela do terminal).
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

ANTES="$(git rev-parse --short HEAD)"
echo "Commit atual no servidor  : $ANTES"

echo "-> Buscando a ultima versao do GitHub..."
git fetch --quiet origin main

REMOTO="$(git rev-parse --short origin/main)"
echo "Commit mais recente (repo): $REMOTO"

if [ "$ANTES" = "$REMOTO" ]; then
  echo "-> Ja esta na ultima versao. Reiniciando mesmo assim pra garantir."
fi

# Transparencia: se alguem editou algo direto no servidor, mostra antes de descartar.
if [ -n "$(git status --porcelain)" ]; then
  echo ""
  echo "AVISO: havia mudancas locais nao commitadas no servidor."
  echo "       Vao ser DESCARTADAS pra producao bater 100% com o repo:"
  git status --short
  echo ""
fi

echo "-> Sincronizando o codigo com origin/main..."
git reset --hard origin/main

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
