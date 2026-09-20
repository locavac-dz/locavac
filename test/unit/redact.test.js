const fs   = require('fs');
const path = require('path');
const { redactUrl } = require('../../server/redact');

const read = p => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');

describe('redactUrl — secrets masqués avant journalisation', () => {
  test.each([
    ['/api/auth/verify-email?token=0123abcd',                 '/api/auth/verify-email?token=***'],
    ['/?reset_token=deadbeef',                                '/?reset_token=***'],
    ['/api/auth/google/callback?code=4/0Ab&state=eyJhbGci.x', '/api/auth/google/callback?code=***&state=***'],
    ['/ws?token=eyJhbGciOiJIUzI1NiJ9.e30.sig',                '/ws?token=***'],
    ['/x?a=1&access_token=abc&b=2',                           '/x?a=1&access_token=***&b=2'],
    ['/x?TOKEN=abc',                                          '/x?TOKEN=***'],
    ['/x?token=abc#ancre',                                    '/x?token=***#ancre'],
  ])('%s', (input, expected) => {
    expect(redactUrl(input)).toBe(expected);
  });

  test.each(['/api/listings?wilaya=Alger&q=villa', '/api/listings/12', '/', '/uploads/a.jpg?w=800'])(
    'laisse intacte une URL sans secret : %s', url => {
      expect(redactUrl(url)).toBe(url);
    });

  test('un paramètre dont le nom contient seulement "token" en suffixe n\'est pas confondu (csrf_token_id)', () => {
    expect(redactUrl('/x?mytoken=abc')).toBe('/x?mytoken=abc');
  });

  test('valeurs non textuelles tolérées', () => {
    expect(redactUrl(undefined)).toBe('');
    expect(redactUrl(null)).toBe('');
  });
});

describe('Aucun jeton dans les URL ni dans les journaux', () => {
  test('le journal HTTP d\'Express passe par redactUrl', () => {
    const index = read('server/index.js');
    expect(index).toMatch(/redactUrl\(req\.url\)/);
    expect(index).not.toMatch(/console\.log\([^)]*\$\{req\.url\}/);
  });

  test('le client WebSocket n\'envoie plus le jeton dans l\'URL', () => {
    const html = read('public/index.html');
    expect(html).not.toMatch(/\/ws\?token=/);
    expect(html).toMatch(/type:\s*'auth',\s*token/);
  });

  test('le serveur WebSocket ne lit plus aucun paramètre d\'URL', () => {
    const ws = read('server/ws.js');
    expect(ws).not.toMatch(/searchParams|req\.url/);
  });

  test('Nginx : journal d\'accès au format « locavac », sans query string ni Referer', () => {
    const conf = read('nginx.conf');
    const format = conf.match(/log_format\s+locavac\s+([\s\S]*?);/);
    expect(format).not.toBeNull();
    expect(format[1]).toMatch(/\$uri/);
    expect(format[1]).not.toMatch(/\$request\b|\$request_uri|\$args|\$query_string|\$http_referer/);
    expect(conf).toMatch(/access_log\s+\S+\s+locavac;/);
  });
});
