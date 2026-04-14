import './App.css';
import { bitable, ITableMeta, IFieldMeta, FieldType } from "@lark-base-open/js-sdk";
import { Button, Form, Modal, Toast } from '@douyinfe/semi-ui';
import { BaseFormApi } from '@douyinfe/semi-foundation/lib/es/form/interface';
import { useState, useEffect, useRef, useCallback } from 'react';
import DuckDBConsole, { DuckDBConsoleRef } from './components/DuckDBConsole';

function cellValueToString(val: any): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean' || typeof val === 'bigint') return String(val);
  if (Array.isArray(val)) {
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

type Mode = 'column' | 'table' | 'config';

interface PreviewRow {
  recordId: string;
  valueCol: string;
  value: string;
  targetFieldName: string;
  willWrite: boolean;
}

interface ConfigItem {
  recordId: string;
  name: string;
  mode: Mode;
  sql: string;
  selectedTableId: string;
  targetFieldId: string;
  inputTableId: string;
  outputTableId: string;
}

const CONFIG_TABLE_NAME = '🦆DuckDB_Extension_Config';

export default function App() {
  const [tableMetaList, setTableMetaList] = useState<ITableMeta[]>();
  const [mode, setMode] = useState<Mode>('column');

  // Shared
  const [selectedTableId, setSelectedTableId] = useState<string>('');
  const [allFields, setAllFields] = useState<IFieldMeta[]>([]);

  // Column mode
  const [columnSql, setColumnSql] = useState<string>('');
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [previewing, setPreviewing] = useState(false);

  // Table mode
  const [inputTableId, setInputTableId] = useState<string>('');
  const [outputTableId, setOutputTableId] = useState<string>('');
  const [tableSql, setTableSql] = useState<string>('');

  // Config
  const [configTableId, setConfigTableId] = useState<string>('');
  const [configs, setConfigs] = useState<ConfigItem[]>([]);
  const [saveName, setSaveName] = useState<string>('');
  const [editingConfig, setEditingConfig] = useState<ConfigItem | null>(null);

  const [writing, setWriting] = useState(false);
  const [loadingDuckDB, setLoadingDuckDB] = useState(false);
  const [loadingConfigs, setLoadingConfigs] = useState(false);
  const formApi = useRef<BaseFormApi>();
  const duckdbRef = useRef<DuckDBConsoleRef>(null);

  const addRecord = useCallback(async ({ table: tableId }: { table: string }) => {
    if (tableId) {
      const table = await bitable.base.getTableById(tableId);
      table.addRecord({ fields: {} });
    }
  }, []);

  const loadTableIntoDuckDB = useCallback(async (tableId: string) => {
    if (!tableId || !duckdbRef.current) return;
    setLoadingDuckDB(true);
    try {
      const table = await bitable.base.getTableById(tableId);
      const [meta, fields] = await Promise.all([table.getMeta(), table.getFieldMetaList()]);

      const records: any[] = [];
      let pageToken: string | undefined;
      do {
        const res = await table.getRecords({ pageSize: 200, pageToken });
        records.push(...res.records);
        pageToken = res.pageToken;
      } while (pageToken);

      await duckdbRef.current.importTable(meta.name, fields as IFieldMeta[], records);
    } finally {
      setLoadingDuckDB(false);
    }
  }, []);

  // Initialize config table and load configs
  const ensureConfigTable = useCallback(async () => {
    const metaList = await bitable.base.getTableMetaList();
    const existing = metaList.find((t) => t.name === CONFIG_TABLE_NAME);
    if (existing) {
      setConfigTableId(existing.id);
      return existing.id;
    }
    const result = await bitable.base.addTable({
      name: CONFIG_TABLE_NAME,
      fields: [
        { name: 'Name', type: FieldType.Text, property: null } as any,
        { name: 'Mode', type: FieldType.Text, property: null } as any,
        { name: 'SQL', type: FieldType.Text, property: null } as any,
        { name: 'SelectedTableId', type: FieldType.Text, property: null } as any,
        { name: 'TargetFieldId', type: FieldType.Text, property: null } as any,
        { name: 'InputTableId', type: FieldType.Text, property: null } as any,
        { name: 'OutputTableId', type: FieldType.Text, property: null } as any,
      ],
    });
    setConfigTableId(result.tableId);
    return result.tableId;
  }, []);

  const loadConfigs = useCallback(async (cfgTableId?: string) => {
    const id = cfgTableId || configTableId;
    if (!id) return;
    setLoadingConfigs(true);
    try {
      const table = await bitable.base.getTableById(id);
      const fields = await table.getFieldMetaList() as IFieldMeta[];
      const fieldMap = new Map(fields.map((f) => [f.name, f.id]));

      const records: any[] = [];
      let pageToken: string | undefined;
      do {
        const res = await table.getRecords({ pageSize: 200, pageToken });
        records.push(...res.records);
        pageToken = res.pageToken;
      } while (pageToken);

      const list: ConfigItem[] = records.map((r) => ({
        recordId: r.recordId,
        name: cellValueToString(r.fields[fieldMap.get('Name')!]),
        mode: (cellValueToString(r.fields[fieldMap.get('Mode')!]) as Mode) || 'column',
        sql: cellValueToString(r.fields[fieldMap.get('SQL')!]),
        selectedTableId: cellValueToString(r.fields[fieldMap.get('SelectedTableId')!]),
        targetFieldId: cellValueToString(r.fields[fieldMap.get('TargetFieldId')!]),
        inputTableId: cellValueToString(r.fields[fieldMap.get('InputTableId')!]),
        outputTableId: cellValueToString(r.fields[fieldMap.get('OutputTableId')!]),
      }));
      setConfigs(list);
    } catch (e: any) {
      Toast.error(`Load configs failed: ${e.message || String(e)}`);
    } finally {
      setLoadingConfigs(false);
    }
  }, [configTableId]);

  const saveConfig = useCallback(async () => {
    if (!configTableId) return;
    const name = saveName.trim();
    if (!name) {
      Toast.warning('Please enter a config name');
      return;
    }

    const table = await bitable.base.getTableById(configTableId);
    const fields = await table.getFieldMetaList() as IFieldMeta[];
    const fieldMap = new Map(fields.map((f) => [f.name, f.id]));

    const payload = {
      [fieldMap.get('Name')!]: name,
      [fieldMap.get('Mode')!]: mode === 'config' ? 'column' : mode,
      [fieldMap.get('SQL')!]: mode === 'table' ? tableSql : columnSql,
      [fieldMap.get('SelectedTableId')!]: selectedTableId,
      [fieldMap.get('TargetFieldId')!]: '',
      [fieldMap.get('InputTableId')!]: inputTableId,
      [fieldMap.get('OutputTableId')!]: outputTableId,
    };

    try {
      if (editingConfig) {
        await table.setRecord(editingConfig.recordId, { fields: payload });
        Toast.success('Config updated');
      } else {
        await table.addRecord({ fields: payload });
        Toast.success('Config saved');
      }
      setSaveName('');
      setEditingConfig(null);
      await loadConfigs(configTableId);
    } catch (e: any) {
      Toast.error(`Save failed: ${e.message || String(e)}`);
    }
  }, [configTableId, mode, columnSql, tableSql, selectedTableId, inputTableId, outputTableId, saveName, editingConfig, loadConfigs]);

  const deleteConfig = useCallback(async (recordId: string) => {
    if (!configTableId) return;
    Modal.warning({
      title: 'Delete Config',
      content: 'Are you sure you want to delete this config?',
      onOk: async () => {
        try {
          const table = await bitable.base.getTableById(configTableId);
          await table.deleteRecord(recordId);
          Toast.success('Config deleted');
          if (editingConfig?.recordId === recordId) {
            setEditingConfig(null);
            setSaveName('');
          }
          await loadConfigs(configTableId);
        } catch (e: any) {
          Toast.error(`Delete failed: ${e.message || String(e)}`);
        }
      },
    });
  }, [configTableId, editingConfig, loadConfigs]);

  const applyConfig = useCallback((cfg: ConfigItem) => {
    setMode(cfg.mode);
    if (cfg.mode === 'column') {
      setSelectedTableId(cfg.selectedTableId);
      setColumnSql(cfg.sql);
      formApi.current?.setValues({ table: cfg.selectedTableId, sql: cfg.sql });
    } else if (cfg.mode === 'table') {
      setInputTableId(cfg.inputTableId);
      setOutputTableId(cfg.outputTableId);
      setTableSql(cfg.sql);
    }
    Toast.success(`Loaded config: ${cfg.name}`);
  }, []);

  const startEditConfig = useCallback((cfg: ConfigItem) => {
    setEditingConfig(cfg);
    setSaveName(cfg.name);
    if (cfg.mode === 'column') {
      setMode('column');
      setSelectedTableId(cfg.selectedTableId);
      setColumnSql(cfg.sql);
      formApi.current?.setValues({ table: cfg.selectedTableId, sql: cfg.sql });
    } else if (cfg.mode === 'table') {
      setMode('table');
      setInputTableId(cfg.inputTableId);
      setOutputTableId(cfg.outputTableId);
      setTableSql(cfg.sql);
    }
  }, []);

  useEffect(() => {
    Promise.all([bitable.base.getTableMetaList(), bitable.base.getSelection()])
      .then(([metaList, selection]) => {
        setTableMetaList(metaList);
        formApi.current?.setValues({ table: selection.tableId });
        setSelectedTableId(selection.tableId ?? '');
        setInputTableId(selection.tableId ?? '');
      });
  }, []);

  useEffect(() => {
    ensureConfigTable().then((id) => {
      loadConfigs(id);
    });
  }, [ensureConfigTable, loadConfigs]);

  useEffect(() => {
    if (!selectedTableId) {
      setAllFields([]);
      return;
    }
    bitable.base.getTableById(selectedTableId).then((table) => {
      table.getFieldMetaList().then((fields) => {
        setAllFields(fields as IFieldMeta[]);
      });
    });
    loadTableIntoDuckDB(selectedTableId);
  }, [selectedTableId, loadTableIntoDuckDB]);

  useEffect(() => {
    if (inputTableId) {
      loadTableIntoDuckDB(inputTableId);
    }
  }, [inputTableId, loadTableIntoDuckDB]);

  const buildColumnSql = useCallback(async () => {
    if (!selectedTableId || !columnSql.trim()) return null;
    const table = await bitable.base.getTableById(selectedTableId);
    const meta = await table.getMeta();

    let sql = columnSql.trim();
    const fieldMap = new Map(allFields.map((f) => [f.name.toLowerCase(), f.name]));
    sql = sql.replace(/\{([^}]+)\}/g, (_, raw) => {
      const actual = fieldMap.get(raw.toLowerCase());
      const col = actual ?? raw;
      return `"${col.replace(/"/g, '""')}"`;
    });

    if (!/\bFROM\b/i.test(sql)) {
      sql += ` FROM "${meta.name.replace(/"/g, '""')}"`;
    }
    if (!/["`]?record_id["`]?/i.test(sql)) {
      sql = sql.replace(/\bFROM\b/i, ', "record_id" FROM');
    }
    return sql;
  }, [selectedTableId, columnSql, allFields]);

  const previewColumnMode = useCallback(async () => {
    if (!selectedTableId || !columnSql.trim()) return;
    setPreviewing(true);
    setPreviewRows([]);
    try {
      const sql = await buildColumnSql();
      if (!sql) return;
      await loadTableIntoDuckDB(selectedTableId);
      const rows = await duckdbRef.current?.query(sql);
      if (!rows || rows.length === 0) {
        alert('Query returned no rows.');
        return;
      }

      const preview: PreviewRow[] = [];
      for (const row of rows.slice(0, 10)) {
        const recordId = String(row.record_id ?? '');
        const valueCol = Object.keys(row).find((k) => k.toLowerCase() !== 'record_id') ?? '';
        const value = valueCol ? (row[valueCol] === null || row[valueCol] === undefined ? '' : String(row[valueCol])) : '';
        const targetField = valueCol ? allFields.find((f) => f.name.toLowerCase() === valueCol.toLowerCase()) : undefined;
        preview.push({
          recordId,
          valueCol,
          value,
          targetFieldName: targetField?.name ?? '(no match)',
          willWrite: !!targetField && (targetField as any).type === FieldType.Text,
        });
      }
      setPreviewRows(preview);
    } catch (e: any) {
      alert(`Preview error: ${e.message || String(e)}`);
    } finally {
      setPreviewing(false);
    }
  }, [selectedTableId, columnSql, buildColumnSql, loadTableIntoDuckDB, allFields]);

  const runColumnMode = useCallback(async () => {
    if (!selectedTableId || !columnSql.trim()) return;
    setWriting(true);

    try {
      const table = await bitable.base.getTableById(selectedTableId);
      const sql = await buildColumnSql();
      if (!sql) return;
      await loadTableIntoDuckDB(selectedTableId);

      const rows = await duckdbRef.current?.query(sql);
      if (!rows || rows.length === 0) {
        alert('Query returned no rows.');
        return;
      }

      for (const row of rows) {
        const recordId = String(row.record_id ?? '');
        if (!recordId) continue;
        const valueCol = Object.keys(row).find((k) => k.toLowerCase() !== 'record_id');
        if (!valueCol) continue;

        const targetField = allFields.find((f) => f.name.toLowerCase() === valueCol.toLowerCase());
        if (!targetField) {
          alert(`No field matching output column "${valueCol}" found.`);
          continue;
        }
        if ((targetField as any).type !== FieldType.Text) {
          alert(`Field "${targetField.name}" is not a text field.`);
          continue;
        }

        const textValue = row[valueCol] === null || row[valueCol] === undefined ? '' : String(row[valueCol]);
        await table.setCellValue(targetField.id, recordId, [{ type: 'text', text: textValue }] as any);
      }

      alert(`Updated ${rows.length} records.`);
    } catch (e: any) {
      alert(`Error: ${e.message || String(e)}`);
    } finally {
      setWriting(false);
    }
  }, [selectedTableId, columnSql, buildColumnSql, loadTableIntoDuckDB, allFields]);

  const runTableMode = useCallback(async () => {
    if (!inputTableId || !outputTableId || !tableSql.trim()) return;
    setWriting(true);

    try {
      const inputTable = await bitable.base.getTableById(inputTableId);
      const outputTable = await bitable.base.getTableById(outputTableId);
      const [inputMeta] = await Promise.all([
        inputTable.getMeta(),
      ]);

      await loadTableIntoDuckDB(inputTableId);

      let sql = tableSql.trim();
      if (!/\bFROM\b/i.test(sql)) {
        sql += ` FROM "${inputMeta.name.replace(/"/g, '""')}"`;
      }

      const rows = await duckdbRef.current?.query(sql);
      if (!rows || rows.length === 0) {
        alert('Query returned no rows.');
        return;
      }

      let outputFields = (await outputTable.getFieldMetaList()) as IFieldMeta[];
      const sqlColumns = Object.keys(rows[0] || {});
      const outputFieldMap = new Map(outputFields.map((f) => [f.name.toLowerCase(), f.id]));

      // Create missing fields as text
      for (const col of sqlColumns) {
        if (!outputFieldMap.has(col.toLowerCase())) {
          await outputTable.addField({
            name: col,
            type: FieldType.Text,
            property: null,
          } as any);
        }
      }

      // Re-fetch if we created any fields
      if (sqlColumns.some((col) => !outputFieldMap.has(col.toLowerCase()))) {
        outputFields = (await outputTable.getFieldMetaList()) as IFieldMeta[];
      }

      // Build final column -> fieldId map
      const finalFieldMap = new Map(outputFields.map((f) => [f.name.toLowerCase(), f.id]));
      const mappedCols = sqlColumns
        .map((col) => ({ col, fieldId: finalFieldMap.get(col.toLowerCase()) }))
        .filter((x): x is { col: string; fieldId: string } => !!x.fieldId);

      // Delete all existing records in output table
      const existingRecordIds: string[] = [];
      let pageToken: string | undefined;
      do {
        const res = await outputTable.getRecords({ pageSize: 200, pageToken });
        existingRecordIds.push(...res.records.map((r) => r.recordId));
        pageToken = res.pageToken;
      } while (pageToken);

      if (existingRecordIds.length > 0) {
        const BATCH_DEL = 200;
        for (let i = 0; i < existingRecordIds.length; i += BATCH_DEL) {
          await outputTable.deleteRecords(existingRecordIds.slice(i, i + BATCH_DEL));
        }
      }

      const BATCH_ADD = 100;
      let addedCount = 0;
      for (let i = 0; i < rows.length; i += BATCH_ADD) {
        const batch = rows.slice(i, i + BATCH_ADD);
        const recordValues = batch.map((row) => {
          const fields: Record<string, any> = {};
          for (const { col, fieldId } of mappedCols) {
            const val = row[col];
            fields[fieldId] = val === null || val === undefined ? '' : String(val);
          }
          return { fields };
        });
        await outputTable.addRecords(recordValues);
        addedCount += recordValues.length;
      }

      alert(`Deleted ${existingRecordIds.length} records and inserted ${addedCount} records into output table.`);
    } catch (e: any) {
      alert(`Error: ${e.message || String(e)}`);
    } finally {
      setWriting(false);
    }
  }, [inputTableId, outputTableId, tableSql, loadTableIntoDuckDB]);

  return (
    <main className="main">
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button theme={mode === 'column' ? 'solid' : 'light'} onClick={() => setMode('column')}>
            Column Mode
          </Button>
          <Button theme={mode === 'table' ? 'solid' : 'light'} onClick={() => setMode('table')}>
            Table Mode
          </Button>
          <Button theme={mode === 'config' ? 'solid' : 'light'} onClick={() => setMode('config')}>
            Config
          </Button>
        </div>
        <Button
          theme='light'
          loading={loadingDuckDB}
          onClick={() => loadTableIntoDuckDB(mode === 'column' ? selectedTableId : inputTableId)}
        >
          Refresh
        </Button>
      </div>

      {mode === 'column' && (
        <Form
          labelPosition='top'
          onSubmit={addRecord}
          getFormApi={(baseFormApi: BaseFormApi) => (formApi.current = baseFormApi)}
          onValueChange={(v) => setSelectedTableId(v.table)}
        >
          <Form.Select
            field='table'
            label='Select Table'
            placeholder="Please select a Table"
            style={{ width: '100%' }}
          >
            {Array.isArray(tableMetaList) &&
              tableMetaList.map(({ name, id }) => (
                <Form.Select.Option key={id} value={id}>
                  {name}
                </Form.Select.Option>
              ))}
          </Form.Select>

          <Form.TextArea
            field='sql'
            label='SQL (supports {field_name} placeholders)'
            placeholder={`SELECT upper({Text}) AS result`}
            rows={2}
            style={{ width: '100%', marginTop: 12 }}
            initValue={columnSql}
            onChange={(v) => setColumnSql(v as string)}
          />

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <Button
              theme='solid'
              type='tertiary'
              loading={previewing || loadingDuckDB}
              onClick={previewColumnMode}
              style={{ flex: 1 }}
            >
              Preview
            </Button>
            <Button
              theme='solid'
              type='warning'
              loading={writing || loadingDuckDB}
              onClick={runColumnMode}
              style={{ flex: 1 }}
            >
              Run & Write
            </Button>
          </div>

          {previewRows.length > 0 && (
            <div style={{ marginTop: 16, overflowX: 'auto' }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: '#4e5969' }}>
                Preview (first {previewRows.length} rows)
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, border: '1px solid #e5e6eb' }}>
                <thead>
                  <tr style={{ background: '#f2f3f5' }}>
                    <th style={{ padding: '6px 8px', border: '1px solid #e5e6eb', textAlign: 'left' }}>record_id</th>
                    <th style={{ padding: '6px 8px', border: '1px solid #e5e6eb', textAlign: 'left' }}>Output Value</th>
                    <th style={{ padding: '6px 8px', border: '1px solid #e5e6eb', textAlign: 'left' }}>Matched Field</th>
                    <th style={{ padding: '6px 8px', border: '1px solid #e5e6eb', textAlign: 'left' }}>Will Write?</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((r, i) => (
                    <tr key={i}>
                      <td style={{ padding: '6px 8px', border: '1px solid #e5e6eb' }}>{r.recordId}</td>
                      <td style={{ padding: '6px 8px', border: '1px solid #e5e6eb' }}>{r.value}</td>
                      <td style={{ padding: '6px 8px', border: '1px solid #e5e6eb' }}>{r.targetFieldName}</td>
                      <td style={{ padding: '6px 8px', border: '1px solid #e5e6eb', color: r.willWrite ? '#00b42a' : '#f53f3f' }}>
                        {r.willWrite ? 'Yes' : 'No'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ marginTop: 16, padding: 12, border: '1px solid #e5e6eb', borderRadius: 6, background: '#fafbfc' }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: '#4e5969' }}>
              Save Current Config
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type='text'
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder={editingConfig ? `Updating: ${editingConfig.name}` : 'Enter config name'}
                style={{ flex: 1, padding: '6px 10px', border: '1px solid #c9cdd4', borderRadius: 4, fontSize: 13 }}
              />
              <Button theme='solid' onClick={saveConfig}>
                {editingConfig ? 'Update' : 'Save'}
              </Button>
              {editingConfig && (
                <Button theme='light' onClick={() => { setEditingConfig(null); setSaveName(''); }}>
                  Cancel
                </Button>
              )}
            </div>
          </div>
        </Form>
      )}

      {mode === 'table' && (
        <Form labelPosition='top'>
          <Form.Select
            field='inputTable'
            label='Input Table'
            placeholder="Please select input table"
            style={{ width: '100%' }}
            onChange={(v) => setInputTableId(v as string)}
          >
            {Array.isArray(tableMetaList) &&
              tableMetaList.map(({ name, id }) => (
                <Form.Select.Option key={id} value={id}>
                  {name}
                </Form.Select.Option>
              ))}
          </Form.Select>

          <Form.Select
            field='outputTable'
            label='Output Table'
            placeholder="Please select output table"
            style={{ width: '100%', marginTop: 12 }}
            onChange={(v) => setOutputTableId(v as string)}
          >
            {Array.isArray(tableMetaList) &&
              tableMetaList.map(({ name, id }) => (
                <Form.Select.Option key={id} value={id}>
                  {name}
                </Form.Select.Option>
              ))}
          </Form.Select>

          <Form.TextArea
            field='tableSql'
            label='SQL against Input Table'
            placeholder={`SELECT "Name", upper("Name") AS "Updated Name" FROM "Input Table"`}
            rows={3}
            style={{ width: '100%', marginTop: 12 }}
            initValue={tableSql}
            onChange={(v) => setTableSql(v as string)}
          />

          <Button
            theme='solid'
            type='warning'
            loading={writing || loadingDuckDB}
            onClick={runTableMode}
            block
            style={{ marginTop: 8 }}
          >
            Run SQL & Update Output Table by Name
          </Button>

          <div style={{ marginTop: 16, padding: 12, border: '1px solid #e5e6eb', borderRadius: 6, background: '#fafbfc' }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: '#4e5969' }}>
              Save Current Config
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type='text'
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder={editingConfig ? `Updating: ${editingConfig.name}` : 'Enter config name'}
                style={{ flex: 1, padding: '6px 10px', border: '1px solid #c9cdd4', borderRadius: 4, fontSize: 13 }}
              />
              <Button theme='solid' onClick={saveConfig}>
                {editingConfig ? 'Update' : 'Save'}
              </Button>
              {editingConfig && (
                <Button theme='light' onClick={() => { setEditingConfig(null); setSaveName(''); }}>
                  Cancel
                </Button>
              )}
            </div>
          </div>
        </Form>
      )}

      {mode === 'config' && (
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Saved Configs</div>
          {loadingConfigs ? (
            <div style={{ fontSize: 13, color: '#86909c' }}>Loading configs...</div>
          ) : configs.length === 0 ? (
            <div style={{ fontSize: 13, color: '#86909c' }}>No configs saved yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {configs.map((cfg) => (
                <div
                  key={cfg.recordId}
                  style={{
                    padding: 10,
                    border: '1px solid #e5e6eb',
                    borderRadius: 6,
                    background: '#fff',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div style={{ fontSize: 13, overflow: 'hidden' }}>
                    <div style={{ fontWeight: 600 }}>{cfg.name}</div>
                    <div style={{ color: '#86909c', fontSize: 12, marginTop: 2 }}>
                      Mode: {cfg.mode} | SQL: {cfg.sql.slice(0, 40)}{cfg.sql.length > 40 ? '...' : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <Button theme='light' size='small' onClick={() => applyConfig(cfg)}>
                      Load
                    </Button>
                    <Button theme='light' size='small' onClick={() => startEditConfig(cfg)}>
                      Edit
                    </Button>
                    <Button theme='light' type='danger' size='small' onClick={() => deleteConfig(cfg.recordId)}>
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <DuckDBConsole ref={duckdbRef} />
    </main>
  );
}
