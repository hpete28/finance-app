"""
pdf_parser.py  —  Headless bank statement PDF parser for Ledger
Called by Node.js:  python pdf_parser.py <pdf_path> [account_hint]
Outputs JSON to stdout:
  { "account": "BMO CAD Credit Card", "transactions": [...], "error": null }
"""

import re, sys, json, traceback
from pathlib import Path
from datetime import datetime

try:
    import pdfplumber
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "pdfplumber", "--quiet"])
    import pdfplumber


# ── Account detection from filename ──────────────────────────────────────────
ACCOUNT_PATTERNS = [
    ("BMO CAD Credit Card", lambda fn: (
        bool(re.search(r'MC1785|BMO.*CAD|CAD.*BMO', fn, re.I)) and
        bool(re.search(r'[a-zA-Z]+\s+\d{1,2},\s+\d{4}', fn))
    )),
    ("BMO US Credit Card", lambda fn: (
        bool(re.search(r'USD|US.*MC|BMO.*USD', fn, re.I)) and
        bool(re.search(r'[a-zA-Z]+\s+\d{1,2},\s+\d{4}', fn))
    )),
    ("TD CAD Credit Card", lambda fn: (
        bool(re.search(r'TD.*(CC|Visa|Credit)', fn, re.I)) and
        bool(re.search(r'[_-]\d{4}\.pdf$', fn, re.I))
    )),
    ("TD CAD Checking", lambda fn: (
        bool(re.search(r'TD.*(Chk|Check|All.Inclusive|Saving)', fn, re.I)) and
        bool(re.search(r'_\d{4}\.pdf$', fn, re.I))
    )),
]

KEYWORD_MAP = {
    "bmo cad": "BMO CAD Credit Card",
    "bmo usd": "BMO US Credit Card",
    "bmo us":  "BMO US Credit Card",
    "td cc":   "TD CAD Credit Card",
    "td credit": "TD CAD Credit Card",
    "td checking": "TD CAD Checking",
    "td chk":  "TD CAD Checking",
}

def detect_account(filepath, hint=None):
    fn = Path(filepath).name
    fn_upper = fn.upper()

    # Explicit hint from user
    if hint:
        h = hint.lower()
        for k, v in KEYWORD_MAP.items():
            if k in h: return v
        # Try substring match against known account names
        for _, name in ACCOUNT_PATTERNS:
            if hint.lower() in name.lower(): return name

    # Filename-based detection
    for name, detector in ACCOUNT_PATTERNS:
        try:
            if detector(fn): return name
        except Exception:
            pass

    # Fuzzy keyword fallback on filename
    if re.search(r'BMO', fn_upper):
        if re.search(r'US|USD', fn_upper): return "BMO US Credit Card"
        return "BMO CAD Credit Card"
    if re.search(r'\bTD\b', fn_upper):
        if re.search(r'CHK|CHECK|SAVING|ALL.INCLUSIVE', fn_upper): return "TD CAD Checking"
        return "TD CAD Credit Card"

    return None  # unknown — caller will show account-picker


# ══════════════════════════════════════════════════════════════
#  BMO PARSER
# ══════════════════════════════════════════════════════════════
_BMO_DATE  = re.compile(r"([a-zA-Z]+)\s+\d{1,2},\s+(\d{4})", re.I)
_BMO_TRANS = re.compile(
    r'^([A-Z][a-z]{2}\.??\s?\d{1,2})\s+([A-Z][a-z]{2}\.??\s?\d{1,2})\s+(.*?)\s+(-?[\d,]+\.\d{2}(?:\s?CR)?)\b',
    re.I)

def _bmo_fmt(p):
    try:
        with pdfplumber.open(p) as pdf:
            t = (pdf.pages[0].extract_text() or "").upper().replace(" ", "")
        return "legacy" if "REFERENCENO" in t else "modern"
    except Exception:
        return "modern"

def _bmo_my(p):
    m = _BMO_DATE.search(Path(p).name)
    if not m:
        n = datetime.now(); return n.month, n.year
    try: mi = datetime.strptime(m.group(1)[:3], "%b").month
    except Exception: mi = 1
    return mi, int(m.group(2))

def _bmo_date(tok, sm, sy):
    c = re.sub(r'\.', '', tok.strip())
    m = re.match(r'^([A-Za-z]{3})\s*(\d{1,2})$', c)
    if not m: return tok
    try:
        dt = datetime.strptime(f"{m.group(1)} {m.group(2).zfill(2)}", "%b %d")
        yr = sy
        if dt.month == 12 and sm == 1: yr -= 1
        elif dt.month == 1 and sm == 12: yr += 1
        return f"{yr}-{dt.month:02d}-{dt.day:02d}"
    except Exception:
        return tok

def _bmo_amt(s):
    s = s.replace(",", "").replace("$", "").strip()
    cr = "CR" in s.upper()
    n = float(s.upper().replace("CR", "").strip())
    return n if cr else -n

def _bmo_isref(t):
    t = t.strip()
    return bool(re.fullmatch(r'\d{8,}', t)) or bool(re.fullmatch(r'\d{2,}-[\d-]{4,}', t))

def _bmo_human(d):
    d = re.sub(r'([a-z])([A-Z])', r'\1 \2', d)
    d = re.sub(r'([A-Za-z])(\d)', r'\1 \2', d)
    d = re.sub(r'(\d)([A-Za-z])', r'\1 \2', d)
    return re.sub(r'\s+', ' ', d).strip()

def parse_bmo(p):
    sm, sy = _bmo_my(p)
    fmt = _bmo_fmt(p)
    rows = []
    with pdfplumber.open(p) as pdf:
        for page in pdf.pages:
            for line in (page.extract_text() or "").splitlines():
                m = _BMO_TRANS.match(line.strip())
                if not m: continue
                desc = m.group(3).strip()
                if fmt == "legacy":
                    parts = desc.split()
                    if parts and _bmo_isref(parts[-1]):
                        desc = " ".join(parts[:-1]).strip()
                    desc = _bmo_human(desc)
                rows.append({
                    "Date": _bmo_date(m.group(1), sm, sy),
                    "Description": desc,
                    "Amount": _bmo_amt(m.group(4))
                })
    return rows


# ══════════════════════════════════════════════════════════════
#  TD PARSER
# ══════════════════════════════════════════════════════════════
def _td_up(page, xt=2):
    return [w for w in page.extract_words(x_tolerance=xt, y_tolerance=2) if w.get('upright', True)]

def _td_lines(words, yt=4):
    words = sorted(words, key=lambda w: (w['top'], w['x0']))
    lines, cur, ct = [], [], None
    for w in words:
        if ct is None: ct = w['top']
        if abs(w['top'] - ct) <= yt: cur.append(w)
        else:
            if cur: lines.append(cur)
            cur, ct = [w], w['top']
    if cur: lines.append(cur)
    return lines

def _td_my(fn):
    for pat in [r'[-_]([a-zA-Z]{3})_\d{1,2}[_-](\d{4})\.pdf$',
                r'_([a-zA-Z]{3})_\d{1,2}-(\d{4})\.pdf$']:
        m = re.search(pat, fn, re.I)
        if m:
            try: return datetime.strptime(m.group(1)[:3], "%b").month, int(m.group(2))
            except Exception: pass
    n = datetime.now(); return n.month, n.year

def _td_date(raw, sm, sy):
    try:
        dt = datetime.strptime(raw, "%b%d"); yr = sy
        if dt.month == 12 and sm == 1: yr -= 1
        elif dt.month == 1 and sm == 12: yr += 1
        return f"{yr}-{dt.month:02d}-{dt.day:02d}"
    except Exception:
        return raw

def _td_amt(s):
    m = re.search(r'([\d,]+\.\d{2})', s)
    return float(m.group(1).replace(",", "")) if m else 0.0

def _td_type(p):
    with pdfplumber.open(p) as pdf:
        texts = {w['text'].upper() for w in _td_up(pdf.pages[0])}
    return 'credit_card' if (any('TRANSACTION' in t for t in texts) and
                              any('POSTING' in t for t in texts)) else 'checking'

def parse_td_chk(p, sm, sy):
    rows = []
    with pdfplumber.open(p) as pdf:
        for page in pdf.pages:
            words = _td_up(page)
            if not words: continue
            hy = next((w['top'] for w in words if w['text'].lower().startswith('withdrawal')), None)
            if hy is None: continue
            HT, GAP = 5, 5; cols = {}
            for w in words:
                if abs(w['top'] - hy) <= HT:
                    t = w['text'].lower().strip().rstrip(':')
                    if   t.startswith('desc'): cols['desc'] = w['x0']
                    elif t.startswith('with'): cols['with'] = w['x0']
                    elif t.startswith('dep'):  cols['dep']  = w['x0']
                    elif t.startswith('date'): cols['date'] = w['x0']
                    elif t.startswith('bal'):  cols['bal']  = w['x0']
            if 'with' not in cols or 'dep' not in cols: continue
            xde  = cols['with'] - GAP
            xwe  = cols['dep']  - GAP
            xdpe = cols.get('date', cols['dep'] + 80) - GAP
            xdte = cols.get('bal', xdpe + 65) - GAP
            SKIP = ["BALANCE FORWARD", "OPENING BALANCE", "CLOSING BALANCE", "TOTAL", "DAILY CLOSING"]
            for line in _td_lines([w for w in words if w['top'] > hy + HT]):
                r = {"desc": [], "with": [], "dep": [], "date": []}
                for w in line:
                    x = w['x0']
                    if   x < xde:  r["desc"].append(w['text'])
                    elif x < xwe:  r["with"].append(w['text'])
                    elif x < xdpe: r["dep"].append(w['text'])
                    elif x < xdte: r["date"].append(w['text'])
                desc = " ".join(r["desc"]).strip()
                if not desc or any(s in desc.upper() for s in SKIP): continue
                ds = "".join(r["date"]).upper()
                dm = re.search(r'(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*(\d{1,2})', ds)
                if not dm: continue
                ws = "".join(r["with"]).strip(); dp = "".join(r["dep"]).strip()
                amt = -_td_amt(ws) if ws else (_td_amt(dp) if dp else None)
                if amt is None or amt == 0.0: continue
                rows.append({
                    "Date": _td_date(f"{dm.group(1)}{dm.group(2).zfill(2)}", sm, sy),
                    "Description": re.sub(r'\s+', ' ', desc).strip(),
                    "Amount": round(amt, 2)
                })
    return rows

def parse_td_cc(p, sm, sy):
    raw = []
    with pdfplumber.open(p) as pdf:
        for page in pdf.pages:
            words = _td_up(page, xt=1)
            if not words: continue
            hy = xa = None
            for w in words:
                if 'AMOUNT' in w['text'].upper() and '$' in w['text']:
                    hy, xa = w['top'], w['x0']; break
            if hy is None: continue
            xds = None
            for w in words:
                if abs(w['top'] - hy) <= 5:
                    if 'ACTIVITY' in w['text'].upper() or 'DESCRIPTION' in w['text'].upper():
                        xds = w['x0']; break
            if xds is None:
                cands = [w for w in words if abs(w['top'] - hy) <= 5 and w['x0'] < xa]
                xds = max((w['x0'] for w in cands), default=140.0)
            xmid = xds / 2; ym = float('inf')
            twy = [(w['text'].upper(), w['top']) for w in words if w['top'] > hy + 5]
            for txt, top in twy:
                if txt == 'CONTINUED': ym = min(ym, top); break
            if ym == float('inf'):
                for txt, top in twy:
                    if txt in ('TOTAL', 'TD'): ym = min(ym, top); break
            tw = [w for w in words if hy + 5 < w['top'] < ym]
            STOP = ["TOTAL NEW", "TD MESSAGE"]
            SKIP = ["PREVIOUS STATEMENT", "STARTING BALANCE", "NET AMOUNT"]
            for line in _td_lines(tw, yt=5):
                row = {"tx_date": [], "desc": [], "amount": []}
                for w in line:
                    x = w['x0']
                    if   x >= xa:  row["amount"].append(w)
                    elif x >= xds: row["desc"].append(w['text'])
                    elif x < xmid: row["tx_date"].append(w['text'])
                desc = " ".join(row["desc"]).strip()
                ds   = "".join(row["tx_date"]).upper()
                aw   = sorted(row["amount"], key=lambda w: w['x0'])
                ar   = aw[0]['text'] if aw else ""
                if any(desc.upper().startswith(k) for k in STOP): break
                if any(desc.upper().startswith(k) for k in SKIP) or not desc: continue
                if desc.upper().strip() == "ACTIVITY": continue
                if re.search(r'\d{4}\s*\d{2}XX', desc): continue
                dm = re.search(r'(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*(\d{1,2})', ds)
                cr = ar.strip().startswith('-'); an = _td_amt(ar)
                if dm and an > 0:
                    raw.append({
                        "DateRaw": f"{dm.group(1)}{dm.group(2).zfill(2)}",
                        "Description": desc,
                        "Amount": an if cr else -an
                    })
                elif desc and raw:
                    raw[-1]["Description"] += " " + desc
    return [{
        "Date": _td_date(t["DateRaw"], sm, sy),
        "Description": re.sub(r'\s+', ' ', t["Description"]).strip(),
        "Amount": round(t["Amount"], 2)
    } for t in raw]

def parse_td(p):
    sm, sy = _td_my(Path(p).name)
    st = _td_type(p)
    return parse_td_cc(p, sm, sy) if st == 'credit_card' else parse_td_chk(p, sm, sy)


# ══════════════════════════════════════════════════════════════
#  MAIN — called by Node.js
# ══════════════════════════════════════════════════════════════
def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: pdf_parser.py <pdf_path> [account_hint]"}))
        sys.exit(1)

    pdf_path = sys.argv[1]
    hint     = sys.argv[2] if len(sys.argv) > 2 else None

    try:
        p = Path(pdf_path)
        if not p.exists():
            print(json.dumps({"error": f"File not found: {pdf_path}"}))
            sys.exit(1)

        account = detect_account(pdf_path, hint)
        fn_upper = p.name.upper()

        # Determine parser from account name or filename
        if account and "BMO" in account:
            transactions = parse_bmo(p)
        elif account and "TD" in account:
            transactions = parse_td(p)
        else:
            # Try BMO first (broader regex), fall back to TD
            try:
                transactions = parse_bmo(p)
                if not transactions:
                    transactions = parse_td(p)
                    if transactions and account is None:
                        account = "TD CAD Checking"
                elif account is None:
                    account = "BMO CAD Credit Card"
            except Exception:
                transactions = parse_td(p)

        print(json.dumps({
            "account":      account,
            "filename":     p.name,
            "transactions": transactions,
            "count":        len(transactions),
            "error":        None
        }))

    except Exception as e:
        print(json.dumps({
            "account":      None,
            "filename":     Path(pdf_path).name,
            "transactions": [],
            "count":        0,
            "error":        str(e),
            "traceback":    traceback.format_exc()
        }))
        sys.exit(1)

if __name__ == "__main__":
    main()
