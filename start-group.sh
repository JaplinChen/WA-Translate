#!/usr/bin/env bash
# Start one WhatsApp translate instance per group.
#   ./start-group.sh <name>          # start the bot for groups/<name>.env
#   ./start-group.sh <name> wizard   # open the wizard for first-time QR scan
#   ./start-group.sh <name> down     # stop and remove that group's containers
set -euo pipefail

NAME="${1:?usage: start-group.sh <name> [wizard|down]}"
ACTION="${2:-bot}"

ROOT="$(cd "$(dirname "$0")" && pwd)"
GROUP_ENV="$ROOT/groups/$NAME.env"
[ -f "$GROUP_ENV" ] || { echo "missing $GROUP_ENV"; exit 1; }
grep -qE '^WHATSAPP_SESSION_CLIENT_ID=.+' "$GROUP_ENV" || {
  echo "$GROUP_ENV 缺少唯一的 WHATSAPP_SESSION_CLIENT_ID（否則多群會共用同一 session）"; exit 1; }

COMPOSE=(docker compose -p "wa-$NAME" --env-file "$ROOT/.env" --env-file "$GROUP_ENV")

case "$ACTION" in
  wizard) "${COMPOSE[@]}" up -d wizard
          echo "--- wizard log (open the http://localhost:38765/?token=... URL) ---"
          "${COMPOSE[@]}" logs wizard ;;
  down)   "${COMPOSE[@]}" down ;;
  bot)    "${COMPOSE[@]}" stop wizard 2>/dev/null || true
          "${COMPOSE[@]}" up -d bot
          "${COMPOSE[@]}" ps ;;
  *)      echo "unknown action: $ACTION"; exit 1 ;;
esac
