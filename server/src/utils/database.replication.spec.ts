import { getReplicatedKyselyConfig } from 'src/utils/database';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import type { CompiledQuery, DatabaseConnection, Dialect, Driver, QueryResult } from 'kysely';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCreatePostgres, mockPostgresJSDialect, recordedCalls } = vi.hoisted(() => {
  const recordedCalls: string[] = [];

  const createRecordingDialect = (label: string): Dialect => {

    const connection: DatabaseConnection = {
      async executeQuery<R>(_compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
        recordedCalls.push(label);
        return { rows: [] } as any;
      },

      async *streamQuery() {
        recordedCalls.push(label);
      },
    };

    const driver: Driver = {
      async init() {},

      async acquireConnection() {
        return connection;
      },

      async beginTransaction() {
        recordedCalls.push(`${label}:begin`);
      },

      async commitTransaction() {
        recordedCalls.push(`${label}:commit`);
      },

      async rollbackTransaction() {
        recordedCalls.push(`${label}:rollback`);
      },

      async releaseConnection() {},

      async destroy() {},
    };

    return {
      createDriver: () => driver,
      createQueryCompiler: () => new PostgresQueryCompiler(),
      createAdapter: () => new PostgresAdapter(),
      createIntrospector: (db: any) => new PostgresIntrospector(db),
    };
  };

  const mockCreatePostgres = vi.fn((options: any) => ({ label: options.connection.label }));

  const mockPostgresJSDialect = vi.fn(function (options: any) {
    return createRecordingDialect(options.postgres.label);
  });

  return { mockCreatePostgres, mockPostgresJSDialect, recordedCalls };
});

vi.mock('@immich/sql-tools', () => ({ createPostgres: mockCreatePostgres }));
vi.mock('kysely-postgres-js', () => ({ PostgresJSDialect: mockPostgresJSDialect }));

const primary = { label: 'primary' } as any;
const replicaA = { label: 'replica' } as any;

beforeEach(() => {
  vi.clearAllMocks();
  recordedCalls.length = 0;
});

describe('read/write routing', () => {
  it('routes reads to a replica and writes to the primary', async () => {
    const db = new Kysely<any>(getReplicatedKyselyConfig(primary, [replicaA]));

    await db.selectFrom('asset').selectAll().execute();
    await db.insertInto('asset').values({ id: '1' }).execute();

    expect(recordedCalls).toEqual(['replica', 'primary']);

    await db.destroy();
  });

  it('routes transactions to the primary, even when they only read', async () => {
    const db = new Kysely<any>(getReplicatedKyselyConfig(primary, [replicaA]));

    await db.transaction().execute(async (trx) => {
      await trx.selectFrom('asset').selectAll().execute();
    });

    expect(recordedCalls).toEqual(['primary:begin', 'primary', 'primary:commit']);

    await db.destroy();
  });
});
