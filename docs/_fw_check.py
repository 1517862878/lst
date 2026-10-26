import re, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
BS = chr(92)

def cells(line):
    s = line.strip()
    if s.startswith("|"): s = s[1:]
    if s.endswith("|"): s = s[:-1]
    parts, cur = [], []
    for ch in s:
        if ch == "|" and (not cur or cur[-1] != BS):
            parts.append("".join(cur)); cur = []
        else:
            cur.append(ch)
    parts.append("".join(cur))
    return [p.strip() for p in parts]

lines = open("FRONTEND-WORK.md", encoding="utf-8").read().split("\n")
tot = 0
rows = 0
for i, l in enumerate(lines, 1):
    if re.match(r"^\| W\d+ \|", l):
        rows += 1
        c = cells(l)
        wk, stage, hrs = c[0], c[1], c[5]
        nums = [int(x) for x in re.findall(r"(\d+)h", hrs)]
        s = sum(nums)
        tot += s
        print("line %4d  %-4s %-10s %-16s sum=%2d" % (i, wk, stage, hrs, s))
print("rows:", rows, " TOTAL hours =", tot, "(ROADMAP S0-S8 = 154h)")
