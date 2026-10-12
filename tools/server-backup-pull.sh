#!/bin/sh
# Забрать свежий бэкап данных сервера команды на мак (№56). Запуск: sh tools/server-backup-pull.sh
set -e
HOST=root@212.192.8.91
DST="$HOME/Documents/CODE/KINO-STANCIYA/BACKUPS/neyra-studio"; mkdir -p "$DST"
LAST="$(ssh -o BatchMode=yes "$HOST" 'ls -1t /opt/backups/neyra-studio/data-*.tar.gz 2>/dev/null | head -1')"
[ -n "$LAST" ] || { echo "на сервере нет архивов — выполнить tools/server-deploy.sh (ставит таймер)"; exit 2; }
scp -q "$HOST:$LAST" "$DST/" && echo "скачан $(basename "$LAST") → $DST"
ls -1t "$DST" | tail -n +15 | sed "s|^|$DST/|" | xargs -r rm -f
