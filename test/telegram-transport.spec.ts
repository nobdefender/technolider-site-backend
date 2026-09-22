import { Agent, ProxyAgent } from 'undici';
import { createProxyDispatcher, maskProxy } from '../src/telegram/telegram-transport';

/**
 * Транспорт до Bot API: с российских адресов api.telegram.org недоступен,
 * поэтому запросы идут через прокси. Проверяем разбор TELEGRAM_PROXY_URL.
 */
describe('Прокси до Telegram', () => {
  it('http:// и https:// — через ProxyAgent', async () => {
    for (const url of ['http://127.0.0.1:8888', 'https://proxy.example.com:3128']) {
      const d = createProxyDispatcher(url);
      expect(d).toBeInstanceOf(ProxyAgent);
      await d.close();
    }
  });

  it('логин и пароль в адресе принимаются', async () => {
    const d = createProxyDispatcher('http://user:p%40ss@127.0.0.1:8888');
    expect(d).toBeInstanceOf(ProxyAgent);
    await d.close();
  });

  it('socks5:// и socks4:// — через Agent с сокет-коннектором', async () => {
    for (const url of ['socks5://127.0.0.1:1080', 'socks4://127.0.0.1:1080']) {
      const d = createProxyDispatcher(url);
      expect(d).toBeInstanceOf(Agent);
      await d.close();
    }
  });

  it('неизвестный протокол — понятная ошибка при старте', () => {
    expect(() => createProxyDispatcher('ftp://127.0.0.1:21')).toThrow(/не поддерживается/);
    expect(() => createProxyDispatcher('просто строка')).toThrow(/не похоже на адрес/);
  });

  it('в логах нет логина и пароля', () => {
    expect(maskProxy('socks5://user:secret@1.2.3.4:1080')).toBe('socks5://1.2.3.4:1080');
    expect(maskProxy('не адрес')).toBe('адрес указан неверно');
  });
});
