import { useEffect, useRef, useState, useCallback } from 'react';
import { Button, TextArea } from '@douyinfe/semi-ui';
import * as duckdb from '@duckdb/duckdb-wasm';
import './style.css';

export default function DuckDBConsole() {
  const [logs, setLogs] = useState<string[]>(['Initializing DuckDB WASM...']);
  const [query, setQuery] = useState('SELECT * FROM information_schema.tables LIMIT 5;');
  const [result, setResult] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const dbRef = useRef<duckdb.AsyncDuckDB | null>(null);
  const connRef = useRef<duckdb.AsyncDuckDBConnection | null>(null);

  const addLog = useCallback((msg: string) => {
    setLogs(prev => [...prev, msg]);
  }, []);

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
    addLog(`> ${query.trim()}`);

    try {
      const start = performance.now();
      const arrow = await connRef.current.query(query);
      const duration = (performance.now() - start).toFixed(1);

      const json = arrow.toArray().map((row: any) => row.toJSON());
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
}
