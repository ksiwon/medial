import json, subprocess, sys
pdf = sys.argv[1]; heads = json.load(open(sys.argv[2], encoding='utf-8', errors='replace'))
n = int([l for l in subprocess.run(['pdfinfo', pdf], capture_output=True, text=True, encoding='utf-8', errors='replace').stdout.splitlines() if l.startswith('Pages')][0].split()[1])
txt = {p: subprocess.run(['pdftotext', '-enc', 'UTF-8', '-layout', '-f', str(p), '-l', str(p), pdf, '-'], capture_output=True, text=True, encoding='utf-8', errors='replace').stdout for p in range(int(sys.argv[4]) + 1 if len(sys.argv) > 4 else 5, n + 1)}
OFF = int(sys.argv[4]) if len(sys.argv) > 4 else 4
out = {}; cur = OFF + 1
for h in heads:
    for p in range(cur, n + 1):
        if any(l.strip().startswith(h) or l.strip().startswith('□ ' + h) for l in txt[p].splitlines()):
            out[h] = p - OFF; cur = p; break
    else:
        print('NOT FOUND', h)
json.dump(out, open(sys.argv[3], 'w', encoding='utf-8', errors='replace'), ensure_ascii=False)
print(out)
