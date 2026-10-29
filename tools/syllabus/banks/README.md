# Question bank sources

The original questions behind `students/assets/syllabus/*/*.json`. Run from
the repo root, in this order (each step is idempotent):

    python3 -I tools/syllabus/banks/build.py .     # the 17 newer banks (g*.py) and their papers.js entries
    python3 -I tools/syllabus/banks/long_qs.py .   # exam-style long questions
    python3 -I tools/syllabus/banks/a2_qs.py .     # A Level (A2) long questions
    python3 -I tools/syllabus/banks/er_qs.py .     # questions built on the June 2023 examiner reports
    python3 -I tools/syllabus/banks/fill_qs.py .   # at least three questions a topic (fill2.py, fill3.py), answers spread A-D

`build.py` rewrites the g*.py banks from scratch, so always run the later
steps after it. All questions are original; the examiner reports are
paraphrased, never copied. Then run `node tests/syllabus.test.mjs`.
