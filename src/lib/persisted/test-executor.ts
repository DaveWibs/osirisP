import type { QueryResultRow } from 'pg';

import type { PersistedQueryExecutor } from './database';

/** Test double recording queries and returning canned rows. */
export class FakePersistedExecutor implements PersistedQueryExecutor {
  calls: Array<{ queryText: string; values: unknown[] }> = [];

  constructor(private readonly rows: QueryResultRow[]) {}

  async query<Row extends QueryResultRow>(queryText: string, values: unknown[]): Promise<{ rows: Row[] }> {
    this.calls.push({ queryText, values });
    return { rows: this.rows as Row[] };
  }
}
