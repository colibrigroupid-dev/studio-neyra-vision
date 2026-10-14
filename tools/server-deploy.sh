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
# на сервер идёт ПРИНЯТАЯ версия (последний коммит) всей папки server/ (app.py + blocks/), не рабочее дерево
TMP="$(mktemp -d)"; git -C "$ROOT" archive HEAD server | tar -x -C "$TMP"
ssh -o BatchMode=yes "$HOST" 'rm -rf /opt/neyra-studio/server.new; mkdir -p /opt/neyra-studio/server.new'
scp -qr "$TMP/server/." "$HOST:/opt/neyra-studio/server.new/"
ssh -o BatchMode=yes "$HOST" 'rm -rf /opt/neyra-studio/server.old; mv /opt/neyra-studio/server /opt/neyra-studio/server.old 2>/dev/null; mv /opt/neyra-studio/server.new /opt/neyra-studio/server; find /opt/neyra-studio/server -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null; true'
rm -rf "$TMP"
scp -q "$KEYS" "$HOST:/opt/neyra-studio/keys.json"
# ключ модели для помощника (№46): если лежит на маке в ~/.config/neyra-studio/key — уезжает на сервер
MODELKEY="$HOME/.config/neyra-studio/key"
if [ -f "$MODELKEY" ]; then ssh -o BatchMode=yes "$HOST" 'mkdir -p /root/.config/neyra-studio'; scp -q "$MODELKEY" "$HOST:/root/.config/neyra-studio/key"; ssh -o BatchMode=yes "$HOST" 'chmod 600 /root/.config/neyra-studio/key'; echo "ключ модели для помощника скопирован"; else echo "ключа модели нет (~/.config/neyra-studio/key) — помощник ответит 503, пока не появится"; fi
# ключ Google для картинок (блок kartinki): ~/.config/nano-banana/key → /root/.config/neyra-studio/google-key
GKEY="$HOME/.config/nano-banana/key"
if [ -f "$GKEY" ]; then ssh -o BatchMode=yes "$HOST" 'mkdir -p /root/.config/neyra-studio'; scp -q "$GKEY" "$HOST:/root/.config/neyra-studio/google-key"; ssh -o BatchMode=yes "$HOST" 'chmod 600 /root/.config/neyra-studio/google-key'; echo "ключ Google для картинок скопирован"; else echo "ключа Google нет (~/.config/nano-banana/key) — картинки ответят 503"; fi
# ключ BytePlus для видео (блок video): ARK_API_KEY из ~/Documents/CODE/welluma-art/.env → /root/.config/neyra-studio/ark-key
ARKENV="$HOME/Documents/CODE/welluma-art/.env"
ARK=$( [ -f "$ARKENV" ] && grep -m1 '^ARK_API_KEY' "$ARKENV" | cut -d= -f2- | tr -d "\"' " )
if [ -n "$ARK" ]; then ssh -o BatchMode=yes "$HOST" 'mkdir -p /root/.config/neyra-studio; umask 077; cat > /root/.config/neyra-studio/ark-key' <<ARKEOF
$ARK
ARKEOF
echo "ключ BytePlus для видео скопирован"; else echo "ключа BytePlus нет — видео ответит 503"; fi
# тарифы и способы оплаты (№60): если лежат на маке — уезжают на сервер
for F in tarify.json oplata.json; do if [ -f "$HOME/.config/neyra-studio/$F" ]; then ssh -o BatchMode=yes "$HOST" 'mkdir -p /root/.config/neyra-studio'; scp -q "$HOME/.config/neyra-studio/$F" "$HOST:/root/.config/neyra-studio/$F"; echo "$F скопирован"; fi; done
ssh -o BatchMode=yes "$HOST" 'chmod 600 /opt/neyra-studio/keys.json
cat > /etc/systemd/system/neyra-studio.service <<UNIT
[Unit]
Description=Neyra Studio — сервер хранения проектов (studio.neyra.vision)
After=network.target
[Service]
Environment=NEYRA_PUBLIC_URL=https://api.studio.neyra.vision
ExecStart=/usr/bin/python3 /opt/neyra-studio/server/app.py --host 127.0.0.1 --port 8770 --data-dir /opt/neyra-studio/data --keys-file /opt/neyra-studio/keys.json
WorkingDirectory=/opt/neyra-studio
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload && systemctl enable --now neyra-studio.service && systemctl restart neyra-studio.service && sleep 2
sleep 2; systemctl is-active neyra-studio.service; curl -s -o /dev/null -w "api на сервере: %{http_code} (401 = жив)\n" http://127.0.0.1:8770/api/projects; journalctl -u neyra-studio.service -n 3 --no-pager -p err | grep -v "^-- " || true
# nginx-сайт создаётся один раз; если он уже есть (certbot дописал туда HTTPS) — не трогаем
if [ ! -f /etc/nginx/sites-available/neyra-studio-api ]; then
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
nginx -t 2>&1 | tail -1 && systemctl reload nginx && echo "nginx: сайт api.studio.neyra.vision создан (80); дальше certbot"
else
echo "nginx: сайт уже есть ($(grep -c "listen 443" /etc/nginx/sites-enabled/neyra-studio-api) × listen 443) — не трогаю"
fi
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
systemctl daemon-reload && systemctl enable --now neyra-studio-backup.timer && /usr/local/bin/neyra-studio-backup && echo "бэкап: таймер включён, архивов: $(ls -1 /opt/backups/neyra-studio | wc -l | tr -d " ")"'
echo "готово: дальше DNS A api.studio.neyra.vision → 212.192.8.91 (Cloudflare, DNS only) и команда certbot из шапки этого файла"
