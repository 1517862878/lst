import re, sys, io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

BS = chr(92)  # backslash, avoids shell escaping issues

def cells(line):
    s = line.strip()
    if s.startswith("|"):
        s = s[1:]
    if s.endswith("|") and not s.endswith(BS + "|"):
        s = s[:-1]
    parts = []
    cur = []
    for ch in s:
        if ch == "|" and (not cur or cur[-1] != BS):
            parts.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
    parts.append("".join(cur))
    return parts

path = "FRONTEND-WORK.md"
lines = open(path, encoding="utf-8").read().split("\n")

sep_re = re.compile(r"^\|[\s:\-|]+\|$")
issues = []
i = 0
tables = 0
while i < len(lines):
    if lines[i].startswith("|") and i + 1 < len(lines) and sep_re.match(lines[i + 1]):
        tables += 1
        n = len(cells(lines[i]))
        sn = len(cells(lines[i + 1]))
        if n != sn:
            issues.append((i + 2, "SEP", n, sn, lines[i]))
        j = i + 2
        while j < len(lines) and lines[j].startswith("|"):
            m = len(cells(lines[j]))
            if m != n:
                issues.append((j + 1, "ROW", n, m, lines[j]))
            j += 1
        i = j
    else:
        i += 1

print("tables:", tables)
print("issues:", len(issues))
for ln, kind, exp, got, src in issues:
    print("-" * 60)
    print("line %d %s expected=%d got=%d" % (ln, kind, exp, got))
    print(src)
