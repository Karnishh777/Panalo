"""Write the new banks and their papers. python3 -I build.py <repo>"""
import json, sys, importlib.util, os, re
HERE = os.path.dirname(os.path.abspath(__file__))
repo = sys.argv[1]
sys.path.insert(0, os.path.join(repo, "tools/syllabus"))
spec = importlib.util.spec_from_file_location("fmt", os.path.join(repo, "tools/syllabus/fmt.py"))
fmt = importlib.util.module_from_spec(spec); spec.loader.exec_module(fmt)

banks = {}
for g in sorted(f for f in os.listdir(HERE) if f.startswith("g") and f.endswith(".py")):
    s = importlib.util.spec_from_file_location(g[:-3], os.path.join(HERE, g))
    m = importlib.util.module_from_spec(s); s.loader.exec_module(m)
    banks.update(m.BANKS)

js = []
for path, b in banks.items():
    topics = []
    for tid, name, stage, qs in b["topics"]:
        t = {"id": tid, "name": name}
        if stage: t["stage"] = stage
        t["questions"] = [{"q": q, "o": o, "a": a, "why": w} for q, o, a, w in qs]
        topics.append(t)
    by = {t["id"]: t for t in topics}
    for tid, paper, q, scheme, ans in b.get("long", []):
        e = {"q": q, "marks": len(scheme), "paper": paper, "scheme": scheme}
        if ans: e["ans"] = ans
        by[tid].setdefault("long", []).append(e)
    doc = {"subject": b["subject"], "name": b["name"], "board": b["board"], "code": b["code"], "topics": topics}
    out = os.path.join(repo, "students/assets/syllabus", path + ".json")
    open(out, "w", encoding="utf-8").write(fmt.dump(doc))
    # papers.js entry
    lines = []
    for pid, (name, kind, minutes, marks, level, tps) in b["papers"].items():
        tj = json.dumps(tps, ensure_ascii=False).replace('", "', '", "')
        lines.append(f'      {{ id: "{pid}", name: {json.dumps(name, ensure_ascii=False)}, kind: "{kind}", minutes: {json.dumps(minutes)}, marks: {json.dumps(marks)}, level: "{level}", topics: {tj} }},')
    routes = ", ".join(f'{k}: {json.dumps(v)}' for k, v in b["routes"].items())
    note = f'\n    note: {json.dumps(b["note"], ensure_ascii=False)},' if b.get("note") else ""
    js.append(f'  "{b["code"]}": {{\n    // {b["name"]} ({b["board"]})\n    papers: [\n' + "\n".join(lines) + f'\n    ],\n    routes: {{ {routes} }},{note}\n  }},')
    print(path, len(topics), "topics", sum(len(t["questions"]) for t in topics), "q", sum(len(t.get("long", [])) for t in topics), "long")

p = os.path.join(repo, "students/js/model/papers.js")
src = open(p, encoding="utf-8").read()
marker = "\n};\n\nexport const KIND_LABEL"
assert marker in src
# drop entries for these codes if already present (re-runs)
for b in banks.values():
    src = re.sub(r'\n  "%s": \{\n    // .*?\n  \},' % b["code"], "", src, flags=re.S)
src = src.replace(marker, "\n  // ---- Added: the rest of the Cambridge subjects ----\n" + "\n".join(js) + marker, 1) if "// ---- Added: the rest" not in src else src.replace(marker, "\n" + "\n".join(js) + marker, 1)
open(p, "w", encoding="utf-8").write(src)
