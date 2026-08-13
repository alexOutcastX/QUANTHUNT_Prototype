"""Where you land after signing out.

Signing out clears the session, but the SPA is already loaded — it would simply
re-render its own login gate and leave you staring at a bare password box. The
navigation back to the public landing has to be explicit, and it must NOT
happen inside the APK, which loads a bundled index.html and has no
server-rendered landing to reach.

Source-level assertions: the behaviour is a few lines of navigation glue inside
a module that pulls in AsyncStorage and the API client, which is disproportionate
to bundle for a browser-less test. What can regress here is the glue itself.
"""
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MEMBER = os.path.join(ROOT, "mobile", "src", "member.ts")
GATE = os.path.join(ROOT, "mobile", "src", "components", "LoginGate.tsx")


def _read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


class SignOutTest(unittest.TestCase):
    def setUp(self):
        self.src = _read(MEMBER)
        m = re.search(r"export async function memberLogout\(\).*?\n\}", self.src, re.S)
        self.assertIsNotNone(m, "memberLogout not found")
        self.body = m.group(0)

    def test_logout_navigates_to_the_landing_page(self):
        self.assertIn("assign?.('/')", self.body)

    def test_navigation_happens_after_the_session_is_cleared(self):
        """Navigating first would race the cookie clear and land you back on
        the app, because `/` would still see a valid session."""
        self.assertLess(self.body.index("setSessionToken('member', null)"),
                        self.body.index("assign?.('/')"))
        self.assertLess(self.body.index("emit()"), self.body.index("assign?.('/')"))

    def test_the_apk_stays_on_its_login_gate(self):
        """The native shell loads a bundled index.html from the filesystem —
        there is no landing page at '/' to navigate to."""
        self.assertIn("if (!isNativeShell())", self.body)

    def test_native_shell_is_detected_via_capacitor_not_platform_os(self):
        """Inside the APK the bundle still reports Platform.OS === 'web', so
        that check would send the app to a URL that does not exist."""
        self.assertIn("Capacitor?: { isNativePlatform?: () => boolean }", self.src)
        self.assertNotIn("Platform.OS === 'web'", self.src)

    def test_navigation_failure_cannot_break_signing_out(self):
        """A logout that throws would leave the session cleared but the UI
        stuck — the whole thing sits inside a try."""
        tail = self.body[self.body.index("if (!isNativeShell())"):]
        self.assertIn("try {", tail)
        self.assertIn("catch", tail)


class LoginGateLinkTest(unittest.TestCase):
    def setUp(self):
        self.src = _read(GATE)

    def test_the_read_more_link_goes_to_the_landing_page(self):
        self.assertIn("assign?.('/')", self.src)

    def test_it_navigates_in_place_rather_than_opening_a_tab(self):
        """Linking.openURL opens a second tab, which is not what a 'read more'
        link should do — and it is now an unused import.

        Matches a CALL rather than the bare name: the comment above the link
        explains why openURL is not used, and naming it there is not a defect.
        """
        code = "\n".join(
            l for l in self.src.splitlines()
            if not l.lstrip().startswith(("//", "*", "/*")))
        self.assertNotIn("Linking.openURL(", code)
        self.assertNotIn("  Linking,", code)
        self.assertIn("onPress={openSite}", code)


if __name__ == "__main__":
    unittest.main()
