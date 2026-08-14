"""The restore drill.

"deploy/restore-db.sh has never been run against a real backup" was on the
public-access checklist, and the reason it had never been run is that the only
mode available stopped the live service — a drill costing an outage is a drill
nobody performs. These tests exercise the rehearsal mode end to end against
real SQLite files, including the cases that must FAIL.
"""
import os
import shutil
import sqlite3
import subprocess
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(ROOT, "deploy", "restore-db.sh")


def rehearse(path):
    return subprocess.run(["bash", SCRIPT, "--rehearse", path],
                          capture_output=True, text=True, cwd=ROOT)


def make_backup(path, rows=1):
    c = sqlite3.connect(path)
    c.execute("CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT)")
    c.execute("CREATE TABLE snapshots (id INTEGER PRIMARY KEY)")
    c.execute("CREATE TABLE tradelog (id INTEGER PRIMARY KEY)")
    c.execute("CREATE TABLE cases (id INTEGER PRIMARY KEY)")
    for i in range(rows):
        c.execute("INSERT INTO kv VALUES (?, ?)", (f"k{i}", "v"))
    c.commit()
    c.close()


class RestoreDrillTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir, ignore_errors=True)
        self.good = os.path.join(self.dir, "good.db")
        make_backup(self.good, rows=3)

    def test_a_good_backup_passes(self):
        r = rehearse(self.good)
        self.assertEqual(r.returncode, 0, r.stderr[-400:])
        self.assertIn("REHEARSAL OK", r.stdout)

    def test_it_reports_what_is_actually_in_the_file(self):
        """A row count is the difference between "the file opened" and "the
        data is there" — an empty database passes every structural check."""
        r = rehearse(self.good)
        self.assertIn("kv", r.stdout)
        self.assertIn("3 rows", r.stdout)

    def test_a_corrupt_file_fails(self):
        bad = os.path.join(self.dir, "corrupt.db")
        with open(self.good, "rb") as fh:
            head = fh.read(4000)
        with open(bad, "wb") as fh:
            fh.write(head)
        r = rehearse(bad)
        self.assertEqual(r.returncode, 1)
        self.assertIn("integrity check failed", r.stdout + r.stderr)

    def test_a_valid_but_wrong_database_fails(self):
        """integrity_check only proves the file is well-formed SQLite. Last
        night's backup of something else entirely would sail through it."""
        wrong = os.path.join(self.dir, "wrong.db")
        c = sqlite3.connect(wrong)
        c.execute("CREATE TABLE something_else (x)")
        c.commit()
        c.close()
        r = rehearse(wrong)
        self.assertEqual(r.returncode, 1)
        self.assertIn("no 'kv' table", r.stdout + r.stderr)

    def test_a_gzipped_backup_is_accepted(self):
        """What the backup workflow actually uploads."""
        import gzip
        gz = self.good + ".gz"
        with open(self.good, "rb") as src, gzip.open(gz, "wb") as dst:
            shutil.copyfileobj(src, dst)
        r = rehearse(gz)
        self.assertEqual(r.returncode, 0, r.stderr[-400:])

    def test_the_rehearsal_changes_nothing(self):
        """The reason this mode exists: it must be safe to run any time."""
        before = (os.path.getmtime(self.good), os.path.getsize(self.good))
        rehearse(self.good)
        self.assertEqual(before, (os.path.getmtime(self.good), os.path.getsize(self.good)))

    def test_it_never_touches_the_live_database_in_rehearsal(self):
        src = open(SCRIPT, encoding="utf-8").read()
        body = src[:src.index('if [ "$REHEARSE" = "1" ]')]
        for danger in ("systemctl stop", 'cp "$SRC" "$APP', "rm -f \"$APP"):
            self.assertNotIn(danger, body,
                             f"{danger} runs before the rehearsal branch exits")

    def test_it_does_not_require_the_sqlite3_cli(self):
        """python3 is already a hard requirement; the sqlite3 binary is not
        installed on plenty of minimal images, and the first real run of this
        script died on exactly that."""
        self.assertIn("command -v sqlite3", src_of())
        self.assertIn("import sqlite3, sys", src_of())


def src_of():
    with open(SCRIPT, encoding="utf-8") as fh:
        return fh.read()


if __name__ == "__main__":
    unittest.main()
