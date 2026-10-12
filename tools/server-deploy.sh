#!/bin/sh
# Выкат сервера хранения на Хельсинки (№44). Запускает Александр с мака одной командой:
#   sh ~/Documents/CODE/studio-neyra-vision/tools/server-deploy.sh
# Что делает: кладёт server/app.py в /opt/neyra-studio, ключи из ~/.config/neyra-studio/keys-prod.json,
# systemd-службу neyra-studio (127.0.0.1:8770), nginx-сайт api.studio.neyra.vision (80), ставит certbot.
# Сертификат выпускается вторым шагом, когда появится DNS A api.studio.neyra.vision → 212.192.8.91:
#   ssh root@212.192.8.91 'certbot --nginx -d api.studio.neyra.vision --non-interactive --agree-tos -m alex@neyra.ai --redirect'
set -e
HOST=root@212.192.8.91
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KEYS="$HOME/.config/neyra-studio/keys-prod.json"
[ -f "$KEYS" ] || { echo "нет $KEYS"; exit 2; }
ssh -o BatchMode=yes "$HOST" 'mkdir -p /opt/neyra-studio/server /opt/neyra-studio/data'
# на сервер идёт ПРИНЯТАЯ версия (последний коммит), не рабочее дерево: там могут лежать незавершённые правки Codex
TMP="$(mktemp -d)"; git -C "$ROOT" show HEAD:server/app.py > "$TMP/app.py"
scp -q "$TMP/app.py" "$HOST:/opt/neyra-studio/server/app.py"; rm -rf "$TMP"
scp -q "$KEYS" "$HOST:/opt/neyra-studio/keys.json"
ssh -o BatchMode=yes "$HOST" 'chmod 600 /opt/neyra-studio/keys.json
cat > /etc/systemd/system/neyra-studio.service <<UNIT
[Unit]
Description=Neyra Studio — сервер хранения проектов (studio.neyra.vision)
After=network.target
[Service]
ExecStart=/usr/bin/python3 /opt/neyra-studio/server/app.py --host 127.0.0.1 --port 8770 --data-dir /opt/neyra-studio/data --keys-file /opt/neyra-studio/keys.json
WorkingDirectory=/opt/neyra-studio
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload && systemctl enable --now neyra-studio.service && systemctl restart neyra-studio.service && sleep 2
systemctl is-active neyra-studio.service && curl -s -o /dev/null -w "api на сервере: %{http_code}\n" http://127.0.0.1:8770/api/projects
cat > /etc/nginx/sites-available/neyra-studio-api <<NG
server {
    listen 80;
    server_name api.studio.neyra.vision;
    client_max_body_size 50m;
    location / {
        proxy_pass http://127.0.0.1:8770;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }
}
NG
ln -sf /etc/nginx/sites-available/neyra-studio-api /etc/nginx/sites-enabled/neyra-studio-api
nginx -t 2>&1 | tail -1 && systemctl reload nginx && echo "nginx: сайт api.studio.neyra.vision включён (80)"
command -v certbot >/dev/null || (apt-get install -y -qq certbot python3-certbot-nginx >/dev/null 2>&1 && echo "certbot установлен")
# №56: ежедневный бэкап данных (7 дней), 03:17 UTC
mkdir -p /opt/backups/neyra-studio
cat > /usr/local/bin/neyra-studio-backup <<BK
#!/bin/sh
set -e
d=/opt/backups/neyra-studio; mkdir -p \$d
tar -czf \$d/data-\$(date +%Y%m%d-%H%M).tar.gz -C /opt/neyra-studio data keys.json
ls -1t \$d/data-*.tar.gz | tail -n +8 | xargs -r rm -f
BK
chmod +x /usr/local/bin/neyra-studio-backup
cat > /etc/systemd/system/neyra-studio-backup.service <<UNIT
[Unit]
Description=Neyra Studio — бэкап данных
[Service]
Type=oneshot
ExecStart=/usr/local/bin/neyra-studio-backup
UNIT
cat > /etc/systemd/system/neyra-studio-backup.timer <<UNIT
[Unit]
Description=Neyra Studio — ежедневный бэкап 03:17 UTC
[Timer]
OnCalendar=*-*-* 03:17:00
Persistent=true
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload && systemctl enable --now neyra-studio-backup.timer && /usr/local/bin/neyra-studio-backup && echo "бэкап: таймер включён, первый архив: \$(ls -1t /opt/backups/neyra-studio | head -1)"'
echo "готово: дальше DNS A api.studio.neyra.vision → 212.192.8.91 (Cloudflare, DNS only) и команда certbot из шапки этого файла"
