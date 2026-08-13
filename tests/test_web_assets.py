"""Precompressed web assets: never serve a variant we cannot vouch for.

The static routes prefer a .br/.gz sibling of each bundle file. That shortcut
has a nasty failure mode: a truncated variant is still a *file*, so a naive
existence check happily sends it as a 200 carrying `Content-Encoding: gzip`.
The browser cannot decode it, renders nothing, logs nothing, and reports no
failed request — a silent blank page. For /_expo/* assets, which ship as
`immutable, max-age=1y`, the browser then caches that blank result for a year.

These tests pin the two guarantees that close it: variants are written
atomically (a reader never sees a partial file), and only a variant this
process wrote or re-verified is ever served.
"""
import gzip
import os
import shutil
import tempfile
import unittest

try:                      # route-level tests need the web stack
    import server
except ImportError:       # stdlib-only environment — nothing to exercise here
    server = None


@unittest.skipUnless(server, "flask not installed in this environment")
class TestAtomicWrite(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir, True)

    def test_writes_full_content(self):
        p = os.path.join(self.dir, "a.gz")
        server._write_atomic(p, b"hello")
        self.assertEqual(open(p, "rb").read(), b"hello")

    def test_failed_write_leaves_the_previous_file_intact(self):
        p = os.path.join(self.dir, "a.gz")
        server._write_atomic(p, b"good")
        with self.assertRaises(Exception):
            server._write_atomic(p, "not bytes")   # raises mid-write
        self.assertEqual(open(p, "rb").read(), b"good")

    def test_failed_write_leaves_no_temp_file_behind(self):
        p = os.path.join(self.dir, "a.gz")
        with self.assertRaises(Exception):
            server._write_atomic(p, "not bytes")
        self.assertEqual(os.listdir(self.dir), [])


@unittest.skipUnless(server, "flask not installed in this environment")
@unittest.skipUnless(os.path.isdir(server.WEB_DIR if server else ""),
                     "web bundle not exported in this checkout")
class TestVariantServing(unittest.TestCase):
    """End-to-end through the real route, against the real bundle."""

    def setUp(self):
        self.c = server.app.test_client()
        server._precompress_web_dir()          # register known-good variants
        self.cache = server._web_cache_dir()
        self.gz = os.path.join(self.cache, "index.html.gz")

    def tearDown(self):
        server._precompress_web_dir()          # restore for other tests

    def _get_index(self, accept="gzip, deflate"):
        # /app, not /: the front door now serves the public landing page to
        # signed-out visitors, so the app shell — which is what the
        # precompressed-variant machinery applies to — is reached there.
        return self.c.get("/app", headers={"Accept-Encoding": accept})

    def test_valid_variant_is_served_compressed(self):
        r = self._get_index()
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.headers.get("Content-Encoding"), "gzip")
        # and it really is the shell
        self.assertIn(b'id="root"', gzip.decompress(r.data))

    def test_truncated_variant_falls_back_to_the_plain_file(self):
        # A 1-byte .gz with a *fresh* mtime: passes "does it exist", passes
        # "is it non-empty", passes "is it newer than the source" — and decodes
        # to nothing. This is the exact shape that blanked the page.
        with open(self.gz, "wb") as f:
            f.write(b"x")
        r = self._get_index()
        self.assertEqual(r.status_code, 200)
        self.assertIsNone(r.headers.get("Content-Encoding"))
        self.assertIn(b'id="root"', r.data)

    def test_deleted_variant_falls_back_to_the_plain_file(self):
        os.unlink(self.gz)
        r = self._get_index()
        self.assertEqual(r.status_code, 200)
        self.assertIsNone(r.headers.get("Content-Encoding"))
        self.assertIn(b'id="root"', r.data)

    def test_client_that_accepts_no_encoding_gets_the_plain_file(self):
        r = self._get_index(accept="identity")
        self.assertIsNone(r.headers.get("Content-Encoding"))
        self.assertIn(b'id="root"', r.data)

    def test_precompress_repairs_a_corrupt_variant(self):
        with open(self.gz, "wb") as f:
            f.write(b"garbage")
        server._precompress_web_dir()
        src = os.path.join(server.WEB_DIR, "index.html")
        self.assertEqual(len(gzip.decompress(open(self.gz, "rb").read())),
                         os.path.getsize(src))

    def test_every_served_chunk_decodes_to_its_source(self):
        # The JS chunks are the dangerous ones: they ship `immutable,
        # max-age=1y`, so a bad body would be cached for a year.
        import re
        html = open(os.path.join(server.WEB_DIR, "index.html"), "rb").read().decode()
        chunks = re.findall(r'_expo/static/js/web/[^"]+\.js', html)
        self.assertTrue(chunks, "index.html referenced no JS chunks")
        for rel in chunks:
            r = self.c.get("/" + rel, headers={"Accept-Encoding": "gzip, deflate"})
            self.assertEqual(r.status_code, 200, rel)
            body = (gzip.decompress(r.data)
                    if r.headers.get("Content-Encoding") == "gzip" else r.data)
            self.assertEqual(len(body),
                             os.path.getsize(os.path.join(server.WEB_DIR, rel)), rel)


if __name__ == "__main__":
    unittest.main()
