import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Button, TextArea } from '@douyinfe/semi-ui';
import * as duckdb from '@duckdb/duckdb-wasm';
import { IFieldMeta } from '@lark-base-open/js-sdk';
import './style.css';

export interface DuckDBConsoleRef {
  importTable: (
    tableName: string,
    fields: IFieldMeta[],
    records: { recordId: string; fields: Record<string, any> }[]
  ) => Promise<void>;
  query: (sql: string) => Promise<any[]>;
}

function cellValueToString(val: any): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean' || typeof val === 'bigint') return String(val);
  if (Array.isArray(val)) {
    // Rich text segments or similar arrays: extract .text or .name
    const texts = val
      .map((seg: any) => {
        if (seg && typeof seg.text === 'string') return seg.text;
        if (seg && typeof seg.text === 'number') return String(seg.text);
        if (seg && typeof seg.name === 'string') return seg.name;
        if (seg && typeof seg.name === 'number') return String(seg.name);
        return cellValueToString(seg);
      })
      .filter((s: string) => s !== '');
    if (texts.length > 0) return texts.join('');
  }
  if (typeof val === 'object') {
    if (typeof val.text === 'string' || typeof val.text === 'number') return String(val.text);
    if (typeof val.name === 'string' || typeof val.name === 'number') return String(val.name);
  }
  return JSON.stringify(val);
}

function escapeSqlString(str: string): string {
  return str.replace(/'/g, "''");
}

function sanitizeColumnName(name: string): string {
  return name.replace(/"/g, '""');
}

const DuckDBConsole = forwardRef<DuckDBConsoleRef>(function DuckDBConsole(_, ref) {
  const [logs, setLogs] = useState<string[]>(['Initializing DuckDB WASM...']);
  const [query, setQuery] = useState('SELECT * FROM information_schema.tables LIMIT 5;');
  const [result, setResult] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const dbRef = useRef<duckdb.AsyncDuckDB | null>(null);
  const connRef = useRef<duckdb.AsyncDuckDBConnection | null>(null);

  const addLog = useCallback((msg: string) => {
    setLogs(prev => [...prev, msg]);
  }, []);

  useImperativeHandle(ref, () => ({
    importTable: async (tableName, fields, records) => {
      if (!connRef.current) {
        addLog('DuckDB not ready yet.');
        throw new Error('DuckDB not ready yet.');
      }
      setLoading(true);
      addLog(`Importing table "${tableName}" (${records.length} rows)...`);

      try {
        const safeTableName = sanitizeColumnName(tableName);
        const colDefs = [
          '"record_id" VARCHAR',
          ...fields.map(f => `"${sanitizeColumnName(f.name)}" VARCHAR`)
        ].join(', ');
        await connRef.current.query(`CREATE OR REPLACE TABLE "${safeTableName}" (${colDefs})`);

        const BATCH_SIZE = 100;
        for (let i = 0; i < records.length; i += BATCH_SIZE) {
          const batch = records.slice(i, i + BATCH_SIZE);
          const values = batch
            .map(r => {
              const rowValues = [
                `'${escapeSqlString(r.recordId)}'`,
                ...fields.map(f => {
                  const str = cellValueToString(r.fields[f.id]);
                  return `'${escapeSqlString(str)}'`;
                })
              ];
              return `(${rowValues.join(', ')})`;
            })
            .join(', ');

          const colNames = [
            '"record_id"',
            ...fields.map(f => `"${sanitizeColumnName(f.name)}"`)
          ].join(', ');
          await connRef.current.query(`INSERT INTO "${safeTableName}" (${colNames}) VALUES ${values}`);
        }

        addLog(`Table "${tableName}" imported successfully.`);
        setQuery(`SELECT * FROM "${safeTableName}" LIMIT 10;`);
      } catch (e: any) {
        const msg = e.message || String(e);
        addLog(`Import error: ${msg}`);
        throw e;
      } finally {
        setLoading(false);
      }
    },

    query: async (sql: string) => {
      if (!connRef.current) {
        throw new Error('DuckDB not ready yet.');
      }
      addLog(`> ${sql.trim()}`);
      const arrow = await connRef.current.query(sql);
      const json = arrow.toArray().map((row: any) => row.toJSON());
      addLog(`Query OK (${json.length} rows)`);
      return json;
    },
  }), [addLog]);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
        const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);

        const worker_url = URL.createObjectURL(
          new Blob([`importScripts("${bundle.mainWorker!}");`], { type: 'text/javascript' })
        );
        const worker = new Worker(worker_url);
        const logger = new duckdb.ConsoleLogger();
        const db = new duckdb.AsyncDuckDB(logger, worker);
        await db.instantiate(bundle.mainModule, bundle.pthreadWorker);

        if (cancelled) {
          db.terminate();
          return;
        }

        dbRef.current = db;
        const conn = await db.connect();
        connRef.current = conn;

        addLog('DuckDB WASM ready.');
      } catch (e: any) {
        addLog(`Init error: ${e.message || String(e)}`);
      }
    }

    init();

    return () => {
      cancelled = true;
      connRef.current?.close();
      dbRef.current?.terminate();
    };
  }, [addLog]);

  const runQuery = useCallback(async () => {
    if (!connRef.current) {
      addLog('DuckDB not ready yet.');
      return;
    }
    setLoading(true);
    setResult('');

    try {
      const start = performance.now();
      const json = await (ref as any).current?.query?.(query);
      const duration = (performance.now() - start).toFixed(1);

      const output = JSON.stringify(json, null, 2);
      setResult(output);
      addLog(`Query OK (${json.length} rows, ${duration}ms)`);
    } catch (e: any) {
      const msg = e.message || String(e);
      setResult(`Error: ${msg}`);
      addLog(`Error: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, [query, addLog]);

  return (
    <div className="duckdb-console">
      <div className="duckdb-header">
        <strong>DuckDB WASM Console</strong>
        <span className="duckdb-status" data-ready={!!connRef.current}>
          {connRef.current ? '● Ready' : '○ Initializing…'}
        </span>
      </div>

      <TextArea
        className="duckdb-input"
        value={query}
        onChange={(v) => setQuery(v)}
        rows={3}
        placeholder="Enter SQL query..."
      />

      <Button theme="solid" loading={loading} onClick={runQuery} block style={{ marginTop: 8 }}>
        Run Query
      </Button>

      <div className="duckdb-result">
        <div className="duckdb-section-title">Result</div>
        <pre>{result || '-- No output --'}</pre>
      </div>

      <div className="duckdb-log">
        <div className="duckdb-section-title">Console</div>
        <pre>
          {logs.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </pre>
      </div>
    </div>
  );
});

export default DuckDBConsole;
