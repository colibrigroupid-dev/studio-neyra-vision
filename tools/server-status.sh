#!/bin/sh
# Утренний взгляд на сервер команды (только чтение): sh tools/server-status.sh
HOST=root@212.192.8.91
echo "api снаружи: $(curl -s -o /dev/null -w '%{http_code}' -H 'X-Key: x' https://api.studio.neyra.vision/api/projects) (401 = живой, ждёт ключ)"
ssh -o BatchMode=yes -o ConnectTimeout=12 "$HOST" '
echo "служба: $(systemctl is-active neyra-studio.service) · бэкап-таймер: $(systemctl is-active neyra-studio-backup.timer 2>/dev/null || echo нет)"
echo "версия app.py: $(md5sum /opt/neyra-studio/server/app.py | cut -c1-12)"
echo "данные: $(du -sh /opt/neyra-studio/data | cut -f1) · проектов: $(ls /opt/neyra-studio/data 2>/dev/null | wc -l | tr -d " ")"
b=$(ls -1t /opt/backups/neyra-studio/data-*.tar.gz 2>/dev/null | head -1); echo "последний бэкап: ${b:-нет}"
echo "диск: $(df -h / | tail -1 | awk "{print \$4\" свободно из \"\$2}")"
echo "сертификат до: $(openssl x509 -enddate -noout -in /etc/letsencrypt/live/api.studio.neyra.vision/fullchain.pem 2>/dev/null | cut -d= -f2)"
echo "ошибки службы за сутки: $(journalctl -u neyra-studio.service --since -24h -p err --no-pager 2>/dev/null | grep -vc "^-- " )"'
cd "$(dirname "$0")/.." && echo "принятая версия app.py (HEAD): $(git show HEAD:server/app.py | md5sum | cut -c1-12)"
