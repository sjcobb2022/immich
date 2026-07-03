import { getKyselyConfig, getReplicatedKyselyConfig, getSingleInstanceKyselyConfig } from 'src/utils/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocks for external dialect/driver dependencies ---------------------------------------

const mockCreatePostgres = vi.fn((opts: any) => ({ __postgresInstance: true, opts }));
vi.mock('@immich/sql-tools', () => ({
  createPostgres: (opts: any) => mockCreatePostgres(opts),
}));

class MockPostgresJSDialect {
  public options: any;
  constructor(options: any) {
    this.options = options;
  }
}
vi.mock('kysely-postgres-js', () => ({
  PostgresJSDialect: vi.fn().mockImplementation((options: any) => new MockPostgresJSDialect(options)),
}));

class MockKyselyReplicationDialect {
  public options: any;
  constructor(options: any) {
    this.options = options;
  }
}
vi.mock('kysely-replication', () => ({
  KyselyReplicationDialect: vi.fn().mockImplementation((options: any) => new MockKyselyReplicationDialect(options)),
}));

class MockRoundRobinReplicaStrategy {
  public options: any;
  constructor(options: any) {
    this.options = options;
  }
}
vi.mock('kysely-replication/strategy/round-robin', () => ({
  RoundRobinReplicaStrategy: vi.fn().mockImplementation((options: any) => new MockRoundRobinReplicaStrategy(options)),
}));

// --- Fixtures -------------------------------------------------------------------------------

const primaryConnection = { host: 'primary-host' } as any;
const replicaConnectionA = { host: 'replica-a' } as any;
const replicaConnectionB = { host: 'replica-b' } as any;

describe('getSingleInstanceKyselyConfig', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should build a config with a single PostgresJSDialect wrapping the given connection', () => {
    const config = getSingleInstanceKyselyConfig(primaryConnection);

    expect(config.dialect).toBeInstanceOf(MockPostgresJSDialect);
    expect(mockCreatePostgres).toHaveBeenCalledWith(expect.objectContaining({ connection: primaryConnection }));
  });

  it('should attach a log function to the config', () => {
    const config = getSingleInstanceKyselyConfig(primaryConnection);
    expect(typeof config.log).toBe('function');
  });
});

describe('getReplicatedKyselyConfig', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should build a KyselyReplicationDialect with one primary dialect', () => {
    const config = getReplicatedKyselyConfig(primaryConnection, [replicaConnectionA]);
    const dialect = config.dialect as unknown as MockKyselyReplicationDialect;

    expect(dialect).toBeInstanceOf(MockKyselyReplicationDialect);
    expect(dialect.options.primaryDialect).toBeInstanceOf(MockPostgresJSDialect);
  });

  it('should build one replica dialect per replica connection provided', () => {
    const config = getReplicatedKyselyConfig(primaryConnection, [replicaConnectionA, replicaConnectionB]);
    const dialect = config.dialect as unknown as MockKyselyReplicationDialect;

    expect(dialect.options.replicaDialects).toHaveLength(2);
    for (const replicaDialect of dialect.options.replicaDialects) {
      expect(replicaDialect).toBeInstanceOf(MockPostgresJSDialect);
    }
  });

  it('should configure the replica strategy as round robin with onTransaction: error', () => {
    const config = getReplicatedKyselyConfig(primaryConnection, [replicaConnectionA]);
    const dialect = config.dialect as unknown as MockKyselyReplicationDialect;

    expect(dialect.options.replicaStrategy).toBeInstanceOf(MockRoundRobinReplicaStrategy);
    expect(dialect.options.replicaStrategy.options).toEqual({ onTransaction: 'error' });
  });

  it('should pass the primary connection through to createPostgres', () => {
    getReplicatedKyselyConfig(primaryConnection, [replicaConnectionA]);

    expect(mockCreatePostgres).toHaveBeenCalledWith(expect.objectContaining({ connection: primaryConnection }));
  });

  it('should pass each replica connection through to createPostgres', () => {
    getReplicatedKyselyConfig(primaryConnection, [replicaConnectionA, replicaConnectionB]);

    expect(mockCreatePostgres).toHaveBeenCalledWith(expect.objectContaining({ connection: replicaConnectionA }));
    expect(mockCreatePostgres).toHaveBeenCalledWith(expect.objectContaining({ connection: replicaConnectionB }));
  });

  it('should attach a log function to the config', () => {
    const config = getReplicatedKyselyConfig(primaryConnection, [replicaConnectionA]);
    expect(typeof config.log).toBe('function');
  });
});

describe('getKyselyConfig', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should return a single-instance config when enableReplicas is not set', () => {
    const config = getKyselyConfig(primaryConnection);
    expect(config.dialect).toBeInstanceOf(MockPostgresJSDialect);
  });

  it('should return a single-instance config when enableReplicas is false', () => {
    const config = getKyselyConfig(primaryConnection, false);
    expect(config.dialect).toBeInstanceOf(MockPostgresJSDialect);
  });

  it('should throw if enableReplicas is true but no replicas are provided', () => {
    expect(() => getKyselyConfig(primaryConnection, true)).toThrow(
      'enableReplicas is true but no replicas were configured',
    );
  });

  it('should return a replicated config when enableReplicas is true and replicas are provided', () => {
    const config = getKyselyConfig(primaryConnection, true, [replicaConnectionA]);
    expect(config.dialect).toBeInstanceOf(MockKyselyReplicationDialect);
  });

  it('should return a replicated config with multiple replicas', () => {
    const config = getKyselyConfig(primaryConnection, true, [replicaConnectionA, replicaConnectionB]);
    const dialect = config.dialect as unknown as MockKyselyReplicationDialect;

    expect(dialect.options.replicaDialects).toHaveLength(2);
  });
});

describe('config.log (query logger)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should log an error event to the console', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const config = getSingleInstanceKyselyConfig(primaryConnection);

  if (typeof config.log === 'function') {
    await config.log({
      level: 'error',
      error: new Error('error'),
      queryDurationMillis: 12,
      query: {
        query: 'select 1',
        queryId: 'test-query',
        parameters: [],
      } as any,
    });
  }

    expect(consoleErrorSpy).toHaveBeenCalledOnce();
    consoleErrorSpy.mockRestore();
  });

  it('should suppress logging for asset checksum constraint violations', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const config = getSingleInstanceKyselyConfig(primaryConnection);


  if (typeof config.log === 'function') {
    await config.log({
      level: 'error',
      error: { constraint_name: 'UQ_assets_owner_checksum' },
      queryDurationMillis: 12,
      query: {
        query: 'insert into asset ...',
        queryId: 'test-query',
        parameters: [],
      } as any,
    });
  }

    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('should not log anything for non-error level events', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const config = getSingleInstanceKyselyConfig(primaryConnection);

  if (typeof config.log === 'function') {
    await config.log({
      level: 'query',
      queryDurationMillis: 12,
      query: {
        query: 'select 1',
        queryId: 'test-query',
        parameters: [],
      } as any,
    });
  }

    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});

describe('notice handling', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should label notices from the primary connection as "Primary"', () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    getReplicatedKyselyConfig(primaryConnection, [replicaConnectionA]);

    const primaryCall = mockCreatePostgres.mock.calls.find((call) => call[0].connection === primaryConnection);
    primaryCall![0].onNotice({ severity: 'WARNING', message: 'careful' });

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'Primary Postgres notice:',
      expect.objectContaining({ severity: 'WARNING' }),
    );
    consoleWarnSpy.mockRestore();
  });

  it('should label notices from replica connections as "Replica"', () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    getReplicatedKyselyConfig(primaryConnection, [replicaConnectionA]);

    const replicaCall = mockCreatePostgres.mock.calls.find((call) => call[0].connection === replicaConnectionA);
    replicaCall![0].onNotice({ severity: 'WARNING', message: 'careful' });

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'Replica Postgres notice:',
      expect.objectContaining({ severity: 'WARNING' }),
    );
    consoleWarnSpy.mockRestore();
  });

  it('should not warn for plain NOTICE severity', () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    getSingleInstanceKyselyConfig(primaryConnection);

    const call = mockCreatePostgres.mock.calls[0];
    call[0].onNotice({ severity: 'NOTICE', message: 'fyi' });

    expect(consoleWarnSpy).not.toHaveBeenCalled();
    consoleWarnSpy.mockRestore();
  });
});
