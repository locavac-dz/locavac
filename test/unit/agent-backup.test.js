jest.mock('child_process', () => ({ execFile: jest.fn() }));

const fs   = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const agent = require('../../server/agent');

const URL_DB = 'postgresql://locavac:motdepasse-secret@localhost:5432/locavac';
const BACKUPS_DIR = path.join(__dirname, '..', '..', 'backups');
const alerts = () => agent.state.alerts;

let spies;
beforeEach(() => {
  process.env.DATABASE_URL = URL_DB;
  delete process.env.PG_DUMP_PATH;
  agent.state.alerts.length = 0;
  agent.state.lastBackup = null;
  execFile.mockReset();
  spies = {
    exists:  jest.spyOn(fs, 'existsSync').mockReturnValue(true),
    mkdir:   jest.spyOn(fs, 'mkdirSync').mockImplementation(() => {}),
    readdir: jest.spyOn(fs, 'readdirSync').mockReturnValue([]),
    unlink:  jest.spyOn(fs, 'unlinkSync').mockImplementation(() => {}),
  };
});
afterEach(() => jest.restoreAllMocks());

const succeed = () => execFile.mockImplementation((_bin, _args, _opts, cb) => cb(null, '', ''));
const fail = (err, stderr = '') => execFile.mockImplementation((_bin, _args, _opts, cb) => cb(err, '', stderr));

describe('doBackup — sauvegarde PostgreSQL par pg_dump', () => {
  test('appelle pg_dump sans shell, URL en argument, fichier daté au format custom', async () => {
    succeed();
    const ok = await agent.doBackup();
    expect(ok).toBe(true);
    expect(execFile).toHaveBeenCalledTimes(1);
    const [bin, args, opts] = execFile.mock.calls[0];
    expect(bin).toBe('pg_dump');
    expect(args).toEqual(['--dbname', URL_DB, '--format=custom', '--no-owner', '--file', expect.stringMatching(/[\\/]backups[\\/]locavac_\d{4}-\d{2}-\d{2}\.dump$/)]);
    expect(opts.shell).toBeUndefined();
    expect(opts.timeout).toBeGreaterThan(0);
    expect(agent.state.lastBackup).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(alerts()[0]).toMatchObject({ level: 'info', category: 'backup' });
    expect(alerts()[0].message).toMatch(/locavac_\d{4}-\d{2}-\d{2}\.dump/);
  });

  test('PG_DUMP_PATH remplace le binaire par défaut', async () => {
    process.env.PG_DUMP_PATH = '/usr/lib/postgresql/17/bin/pg_dump';
    succeed();
    await agent.doBackup();
    expect(execFile.mock.calls[0][0]).toBe('/usr/lib/postgresql/17/bin/pg_dump');
  });

  test('crée le dossier backups/ s\'il manque', async () => {
    spies.exists.mockImplementation(p => p !== BACKUPS_DIR);
    succeed();
    await agent.doBackup();
    expect(spies.mkdir).toHaveBeenCalledWith(BACKUPS_DIR, { recursive: true });
  });

  test('rétention : conserve les 7 plus récentes, supprime les plus anciennes, ignore les anciens fichiers dzstay_*.json', async () => {
    const dumps = Array.from({ length: 9 }, (_, i) => `locavac_2026-09-${String(i + 1).padStart(2, '0')}.dump`);
    spies.readdir.mockReturnValue(['dzstay_2026-01-01.json', ...dumps, 'dzstay_2026-01-02.json', 'notes.txt']);
    succeed();
    await agent.doBackup();
    expect(spies.unlink).toHaveBeenCalledTimes(2);
    expect(spies.unlink).toHaveBeenCalledWith(path.join(BACKUPS_DIR, 'locavac_2026-09-01.dump'));
    expect(spies.unlink).toHaveBeenCalledWith(path.join(BACKUPS_DIR, 'locavac_2026-09-02.dump'));
  });

  test('binaire introuvable (ENOENT) : alerte qui indique PG_DUMP_PATH, aucun lastBackup, fichier partiel nettoyé', async () => {
    fail(Object.assign(new Error('spawn pg_dump ENOENT'), { code: 'ENOENT' }));
    const ok = await agent.doBackup();
    expect(ok).toBe(false);
    expect(agent.state.lastBackup).toBeNull();
    expect(alerts()[0]).toMatchObject({ level: 'error', category: 'backup' });
    expect(alerts()[0].message).toMatch(/PG_DUMP_PATH/);
    expect(spies.unlink).toHaveBeenCalledWith(expect.stringMatching(/locavac_\d{4}-\d{2}-\d{2}\.dump$/));
  });

  test('échec de pg_dump : la sortie d\'erreur est remontée dans l\'alerte', async () => {
    fail(new Error('Command failed'), 'pg_dump: error: connection to server failed\n');
    await agent.doBackup();
    expect(alerts()[0].message).toMatch(/connection to server failed/);
  });

  test('DATABASE_URL absent : aucune exécution, alerte explicite', async () => {
    process.env.DATABASE_URL = '';
    const ok = await agent.doBackup();
    expect(ok).toBe(false);
    expect(execFile).not.toHaveBeenCalled();
    expect(alerts()[0].message).toMatch(/DATABASE_URL/);
  });

  test('le mot de passe de la base n\'apparaît dans aucune alerte', async () => {
    fail(new Error(`connection to "${URL_DB}" failed`));
    await agent.doBackup();
    succeed();
    await agent.doBackup();
    for (const a of alerts()) expect(a.message).not.toContain('motdepasse-secret');
  });
});
