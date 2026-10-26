import re, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

text = open("FRONTEND-WORK.md", encoding="utf-8").read()
lines = text.split("\n")

# collect component names defined in section 3 tables (3.1, 3.2, 3.3)
defined = set()
in_s3 = False
for l in lines:
    if l.startswith("## 3. 组件清单表"): in_s3 = True
    if l.startswith("## 4. "): in_s3 = False
    if in_s3 and l.startswith("| `"):
        m = re.match(r"^\|\s*`([A-Za-z0-9_]+)`\s*\|", l)
        if m: defined.add(m.group(1))

# collect backticked identifiers in section 2 (page specs) and section 5
used = {}
in_s2 = False
for i, l in enumerate(lines, 1):
    if l.startswith("## 2. 逐页前端任务拆解"): in_s2 = True
    if l.startswith("## 3. "): in_s2 = False
    if not in_s2: continue
    if l.startswith("### 2."):
        cur = l.strip()
    for m in re.finditer(r"`([A-Z][A-Za-z0-9]*)`", l):
        used.setdefault(m.group(1), set()).add(i)

# known non-component identifiers that appear in backticks
ignore = {
 "URL","ID","EXIF","GPS","ISO","RHF","zod","TanStack","Query","Zustand","React","TypeScript","Vite","Vitest",
 "Playwright","Tailwind","Radix","MiniSearch","DOMPurify","marked","Intl","Segmenter","ISO","UTC","JSON","JSON-LD",
 "OpenGraph","LCP","CLS","INP","MIT","CC","DMCA","AVIF","WebP","HEIC","MIME","UUID","Page","Photo","Comment",
 "Session","Storage","AuthAdapter","PhotoRepository","InteractionRepository","RankingRepository","StorageAdapter",
 "LocalStorage","IndexedDB","BroadcastChannel","localStorage","sessionStorage","navigator","crypto","canvas",
 "beforeunload","pointerdown","keydown","scroll","visibilitychange","prefers-reduced-motion","aria-label",
 "aria-current","aria-describedby","aria-expanded","aria-live","aria-hidden","alt","href","id","src","width",
 "height","role","tabIndex","htmlFor","useState","useEffect","useMemo","useCallback","useRef","ReactNode",
 "LucideIcon","Record","Array","Partial","Promise","string","number","boolean","null","undefined","object",
 "never","unknown","true","false","void","any","readonly","keyof","Record","Err","Result","LastUpdated",
}

missing = {}
for name, locs in used.items():
    if name in defined: continue
    if name in ignore: continue
    if name.startswith("use") and len(name) > 3: continue
    missing[name] = sorted(locs)

print("defined components:", len(defined))
print("referenced-but-not-defined:", len(missing))
for n, l in sorted(missing.items(), key=lambda kv: kv[1][0]):
    print("  %-28s lines %s" % (n, l))
