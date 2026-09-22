import { Agent, ProxyAgent, buildConnector, type Dispatcher } from 'undici';
import { SocksClient, type SocksProxy } from 'socks';

/**
 * Транспорт для Bot API. С российских адресов api.telegram.org недоступен,
 * поэтому запросы можно пустить через прокси (TELEGRAM_PROXY_URL) или
 * на своё зеркало Bot API (TELEGRAM_API_BASE).
 */

/** Адрес прокси без логина и пароля — чтобы не светить их в логах. */
export function maskProxy(proxyUrl: string): string {
  try {
    const u = new URL(proxyUrl);
    return `${u.protocol}//${u.host}`;
  } catch {
    return 'адрес указан неверно';
  }
}

/** Диспетчер undici, направляющий запросы через прокси: http(s):// или socks5://. */
export function createProxyDispatcher(proxyUrl: string): Dispatcher {
  let u: URL;
  try {
    u = new URL(proxyUrl);
  } catch {
    throw new Error(`TELEGRAM_PROXY_URL: не похоже на адрес — «${proxyUrl}»`);
  }

  const scheme = u.protocol.replace(':', '').toLowerCase();
  const user = u.username ? decodeURIComponent(u.username) : '';
  const pass = u.password ? decodeURIComponent(u.password) : '';

  if (scheme === 'http' || scheme === 'https') {
    return new ProxyAgent({
      uri: `${u.protocol}//${u.host}`,
      token: user ? `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` : undefined,
    });
  }

  if (['socks5', 'socks5h', 'socks4', 'socks4a'].includes(scheme)) {
    const type: SocksProxy['type'] = scheme.startsWith('socks4') ? 4 : 5;
    const host = u.hostname;
    const port = Number(u.port) || 1080;
    // undici сам не умеет SOCKS: открываем сокет через прокси и отдаём его
    // штатному коннектору, который поднимет поверх него TLS
    const connector = buildConnector({});
    return new Agent({
      connect(options, callback) {
        SocksClient.createConnection({
          proxy: { host, port, type, userId: user || undefined, password: pass || undefined },
          command: 'connect',
          destination: {
            host: options.hostname,
            port: Number(options.port) || (options.protocol === 'http:' ? 80 : 443),
          },
          timeout: 15_000,
        })
          .then(({ socket }) => connector({ ...options, httpSocket: socket }, callback))
          .catch((e: Error) => callback(e, null));
      },
    });
  }

  throw new Error(
    `TELEGRAM_PROXY_URL: протокол «${scheme}» не поддерживается — нужен http, https, socks5 или socks4`,
  );
}
