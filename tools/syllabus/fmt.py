"""Write a syllabus bank (students/assets/syllabus/**.json) in the house
layout: one line per topic header and one per question, so diffs stay
readable.  python3 -I tools/syllabus/fmt.py <file.json> [...]"""
import json
import sys

ONE = lambda v: json.dumps(v, ensure_ascii=False, separators=(", ", ": "))


def dump(d):
    head = [f'  {json.dumps(k)}: {ONE(v)}' for k, v in d.items() if k != "topics"]
    out = ["{", ",\n".join(head) + ",", '  "topics": [']
    topics = []
    for t in d["topics"]:
        meta = ", ".join(f"{json.dumps(k)}: {ONE(v)}" for k, v in t.items() if k not in ("questions", "long"))
        parts = [f"    {{\n      {meta}"]
        for key in ("questions", "long"):
            if key in t:
                rows = ",\n".join(f"        {{ {ONE(q)[1:-1]} }}" for q in t[key])
                parts.append(f'      "{key}": [\n{rows}\n      ]')
        topics.append(",\n".join(parts) + "\n    }")
    out.append(",\n".join(topics))
    out += ["  ]", "}", ""]
    return "\n".join(out)


if __name__ == "__main__":
    for path in sys.argv[1:]:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
        with open(path, "w", encoding="utf-8") as f:
            f.write(dump(d))
