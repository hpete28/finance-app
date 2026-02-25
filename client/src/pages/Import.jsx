// src/pages/Import.jsx
import React, { useState, useCallback, useEffect } from 'react';
import { Upload, CheckCircle, AlertCircle, FileText, Zap, FileSearch } from 'lucide-react';
import { uploadApi, rulesApi, importHistoryApi, transactionsApi } from '../utils/api';
import { Card, SectionHeader, Spinner } from '../components/ui';
import useAppStore from '../stores/appStore';

const KNOWN_ACCOUNTS = [
  'BMO CAD Credit Card',
  'BMO US Credit Card',
  'TD CAD Credit Card',
  'TD CAD Checking',
];

const EXACT_FILES = [
  'BMO_CAD_CC_MASTER_TRANSACTIONS.csv',
  'BMO_US_CC_MASTER_TRANSACTIONS.csv',
  'TD_CAD_CC_MASTER_TRANSACTIONS.csv',
  'TD_CAD_Checking_MASTER_TRANSACTIONS.csv',
];

function guessAccount(filename) {
  const f = filename.toUpperCase();
  if (EXACT_FILES.includes(filename)) return { account: 'exact match', exact: true };
  if (f.includes('BMO') && (f.includes('US') || f.includes('USD'))) return { account: 'BMO US Credit Card', exact: false };
  if (f.includes('BMO')) return { account: 'BMO CAD Credit Card', exact: false };
  if (f.includes('TD') && (f.includes('CHK') || f.includes('CHECK') || f.includes('ALL') || f.includes('SAV'))) return { account: 'TD CAD Checking', exact: false };
  if (f.includes('TD')) return { account: 'TD CAD Credit Card', exact: false };
  return { account: null, exact: false };
}

function DropZone({ onFiles, label, accept = '.csv', multi = true }) {
  const [dragging, setDragging] = useState(false);
  const onDrop = useCallback((e) => {
    e.preventDefault(); setDragging(false);
    onFiles([...e.dataTransfer.files]);
  }, [onFiles]);
  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`relative border-2 border-dashed rounded-xl p-10 text-center transition-all cursor-pointer ${
        dragging ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-700 hover:border-slate-600'
      }`}
    >
      <input type="file" accept={accept} multiple={multi} onChange={e => { onFiles([...e.target.files]); e.target.value = ''; }}
        className="absolute inset-0 opacity-0 cursor-pointer" />
      <Upload size={28} className={`mx-auto mb-3 ${dragging ? 'text-indigo-400' : 'text-slate-500'}`} />
      <p className="text-sm text-slate-400">{label}</p>
      <p className="text-xs text-slate-600 mt-1">Click to browse or drag & drop</p>
    </div>
  );
}


// ══════════════════════════════════════════════════════════════
//  CSV IMPORT TAB
// ══════════════════════════════════════════════════════════════
function CsvImportTab({ onImported }) {
  const { showToast } = useAppStore();
  const [csvFiles, setCsvFiles]   = useState([]);
  const [rulesFile, setRulesFile] = useState(null);
  const [loading, setLoading]     = useState(false);
  const [results, setResults]     = useState(null);
  const [transferCandidateCount, setTransferCandidateCount] = useState(null);
  const [step, setStep]           = useState(1);

  const recognizedFiles = csvFiles.filter(f => EXACT_FILES.includes(f.name));
  const unknownFiles    = csvFiles.filter(f => !EXACT_FILES.includes(f.name));

  const handleCsvFiles = (files) => {
    setCsvFiles(files.filter(f => f.name.endsWith('.csv') || f.name.endsWith('.CSV')));
  };

  const handleUpload = async () => {
    setLoading(true);
    setStep(2);
    try {
      if (rulesFile) await rulesApi.upload(rulesFile);
      const res = await uploadApi.transactions(csvFiles);
      setResults(res.data);
      try {
        const c = await transactionsApi.transferCandidates({ limit: 120, days_window: 3, min_confidence: 0.55 });
        setTransferCandidateCount(c.data?.count || c.data?.candidates?.length || 0);
      } catch {
        setTransferCandidateCount(null);
      }
      setStep(3);
      onImported?.();
    } catch (err) {
      showToast(err.response?.data?.error || 'Import failed', 'error');
      setStep(1);
    } finally {
      setLoading(false);
    }
  };

  const steps = [
    { n: 1, label: 'Upload Files' },
    { n: 2, label: 'Review' },
    { n: 3, label: 'Complete' },
  ];

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-3">
        {steps.map((s, i) => (
          <React.Fragment key={s.n}>
            <div className={`flex items-center gap-2 text-sm font-medium ${step >= s.n ? 'text-indigo-300' : 'text-slate-600'}`}>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${step > s.n ? 'bg-emerald-500 text-white' : step === s.n ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-500'}`}>
                {step > s.n ? '✓' : s.n}
              </div>
              {s.label}
            </div>
            {i < steps.length - 1 && <div className={`flex-1 h-px ${step > s.n ? 'bg-indigo-500' : 'bg-slate-700'}`} />}
          </React.Fragment>
        ))}
      </div>

      {step < 3 && (
        <>
          <Card className="p-5">
            <SectionHeader title="CSV Transaction Files"
              subtitle="Upload one or more of your bank CSV exports or converted PDF exports" />
            <DropZone onFiles={handleCsvFiles} label="Drop CSV transaction files here" />
            {csvFiles.length > 0 && (
              <div className="mt-4 space-y-2">
                <p className="section-title">Selected files</p>
                {csvFiles.map(f => {
                  const guess = guessAccount(f.name);
                  return (
                    <div key={f.name} className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
                      style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${guess.account ? (guess.exact ? 'rgba(16,185,129,0.25)' : 'rgba(245,158,11,0.25)') : 'rgba(239,68,68,0.25)'}` }}>
                      <FileText size={14} className={guess.account ? (guess.exact ? 'text-emerald-400' : 'text-amber-400') : 'text-red-400'} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-300 truncate">{f.name}</p>
                        {guess.account
                          ? <p className="text-xs mt-0.5" style={{ color: guess.exact ? '#10b981' : '#f59e0b' }}>
                              {guess.exact ? '✓ Exact match' : `≈ Maps to: ${guess.account} (fuzzy)`}
                            </p>
                          : <p className="text-xs text-red-400 mt-0.5">✗ Cannot identify account</p>
                        }
                      </div>
                      <span className="text-xs text-slate-600">{(f.size / 1024).toFixed(0)} KB</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <Card className="p-5">
            <SectionHeader title="Categorization Rules (optional)"
              subtitle="Upload your Transaction_Categorization_Rules.json to seed auto-categorization" />
            <DropZone onFiles={files => setRulesFile(files[0])} label="Drop JSON rules file here" accept=".json" multi={false} />
            {rulesFile && (
              <div className="mt-3 flex items-center gap-2 text-sm text-emerald-400">
                <CheckCircle size={14} /> {rulesFile.name} ready
              </div>
            )}
          </Card>

          <div className="flex items-center gap-3">
            <button className="btn-primary" onClick={handleUpload} disabled={!csvFiles.length || loading}>
              {loading ? <><Spinner size={14} /> Importing...</> : <><Zap size={14} className="inline mr-1.5" />Import & Categorize</>}
            </button>
            {!csvFiles.length && <p className="text-xs text-slate-600">Select at least one CSV to continue</p>}
          </div>
        </>
      )}

      {results && step === 3 && (
        <Card className="p-6 animate-slide-up">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center">
              <CheckCircle size={20} className="text-emerald-400" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-200">Import Complete</h3>
              <p className="text-sm text-slate-500">{results.total_imported} transactions imported</p>
            </div>
          </div>
          <div className="space-y-3">
            {results.results?.map((r, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-3 rounded-lg"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)' }}>
                <div>
                  <p className="text-sm text-slate-200">{r.account}</p>
                  {r.originalFilename && <p className="text-xs text-slate-600">{r.originalFilename}</p>}
                  <p className="text-xs text-slate-500">{r.total} rows processed</p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-emerald-400 font-semibold">{r.imported} imported</p>
                  {r.skipped > 0 && <p className="text-xs text-slate-600">{r.skipped} rows skipped (missing required fields)</p>}
                </div>
              </div>
            ))}
            {results.errors?.map((e, i) => (
              <div key={i} className="flex items-center gap-2 text-sm text-red-400">
                <AlertCircle size={14} /> {e.file}: {e.error}
              </div>
            ))}
          </div>
          <div className="mt-5 flex gap-3">
            <a href="/transactions" className="btn-primary text-sm">View Transactions →</a>
            <button className="btn-secondary text-sm" onClick={() => { setStep(1); setCsvFiles([]); setResults(null); setTransferCandidateCount(null); }}>Import More</button>
          </div>
          {transferCandidateCount > 0 && (
            <div className="mt-3 px-3 py-2 rounded-lg text-xs"
              style={{ background: 'rgba(6,182,212,0.1)', border: '1px solid rgba(6,182,212,0.25)', color: '#67e8f9' }}>
              {transferCandidateCount} transfer candidates detected. Review and confirm them in Transactions.
            </div>
          )}
        </Card>
      )}
    </div>
  );
}


// ══════════════════════════════════════════════════════════════
//  PDF IMPORT TAB
// ══════════════════════════════════════════════════════════════
function PdfImportTab({ onImported }) {
  const { showToast } = useAppStore();
  const [pdfFiles, setPdfFiles]     = useState([]);
  const [hints, setHints]           = useState({});     // filename → account override
  const [previews, setPreviews]     = useState(null);   // parse preview results
  const [loading, setLoading]       = useState(false);
  const [importing, setImporting]   = useState(false);
  const [results, setResults]       = useState(null);
  const [transferCandidateCount, setTransferCandidateCount] = useState(null);
  const [pythonOk, setPythonOk]     = useState(null);   // null=checking, true/false

  // Check Python availability
  useEffect(() => {
    fetch('/api/pdf-import/check-python')
      .then(r => r.json())
      .then(d => setPythonOk(d.ok))
      .catch(() => setPythonOk(false));
  }, []);

  const handlePreview = async () => {
    if (!pdfFiles.length) return;
    setLoading(true);
    setPreviews(null);
    try {
      const form = new FormData();
      pdfFiles.forEach(f => {
        form.append('files', f);
        if (hints[f.name]) form.append(`hint_${f.name}`, hints[f.name]);
      });
      const res = await fetch('/api/pdf-import/parse', { method: 'POST', body: form });
      const data = await res.json();
      setPreviews(data.results);
    } catch (err) {
      showToast('Preview failed: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    if (!pdfFiles.length) return;
    setImporting(true);
    try {
      const form = new FormData();
      pdfFiles.forEach(f => {
        form.append('files', f);
        if (hints[f.name]) form.append(`hint_${f.name}`, hints[f.name]);
      });
      const res = await fetch('/api/pdf-import/import', { method: 'POST', body: form });
      const data = await res.json();
      setResults(data);
      try {
        const c = await transactionsApi.transferCandidates({ limit: 120, days_window: 3, min_confidence: 0.55 });
        setTransferCandidateCount(c.data?.count || c.data?.candidates?.length || 0);
      } catch {
        setTransferCandidateCount(null);
      }
      onImported?.();
    } catch (err) {
      showToast('Import failed: ' + err.message, 'error');
    } finally {
      setImporting(false);
    }
  };

  if (pythonOk === false) {
    return (
      <Card className="p-6">
        <div className="flex items-start gap-4">
          <AlertCircle size={24} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <h3 className="font-semibold text-slate-200 mb-1">Python not detected</h3>
            <p className="text-sm text-slate-400 leading-relaxed mb-3">
              PDF parsing requires Python 3 with <span className="font-mono text-indigo-300">pdfplumber</span> installed.
              The app will install it automatically once Python is available.
            </p>
            <div className="font-mono text-xs bg-black/40 rounded-lg p-3 text-slate-300 space-y-1">
              <p># Install Python 3 from python.org, then:</p>
              <p className="text-emerald-400">pip install pdfplumber</p>
              <p className="text-slate-600"># Then refresh this page</p>
            </div>
          </div>
        </div>
      </Card>
    );
  }

  if (results) {
    return (
      <Card className="p-6 animate-slide-up">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center">
            <CheckCircle size={20} className="text-emerald-400" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-200">PDF Import Complete</h3>
            <p className="text-sm text-slate-500">{results.total_imported} transactions imported</p>
          </div>
        </div>
        <div className="space-y-3">
          {results.results?.map((r, i) => (
            <div key={i} className="flex items-center justify-between px-4 py-3 rounded-lg"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)' }}>
              <div>
                <p className="text-sm text-slate-200">{r.account}</p>
                <p className="text-xs text-slate-600">{r.file}</p>
                <p className="text-xs text-slate-500">{r.total} rows parsed</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-emerald-400 font-semibold">{r.imported} imported</p>
                {r.skipped > 0 && <p className="text-xs text-slate-600">{r.skipped} rows skipped (missing required fields)</p>}
              </div>
            </div>
          ))}
          {results.errors?.map((e, i) => (
            <div key={i} className="px-4 py-3 rounded-lg" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <p className="text-sm text-red-400 font-medium">{e.file}</p>
              <p className="text-xs text-red-300/70 mt-0.5">{e.error}</p>
            </div>
          ))}
        </div>
        <div className="mt-5 flex gap-3">
          <a href="/transactions" className="btn-primary text-sm">View Transactions →</a>
          <button className="btn-secondary text-sm" onClick={() => { setPdfFiles([]); setResults(null); setPreviews(null); setTransferCandidateCount(null); }}>Import More</button>
        </div>
        {transferCandidateCount > 0 && (
          <div className="mt-3 px-3 py-2 rounded-lg text-xs"
            style={{ background: 'rgba(6,182,212,0.1)', border: '1px solid rgba(6,182,212,0.25)', color: '#67e8f9' }}>
            {transferCandidateCount} transfer candidates detected. Review and confirm them in Transactions.
          </div>
        )}
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Info box */}
      <div className="px-4 py-3 rounded-xl text-sm" style={{ background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.2)' }}>
        <p className="text-indigo-300 font-semibold text-xs uppercase tracking-wide mb-1">How PDF import works</p>
        <p className="text-slate-400 text-xs leading-relaxed">
          Drop one or more bank statement PDFs. The parser automatically identifies whether each is BMO or TD, credit card or checking,
          extracts all transactions, and imports directly into your account — no intermediate CSV needed.
          Each month's new statement can be imported at any time; transactions are always imported as-is, with no duplicate deletion.
        </p>
      </div>

      {/* Drop zone */}
      <Card className="p-5">
        <SectionHeader title="Bank Statement PDFs" subtitle="Drop one or multiple PDFs — mixed banks supported" />
        <DropZone onFiles={files => { setPdfFiles(files.filter(f => f.name.toLowerCase().endsWith('.pdf'))); setPreviews(null); setResults(null); }}
          label="Drop PDF bank statements here" accept=".pdf" />

        {pdfFiles.length > 0 && (
          <div className="mt-4 space-y-3">
            <p className="section-title">Selected files ({pdfFiles.length})</p>
            {pdfFiles.map(f => {
              const g = guessAccount(f.name);
              return (
                <div key={f.name} className="rounded-lg overflow-hidden"
                  style={{ border: '1px solid var(--border)' }}>
                  <div className="flex items-center gap-3 px-3 py-2.5"
                    style={{ background: 'rgba(255,255,255,0.03)' }}>
                    <FileSearch size={14} className="text-indigo-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-300 truncate">{f.name}</p>
                      {g.account && !hints[f.name]
                        ? <p className="text-xs text-amber-400 mt-0.5">≈ Auto-detected: {g.account}</p>
                        : !g.account && !hints[f.name]
                        ? <p className="text-xs text-slate-500 mt-0.5">Select account below ↓</p>
                        : null
                      }
                    </div>
                    <span className="text-xs text-slate-600">{(f.size/1024).toFixed(0)} KB</span>
                  </div>
                  {/* Account override selector */}
                  <div className="px-3 py-2 flex items-center gap-2" style={{ background: 'rgba(0,0,0,0.2)' }}>
                    <span className="text-xs text-slate-600 shrink-0">Account:</span>
                    <select className="select text-xs flex-1"
                      value={hints[f.name] || ''}
                      onChange={e => setHints(h => ({ ...h, [f.name]: e.target.value }))}>
                      <option value="">Auto-detect from filename</option>
                      {KNOWN_ACCOUNTS.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Preview results */}
      {previews && (
        <Card className="p-5">
          <SectionHeader title="Parse Preview" subtitle="Review what was found before importing" />
          <div className="space-y-3 mt-3">
            {previews.map((r, i) => (
              <div key={i} className="rounded-lg overflow-hidden"
                style={{ border: r.error ? '1px solid rgba(239,68,68,0.3)' : '1px solid rgba(16,185,129,0.2)' }}>
                <div className="flex items-center justify-between px-4 py-3"
                  style={{ background: r.error ? 'rgba(239,68,68,0.07)' : 'rgba(16,185,129,0.07)' }}>
                  <div>
                    <p className="text-sm font-medium text-slate-200">{r.filename}</p>
                    {r.account && <p className="text-xs text-emerald-400 mt-0.5">→ {r.account}</p>}
                  </div>
                  {r.error
                    ? <span className="text-xs text-red-400">{r.error}</span>
                    : <span className="text-emerald-400 font-mono text-sm font-semibold">{r.total_count} transactions</span>
                  }
                </div>
                {r.transactions?.length > 0 && (
                  <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                    {r.transactions.map((t, j) => (
                      <div key={j} className="flex items-center justify-between px-4 py-2 text-xs">
                        <span className="font-mono text-slate-500 w-24 shrink-0">{t.Date}</span>
                        <span className="text-slate-300 flex-1 mx-3 truncate">{t.Description}</span>
                        <span className={`font-mono font-semibold ${t.Amount >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {t.Amount >= 0 ? '+' : ''}{t.Amount?.toFixed(2)}
                        </span>
                      </div>
                    ))}
                    {r.total_count > 5 && (
                      <p className="text-center text-xs text-slate-600 py-2">… and {r.total_count - 5} more</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Action buttons */}
      {pdfFiles.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <button className="btn-secondary flex items-center gap-2" onClick={handlePreview} disabled={loading}>
            {loading ? <><Spinner size={14} /> Parsing...</> : <><FileSearch size={14} /> Preview</>}
          </button>
          <button className="btn-primary flex items-center gap-2" onClick={handleImport} disabled={importing || loading}>
            {importing ? <><Spinner size={14} /> Importing...</> : <><Zap size={14} /> Import to Ledger</>}
          </button>
          <p className="text-xs text-slate-600">Preview first to verify account detection, then Import</p>
        </div>
      )}
    </div>
  );
}



function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString();
}

function ImportHistoryPanel({ refreshKey }) {
  const [history, setHistory] = useState(null);
  const [loadingHistory, setLoadingHistory] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoadingHistory(true);
    importHistoryApi.list(20)
      .then((res) => {
        if (!cancelled) setHistory(res.data);
      })
      .catch(() => {
        if (!cancelled) setHistory({ latestByAccount: [], recent: [] });
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false);
      });

    return () => { cancelled = true; };
  }, [refreshKey]);

  return (
    <Card className="p-5">
      <SectionHeader title="Latest Imported Statements" subtitle="See what was imported most recently for each account" />
      {loadingHistory && <p className="text-sm text-slate-500">Loading import history…</p>}
      {!loadingHistory && (
        <div className="space-y-5">
          <div className="space-y-2">
            {history?.latestByAccount?.length
              ? history.latestByAccount.map((row, idx) => (
                <div key={`${row.accountName}-${idx}`} className="flex items-center justify-between px-3 py-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)' }}>
                  <div>
                    <p className="text-sm text-slate-200">{row.accountName}</p>
                    <p className="text-xs text-slate-500">{row.fileName} • {row.source.toUpperCase()}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-slate-400">Range: {formatDate(row.fromDate)} → {formatDate(row.toDate)}</p>
                    <p className="text-xs text-slate-500">Imported {row.importedCount}/{row.totalCount} • {formatDate(row.createdAt)}</p>
                  </div>
                </div>
              ))
              : <p className="text-sm text-slate-500">No statement imports yet.</p>}
          </div>

          {!!history?.recent?.length && (
            <div>
              <p className="section-title mb-2">Recent import activity</p>
              <div className="space-y-1.5">
                {history.recent.slice(0, 8).map((row) => (
                  <p key={row.id} className="text-xs text-slate-500">
                    {formatDate(row.createdAt)} • {row.accountName} • {row.fileName} • {row.importedCount}/{row.totalCount}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ══════════════════════════════════════════════════════════════
//  MAIN
// ══════════════════════════════════════════════════════════════
export default function Import() {
  const [tab, setTab] = useState('pdf');
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl">
      <div>
        <h1 className="font-display text-2xl text-slate-100">Import Data</h1>
        <p className="text-sm text-slate-500 mt-0.5">Import bank statements directly from PDF or CSV</p>
      </div>

      <div className="flex gap-1 p-1 rounded-lg w-fit" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)' }}>
        {[
          { id: 'pdf', label: '📄 PDF Statements' },
          { id: 'csv', label: '📊 CSV Files' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${tab === t.id ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>
            {t.label}
          </button>
        ))}
      </div>

      <ImportHistoryPanel refreshKey={historyRefreshKey} />

      {tab === 'pdf' && <PdfImportTab onImported={() => setHistoryRefreshKey(k => k + 1)} />}
      {tab === 'csv' && <CsvImportTab onImported={() => setHistoryRefreshKey(k => k + 1)} />}
    </div>
  );
}
