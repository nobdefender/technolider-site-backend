# technolider-site-backend — бэкенд сайта ООО НПП «Технолидер»

API для формы «Оставить заявку»: приём данных и файлов, проверка Yandex SmartCaptcha,
защита от спама, сохранение в PostgreSQL, отправка на почту и в Telegram.

Стек: NestJS 11 + TypeScript, Prisma + PostgreSQL, nodemailer, Docker.
Фронтенд — в отдельном репозитории `technolider-site-frontend`.

## Запуск для разработки

```bash
npm install
cp .env.example .env            # заполнить DATABASE_URL (и, по желанию, SMTP/Telegram)
docker compose up -d db         # поднять только базу
npx prisma migrate dev          # создать таблицы
npm run start:dev               # http://localhost:4000/api
```

Документация API (Swagger): http://localhost:4000/api/docs?key=<ADMIN_KEY> —
открывается только с админ-ключом (см. ниже).

## Эндпоинты

| Метод | Путь | Доступ | Назначение |
|---|---|---|---|
| `POST` | `/api/leads` | открыт | Отправка заявки (`application/json` или `multipart/form-data` с полем `files`) |
| `GET` | `/api/health` | открыт | Живость (для Docker healthcheck и мониторинга) |
| `GET` | `/api/health/details` | админ-ключ | Состояние БД и настроенных каналов |
| `GET` | `/api/health/telegram` | админ-ключ | Связь с Telegram (getMe) — проверка прокси |
| `GET` | `/api/leads` | админ-ключ | Список заявок |
| `GET` | `/api/docs` | админ-ключ | Swagger |

**Служебные маршруты** открываются только с `ADMIN_KEY`: заголовок `X-Admin-Key: <ключ>`
или `?key=<ключ>` (для Swagger в браузере — ключ запоминается в cookie на время сессии).
Без ключа отвечают `404`, поэтому снаружи не видно, что такие маршруты существуют.
Если `ADMIN_KEY` не задан, служебные маршруты и Swagger недоступны вовсе.

Ответы: `{ ok: true, id }` при успехе; `400 { ok: false, errors: { поле: "текст" } }`
при ошибке валидации; `400 { ok: false, error: "captcha" | "delivery" }` в остальных случаях.
Формат ошибок совпадает с тем, что ожидает форма на сайте.

### Пример

```bash
curl -X POST http://localhost:4000/api/leads \
  -F 'name=Иван Петров' \
  -F 'phone=+7 900 000-00-00' \
  -F 'email=ivan@company.ru' \
  -F 'task=Нужно изготовить корпус по чертежу, 10 шт.' \
  -F 'files=@drawing.pdf'          # до 3 файлов по 5 МБ
```

## Как устроена обработка заявки

1. **Ловушка для ботов** — скрытое поле `company`: если заполнено, заявка молча отбрасывается.
2. **Ограничение частоты** — 5 заявок с одного IP в час (`THROTTLE_LIMIT` / `THROTTLE_TTL`).
3. **Капча** — проверка токена Yandex SmartCaptcha. Если ключ не задан, проверка пропускается;
   если сервис капчи недоступен, заявка не теряется.
4. **Сохранение в БД** — заявка и метаданные файлов. Если база недоступна, обработка продолжается.
5. **Доставка** — письмо (HTML + вложения) и сообщение в Telegram, независимо друг от друга.
   В Telegram заявка приходит одним сообщением: файлы уходят альбомом, текст заявки —
   подписью к нему (если задача длиннее 1000 знаков, текст идёт отдельным сообщением —
   таков лимит подписи у Telegram).
   Заявка считается принятой, если сохранена в БД **или** доставлена хотя бы одним каналом;
   результат и текст ошибки пишутся в поля `status` / `deliveryError`.

Вложения: до 3 файлов по 5 МБ (`UPLOADS_*`), допускаются PDF, изображения, Word/Excel
и CAD-форматы (DWG, DXF, STEP и т.п.). Архивы (zip, rar, 7z) и всё остальное отклоняются:
содержимое архива по расширению не проверить. Файлы лежат в томе `uploads`.

## Переменные окружения

Все — в `.env.example` с комментариями. Ключевые:

| Переменная | Назначение |
|---|---|
| `DATABASE_URL`, `POSTGRES_*` | подключение к PostgreSQL |
| `CORS_ORIGINS` | домены фронтенда (если API на том же домене через `/api`, CORS не нужен) |
| `SMARTCAPTCHA_SECRET` | серверный ключ Yandex SmartCaptcha |
| `SMTP_*`, `MAIL_TO`, `MAIL_FROM` | отправка почты; пусто — отключена |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | отправка в Telegram; пусто — отключена |
| `TELEGRAM_PROXY_URL` | прокси до Bot API (`socks5://…`, `http://…`) — из России он заблокирован |
| `TELEGRAM_API_BASE` | адрес Bot API, если вместо прокси используется своё зеркало |
| `ADMIN_KEY` | ключ ко всем служебным маршрутам (`/api/leads`, `/api/health/details`, `/api/docs`) |
| `API_PORT` | порт на хосте (по умолчанию 4000, только 127.0.0.1) |

### Telegram с российского сервера

`api.telegram.org` с российских адресов не открывается, поэтому запросы к боту идут
через прокси: `TELEGRAM_PROXY_URL=socks5://логин:пароль@1.2.3.4:1080` (или `http://…`).
Пароль со спецсимволами кодируется по-URL (`@` → `%40`). Альтернатива — своё зеркало
Bot API на зарубежном сервере: `TELEGRAM_API_BASE=https://tg.example.com`.

Через этот же канал уходят вложения, так что прокси должен тянуть файлы до 5 МБ.
Почта (SMTP) и капча (Yandex Cloud) из России работают напрямую, им прокси не нужен.

Проверка связи:

```bash
curl -s -H "X-Admin-Key: <ключ>" http://127.0.0.1:4000/api/health/telegram
# {"ok":true,"bot":"@…","apiBase":"https://api.telegram.org","proxy":"socks5://1.2.3.4:1080"}
```

Если прокси недоступен, заявка всё равно сохраняется в БД и уходит на почту — текст
ошибки попадает в поле `deliveryError`.

## Деплой на сервер (Docker, вручную)

Полная инструкция — в [DEPLOY.md](DEPLOY.md) (репозиторий → Docker → nginx рядом
с сайтом → проверка формы → бэкапы). Ниже — кратко.

```bash
sudo mkdir -p /opt/technolider-site-backend && sudo chown $USER:$USER /opt/technolider-site-backend
git clone git@github.com:<аккаунт>/technolider-site-backend.git /opt/technolider-site-backend
cd /opt/technolider-site-backend
cp .env.example .env && nano .env        # пароль БД, домены, SMTP/Telegram
docker compose up -d --build             # поднимет PostgreSQL и API, применит миграции
curl -s http://127.0.0.1:4000/api/health
```

В nginx добавьте в тот же `server`-блок, где отдаётся сайт (см. `deploy/nginx.conf.example`):

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:4000/api/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 20m;
}
```

Тогда фронтенд обращается к API по относительному `/api/leads` — без CORS
(`NEXT_PUBLIC_API_URL` на сайте оставляем пустым). Форма сайта уже отправляет заявки
сюда — отдельно ничего переключать не нужно.

Обновление: `bash deploy/deploy.sh` (git pull → пересборка → миграции → проверка healthcheck).

## Резервное копирование

```bash
# дамп базы
docker compose exec -T db pg_dump -U technolider technolider | gzip > backup-$(date +%F).sql.gz
# вложения
docker run --rm -v technolider-site-backend_uploads:/u -v "$PWD":/b alpine tar czf /b/uploads-$(date +%F).tar.gz -C /u .
```

## Проверки

```bash
npm run lint      # ESLint
npx tsc --noEmit  # типы
npm test          # unit-тесты сценариев обработки заявки
```
