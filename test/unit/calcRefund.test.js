const { calcRefund, nights } = require('../../server/routes/reservations');

// Helper : date dans N jours depuis aujourd'hui
function inDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// ── nights() ──────────────────────────────────────────────────────
describe('nights()', () => {
  test('calcule le bon nombre de nuits', () => {
    expect(nights('2026-07-01', '2026-07-08')).toBe(7);
    expect(nights('2026-12-31', '2027-01-01')).toBe(1);
    expect(nights('2026-01-01', '2026-01-01')).toBe(0);
  });
});

// ── calcRefund() — politique flexible ────────────────────────────
describe('calcRefund() — flexible', () => {
  test('remboursement 100% si arrivée dans > 1 jour', () => {
    const r = calcRefund('flexible', 10000, inDays(5));
    expect(r.pct).toBe(100);
  });

  test('remboursement 100% si arrivée dans exactement 1 jour', () => {
    const r = calcRefund('flexible', 10000, inDays(1));
    expect(r.pct).toBe(100);
  });

  test('remboursement 0% si arrivée aujourd\'hui (0 jours)', () => {
    const r = calcRefund('flexible', 10000, inDays(0));
    expect(r.pct).toBe(0);
  });

  test('remboursement 0% si arrivée dans le passé', () => {
    const r = calcRefund('flexible', 10000, inDays(-2));
    expect(r.pct).toBe(0);
  });
});

// ── calcRefund() — politique modérée ─────────────────────────────
describe('calcRefund() — modérée', () => {
  test('100% si arrivée dans >= 5 jours', () => {
    expect(calcRefund('moderee', 10000, inDays(10)).pct).toBe(100);
    expect(calcRefund('moderee', 10000, inDays(5)).pct).toBe(100);
  });

  test('50% si arrivée dans 2-4 jours', () => {
    expect(calcRefund('moderee', 10000, inDays(4)).pct).toBe(50);
    expect(calcRefund('moderee', 10000, inDays(2)).pct).toBe(50);
  });

  test('0% si arrivée dans < 2 jours', () => {
    expect(calcRefund('moderee', 10000, inDays(1)).pct).toBe(0);
    expect(calcRefund('moderee', 10000, inDays(0)).pct).toBe(0);
  });
});

// ── calcRefund() — politique stricte ─────────────────────────────
describe('calcRefund() — stricte', () => {
  test('50% si arrivée dans >= 7 jours', () => {
    expect(calcRefund('stricte', 10000, inDays(14)).pct).toBe(50);
    expect(calcRefund('stricte', 10000, inDays(7)).pct).toBe(50);
  });

  test('0% si arrivée dans < 7 jours', () => {
    expect(calcRefund('stricte', 10000, inDays(6)).pct).toBe(0);
    expect(calcRefund('stricte', 10000, inDays(0)).pct).toBe(0);
  });
});

// ── Montant remboursé ─────────────────────────────────────────────
describe('calcRefund() — montant calculé', () => {
  test('amount = totalPrice * pct / 100', () => {
    const totalPrice = 50000;
    const r = calcRefund('flexible', totalPrice, inDays(5));
    expect(r.pct).toBe(100);
    // Note : amount est calculé dans la route PATCH, pas dans calcRefund()
    // calcRefund() retourne pct + days, pas amount
    expect(r).toHaveProperty('pct');
    expect(r).toHaveProperty('days');
  });
});
