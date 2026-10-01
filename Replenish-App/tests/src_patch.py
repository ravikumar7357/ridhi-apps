"""Exact-text edits to the page's source in src/ (2026-10-01, step 1 of the module plan).

    from src_patch import Src            # run from Replenish-App/tests, or put that folder on sys.path
    p = Src()
    p.one('old text', 'new text', 'what this is')   # the old text must appear exactly once across ALL of src/
    p.save()                              # writes the changed files (CRLF kept) and runs tests/assemble.js

The file the text is in does not have to be known: code moves between files as groups are split out, and an edit
names the code, not the file. Text that appears in no file, or in more than one place, is refused."""
import os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', 'src')


class Src:
    def __init__(self):
        self.files = {}
        for d, _, names in os.walk(SRC):
            for n in names:
                if n.endswith(('.js', '.css', '.html')):
                    p = os.path.join(d, n)
                    self.files[p] = open(p, 'rb').read().decode('utf8').replace('\r\n', '\n')
        self.changed = set()

    def one(self, old, new, name=''):
        hits = [(p, t.count(old)) for p, t in self.files.items() if old in t]
        total = sum(n for _, n in hits)
        if total != 1:
            raise AssertionError(f'{name}: found {total} times' + (' in ' + ', '.join(os.path.basename(p) for p, _ in hits) if hits else ''))
        p = hits[0][0]
        self.files[p] = self.files[p].replace(old, new)
        self.changed.add(p)
        print('ok', name, '->', os.path.relpath(p, SRC))

    def save(self):
        for p in self.changed:
            open(p, 'wb').write(self.files[p].replace('\n', '\r\n').encode('utf8'))
        r = subprocess.run(['node', os.path.join(HERE, 'assemble.js')], capture_output=True, text=True)
        print(r.stdout.strip() or r.stderr.strip())
        if r.returncode:
            sys.exit(r.returncode)
