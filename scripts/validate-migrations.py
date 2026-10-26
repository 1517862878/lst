#!/usr/bin/env python3
"""迁移 SQL 静态校验。

用途：在没有本地 Postgres 的环境下，对 supabase/migrations/*.sql 做结构检查，
      尽量在把 SQL 贴进数据库之前发现低级错误。

检查项：
  1. 括号配平（跳过行注释、dollar-quoted 函数体、单引号字符串）
  2. $$ 数量为偶数（防止函数体未闭合）
  3. 每个 create table 都定义了主键
  4. 文件以分号结尾

不检查（需要真实数据库）：
  - 语义正确性、外键可达性、RLS 策略逻辑、触发器行为
  → 这些必须在真实 Postgres / Supabase 上跑一遍

用法：
  python scripts/validate-migrations.py
退出码：0 通过；1 有问题
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MIG_DIR = ROOT / "supabase" / "migrations"


def main() -> int:
    files = sorted(MIG_DIR.glob("*.sql"))
    if not files:
        print("未找到迁移文件：", MIG_DIR)
        return 1

    print(f"共 {len(files)} 个迁移文件\n")

    errors: list[str] = []
    totals = {"tables": 0, "policies": 0, "triggers": 0, "functions": 0, "indexes": 0}

    for f in files:
        sql = f.read_text(encoding="utf-8")
        name = f.name

        # ---- 括号配平 ----
        s = re.sub(r"--[^\n]*", "", sql)                              # 行注释
        s = re.sub(r"\$\$.*?\$\$", "$$", s, flags=re.S)               # dollar quote
        s = re.sub(r"'[^']*'", "''", s)                               # 单引号字符串

        pairs = {")": "(", "]": "["}
        stack: list[str] = []
        bad = False
        for i, ch in enumerate(s):
            if ch in "([":
                stack.append(ch)
            elif ch in ")]":
                if not stack:
                    errors.append(f"{name}: 位置 {i} 出现多余 '{ch}'")
                    bad = True
                    break
                if stack.pop() != pairs[ch]:
                    errors.append(f"{name}: 位置 {i} 括号不匹配")
                    bad = True
                    break
        if not bad and stack:
            errors.append(f"{name}: 有 {len(stack)} 个未闭合括号")

        # ---- dollar-quoted 成对 ----
        n_dollar = len(re.findall(r"\$\$", sql))
        if n_dollar % 2 != 0:
            errors.append(f"{name}: $$ 数量为奇数（{n_dollar}），函数体可能未闭合")

        # ---- 表必须有主键 ----
        tables = re.findall(r"create table if not exists\s+([\w.]+)", sql, re.I)
        for t in tables:
            idx = sql.lower().find(f"create table if not exists {t.lower()}")
            block = sql[idx:]
            end = block.find(");")
            seg = block[: end if end > 0 else len(block)]
            if "primary key" not in seg.lower():
                errors.append(f"{name}: 表 {t} 未定义主键")

        stats = {
            "tables": len(tables),
            "policies": len(re.findall(r"create policy", sql, re.I)),
            "triggers": len(re.findall(r"create trigger", sql, re.I)),
            "functions": len(re.findall(r"create or replace function", sql, re.I)),
            "indexes": len(re.findall(r"create (unique )?index", sql, re.I)),
        }
        for k in totals:
            totals[k] += stats[k]

        print(f"{name}")
        print(
            "   表 {tables} · 索引 {indexes} · 策略 {policies} · 触发器 {triggers} · 函数 {functions}".format(
                **stats
            )
        )

        if sql.strip() and not sql.strip().endswith(";"):
            errors.append(f"{name}: 文件末尾缺少分号")

    print("\n合计：")
    print(
        "   表 {tables} · 索引 {indexes} · 策略 {policies} · 触发器 {triggers} · 函数 {functions}".format(
            **totals
        )
    )

    print()
    if errors:
        print("发现问题：")
        for e in errors:
            print("  x", e)
        return 1

    print("[OK] 结构校验全部通过")
    print("[注意] 语义正确性需在真实 Postgres 上执行验证")
    return 0


if __name__ == "__main__":
    sys.exit(main())
