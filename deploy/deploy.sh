#!/usr/bin/env bash
# Ручной деплой бэкенда: обновить код, пересобрать, применить миграции.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "Нет .env — скопируйте .env.example и заполните" >&2; exit 1; }

[ -d .git ] && git pull --ff-only
docker compose build --pull
docker compose up -d
docker image prune -f >/dev/null

echo "Ожидание готовности…"
for _ in $(seq 1 30); do
  status=$(docker inspect -f '{{.State.Health.Status}}' technolider-site-backend 2>/dev/null || echo starting)
  if [ "$status" = "healthy" ]; then
    echo "Готово: бэкенд работает (healthy)."
    docker compose exec -T api node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>r.json()).then(j=>console.log('Каналы:',j))" || true
    exit 0
  fi
  sleep 2
done
echo "Не стал healthy за 60 с — смотрите: docker compose logs --tail=100" >&2
exit 1
