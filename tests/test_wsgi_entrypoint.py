"""The gunicorn entrypoint must import.

server.py's __main__ block and wsgi.py start the same background loops, and
only the second one runs in production. A loop added to both, but imported into
only one, is invisible to every test that goes through server.py — and the
first sign of it is a worker that dies on boot and an nginx 502 in front of a
site that was working a minute earlier. That is exactly how start_snapshots()
shipped: called on line 28 of wsgi.py, absent from the import on line 15.
"""

import ast
import os
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _module(name):
    with open(os.path.join(ROOT, name), encoding="utf-8") as fh:
        return ast.parse(fh.read(), filename=name)


class WsgiNamesTest(unittest.TestCase):
    """Static, so it runs in the stdlib CI path where Flask is absent —
    importing wsgi for real would need the whole dependency tree, which is
    what made this hole possible."""

    def setUp(self):
        self.tree = _module("wsgi.py")

    def _bound(self):
        names = set(dir(__builtins__)) | {"__name__", "__file__"}
        for node in ast.walk(self.tree):
            if isinstance(node, ast.ImportFrom):
                names |= {(a.asname or a.name) for a in node.names}
            elif isinstance(node, ast.Import):
                names |= {(a.asname or a.name).split(".")[0] for a in node.names}
            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                names.add(node.name)
            elif isinstance(node, ast.Assign):
                for t in node.targets:
                    if isinstance(t, ast.Name):
                        names.add(t.id)
        return names

    def test_every_name_it_calls_is_imported(self):
        bound = self._bound()
        called = {n.func.id for n in ast.walk(self.tree)
                  if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)}
        missing = sorted(called - bound - set(dir(__builtins__)))
        self.assertEqual(missing, [], f"wsgi.py calls names it never imports: {missing}")

    def test_it_starts_the_same_loops_as_the_dev_entrypoint(self):
        """Anything server.py starts under __main__ has to start here too, or
        it simply never runs in production."""
        server = _module("server.py")
        main = [n for n in ast.walk(server) if isinstance(n, ast.If)
                and isinstance(n.test, ast.Compare)
                and isinstance(n.test.left, ast.Name) and n.test.left.id == "__name__"]
        self.assertTrue(main, "server.py has no __main__ block")
        started = {c.func.id for n in main for c in ast.walk(n)
                   if isinstance(c, ast.Call) and isinstance(c.func, ast.Name)
                   and c.func.id.startswith("start_")}
        here = {c.func.id for c in ast.walk(self.tree)
                if isinstance(c, ast.Call) and isinstance(c.func, ast.Name)}
        missing = sorted(started - here)
        self.assertEqual(missing, [],
                         f"started by `python server.py` but never under gunicorn: {missing}")

    def test_the_snapshot_builder_is_one_of_them(self):
        """The regression this file was written for."""
        here = {c.func.id for c in ast.walk(self.tree)
                if isinstance(c, ast.Call) and isinstance(c.func, ast.Name)}
        self.assertIn("start_snapshots", here)
        self.assertIn("start_snapshots", self._bound())


if __name__ == "__main__":
    unittest.main()
