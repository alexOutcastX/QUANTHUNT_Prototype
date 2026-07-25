"""Session transport: cookie on the web, bearer header in the Android shell.

The Capacitor WebView runs at https://localhost and calls this API cross-site,
where browsers refuse to attach SameSite cookies — so every session there has
to survive as a header instead. These tests pin both halves: the header is
accepted wherever the cookie is, and the cookie flags harden automatically the
moment the request arrives over TLS.
"""
import os
import unittest

import server


class TestSessionTransport(unittest.TestCase):
    def setUp(self):
        self.c = server.app.test_client()

    # ── member session ───────────────────────────────────────────────────────
    def _member_token(self):
        r = self.c.post('/auth/member/login',
                        json={'username': 'Taureye', 'password': 'TaureyePW'})
        self.assertEqual(r.status_code, 200)
        return r.get_json()['token']

    def test_login_returns_a_token(self):
        self.assertTrue(self._member_token())

    def test_header_session_works_without_any_cookie(self):
        tok = self._member_token()
        self.c.delete_cookie('te_member')          # what a cross-site call sees
        self.assertIsNone(self.c.get('/auth/member').get_json()['member'])
        r = self.c.get('/auth/member', headers={'X-TE-Member': tok})
        self.assertEqual(r.get_json()['member']['username'], 'Taureye')

    def test_bearer_prefix_accepted(self):
        tok = self._member_token()
        self.c.delete_cookie('te_member')
        r = self.c.get('/auth/member', headers={'X-TE-Member': 'Bearer ' + tok})
        self.assertEqual(r.get_json()['member']['uname'], 'taureye')

    def test_tampered_and_empty_tokens_rejected(self):
        tok = self._member_token()
        self.c.delete_cookie('te_member')
        for bad in (tok[:-3] + 'zzz', 'garbage', ''):
            r = self.c.get('/auth/member', headers={'X-TE-Member': bad})
            self.assertIsNone(r.get_json()['member'], bad)

    # ── owner session ────────────────────────────────────────────────────────
    def test_owner_header_session(self):
        os.environ['APP_PASSWORD'] = 'pw-transport-test'
        try:
            r = self.c.post('/auth/login', json={'password': 'pw-transport-test'})
            tok = r.get_json()['token']
            self.c.delete_cookie('te_owner')
            self.assertFalse(self.c.get('/auth/status').get_json()['owner'])
            self.assertTrue(
                self.c.get('/auth/status', headers={'X-TE-Owner': tok}).get_json()['owner'])
        finally:
            os.environ.pop('APP_PASSWORD', None)

    # ── cookie flags follow the transport ────────────────────────────────────
    def test_cookie_is_lax_over_http(self):
        r = self.c.post('/auth/member/login',
                        json={'username': 'Taureye', 'password': 'TaureyePW'})
        cookie = dict(r.headers)['Set-Cookie']
        self.assertIn('SameSite=Lax', cookie)
        self.assertNotIn('Secure', cookie)   # browsers drop SameSite=None w/o it
        self.assertIn('HttpOnly', cookie)

    def test_cookie_is_none_secure_behind_tls(self):
        r = self.c.post('/auth/member/login',
                        json={'username': 'Taureye', 'password': 'TaureyePW'},
                        headers={'X-Forwarded-Proto': 'https'})
        cookie = dict(r.headers)['Set-Cookie']
        self.assertIn('SameSite=None', cookie)
        self.assertIn('Secure', cookie)
        self.assertIn('HttpOnly', cookie)
