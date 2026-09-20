const mockSendMail = jest.fn().mockResolvedValue({});
jest.mock('nodemailer', () => ({ createTransport: jest.fn(() => ({ sendMail: mockSendMail })) }));

process.env.EMAIL_HOST = 'smtp.test.dz';
process.env.EMAIL_USER = 'noreply@test.dz';

const mailer = require('../../server/mailer');

// Charge malveillante placée dans TOUS les champs : un hôte peut glisser ceci dans un titre d'annonce,
// un voyageur dans son nom — et le destinataire de l'e-mail est une autre personne.
const PAYLOAD = '<img src=x onerror=alert(1)><a href="https://phishing.example">Payer ici</a>';
const evilFields = {
  guestName: PAYLOAD, hostName: PAYLOAD, name: PAYLOAD, senderName: PAYLOAD, listingTitle: PAYLOAD, preview: PAYLOAD,
  checkIn: PAYLOAD, checkOut: PAYLOAD, reference: PAYLOAD, method: PAYLOAD, hostPhone: PAYLOAD, nights: PAYLOAD,
  resetUrl: `https://locavac.dz/?reset_token=abc"><script>alert(1)</script>`, verifyUrl: `https://locavac.dz/v?token=abc"><script>alert(1)</script>`,
  total: 20000, amount: 20000, listingId: 1,
  guestEmail: 'dest@test.dz', hostEmail: 'dest@test.dz', email: 'dest@test.dz', to: 'dest@test.dz',
};
const templates = Object.keys(mailer).filter(k => /^mail[A-Z]/.test(k));

beforeEach(() => mockSendMail.mockClear());

describe('Gabarits d\'e-mail — aucune donnée utilisateur injectée en HTML', () => {
  test('garde-fou : tous les gabarits exportés sont couverts', () => {
    expect(templates.length).toBeGreaterThanOrEqual(12);
  });

  test.each(templates)('%s : charge malveillante neutralisée', async name => {
    await mailer[name](evilFields);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const { html } = mockSendMail.mock.calls[0][0];
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('href="https://phishing.example"');
    // Aucun attribut ne peut être refermé par une donnée
    expect(html).not.toMatch(/abc"><script/);
  });

  test('les valeurs légitimes restent lisibles (accents, apostrophes, esperluette)', async () => {
    await mailer.mailPaymentConfirmedToGuest({
      guestName: 'Aïcha O\'Brien', guestEmail: 'a@test.dz', listingTitle: 'Villa & jardin', checkIn: '2027-06-01',
      checkOut: '2027-06-05', amount: 20000, reference: 'DZ-REF-1', method: 'cib',
    });
    const { html } = mockSendMail.mock.calls[0][0];
    expect(html).toContain('Aïcha O\'Brien');
    expect(html).toContain('Villa &amp; jardin');
    expect(html).toContain('<code>DZ-REF-1</code>');
    expect(html).toContain('CIB');
  });

  test('le lien de réinitialisation légitime reste cliquable', async () => {
    await mailer.mailPasswordReset({ name: 'Ali', email: 'a@test.dz', resetUrl: 'https://locavac.dz/?reset_token=deadbeef' });
    expect(mockSendMail.mock.calls[0][0].html).toContain('href="https://locavac.dz/?reset_token=deadbeef"');
  });
});

describe('Objet des e-mails', () => {
  test('aucun saut de ligne dans l\'objet (injection d\'en-têtes via un titre d\'annonce)', async () => {
    await mailer.mailReservationCreated({ ...evilFields, listingTitle: 'Villa\r\nBcc: pirate@evil.dz\r\n\r\nCorps injecté' });
    const { subject } = mockSendMail.mock.calls[0][0];
    expect(subject).not.toMatch(/[\r\n]/);
    expect(subject).toContain('Villa Bcc: pirate@evil.dz');
  });

  test('objet tronqué à 200 caractères', async () => {
    await mailer.mailReservationCreated({ ...evilFields, listingTitle: 'x'.repeat(500) });
    expect(mockSendMail.mock.calls[0][0].subject.length).toBeLessThanOrEqual(200);
  });
});

describe('esc', () => {
  test.each([['<b>', '&lt;b&gt;'], ['a & b', 'a &amp; b'], ['"x"', '&quot;x&quot;'], [null, ''], [undefined, ''], [42, '42']])('%p → %p', (input, out) => {
    expect(mailer.esc(input)).toBe(out);
  });
});
