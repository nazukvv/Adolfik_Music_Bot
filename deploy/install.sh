#!/usr/bin/env bash
# Установка Adolfik на Ubuntu 24.04 (Oracle Cloud, ARM або x86).
# Запуск із папки репозиторію:  bash deploy/install.sh
set -euo pipefail
cd "$(dirname "$0")/.."
APP_DIR="$(pwd)"
APP_USER="$(whoami)"

echo "==> Системні пакети"
sudo apt-get update -y
sudo apt-get install -y python3 python3-venv python3-dev build-essential git ffmpeg curl

echo "==> Node.js 22 (для збірки Activity і JS-челенджів yt-dlp)"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "==> cloudflared (HTTPS-тунель для Activity)"
if ! command -v cloudflared >/dev/null; then
  ARCH="$(dpkg --print-architecture)"
  curl -fsSL -o /tmp/cloudflared.deb \
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}.deb"
  sudo dpkg -i /tmp/cloudflared.deb
fi

echo "==> Python-залежності"
python3 -m venv .venv
.venv/bin/pip install -U pip -q
.venv/bin/pip install -r requirements.txt

echo "==> Збірка Activity"
(cd activity && npm ci && npm run build)

if [ ! -f .env ]; then
  cp .env.example .env
  echo "!!! Створив .env з прикладу — заповни його (nano .env) перед запуском"
fi

echo "==> systemd-сервіси"
for unit in adolfik adolfik-tunnel; do
  sed "s#__DIR__#${APP_DIR}#g; s#__USER__#${APP_USER}#g" "deploy/${unit}.service" \
    | sudo tee "/etc/systemd/system/${unit}.service" >/dev/null
done
sudo systemctl daemon-reload
sudo systemctl enable adolfik adolfik-tunnel

echo
echo "Готово. Далі:"
echo "  1) перевір .env і поклади cookies.txt (якщо є) у ${APP_DIR}"
echo "  2) sudo systemctl start adolfik adolfik-tunnel"
echo "  3) адреса тунелю:  journalctl -u adolfik-tunnel | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1"
echo "  4) логи бота:      journalctl -u adolfik -f"
