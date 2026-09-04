"""The Android shell's build-time decisions.

The APK is not served, it is INSTALLED — so a mistake in it does not get fixed
by the next deploy the way a mistake in the web app does. It sits on a phone
until someone builds and hands over a new file. That asymmetry is why these
three things are asserted rather than left to whoever runs the workflow next:

  * the API base is https, because it is baked into the bundle at build time
    and a cleartext default would put every phone that installs the APK back on
    plain HTTP without anyone choosing that;
  * cleartext and mixed content are DERIVED from that base rather than written
    down twice, so the two cannot drift apart; and
  * the over-the-air updater is off, because the subscription behind it has
    lapsed and an enabled updater spends every cold start waiting on a request
    that cannot succeed.
"""
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as fh:
        return fh.read()


class CapacitorConfigTest(unittest.TestCase):
    def setUp(self):
        self.cfg = read("mobile", "capacitor.config.ts")

    def test_the_default_api_base_is_the_https_domain(self):
        self.assertIn("process.env.EXPO_PUBLIC_API_BASE || 'https://taureye.com'", self.cfg)

    def test_no_plain_http_host_is_left_anywhere_in_it(self):
        """The VM's bare IP was the fallback while TLS was pending. A stale one
        left behind is invisible until a phone is on a hostile network."""
        stray = re.findall(r"http://(?!localhost)[\w.\-]+", self.cfg)
        self.assertEqual(stray, [], f"plain-http host in the shell config: {stray}")

    def test_cleartext_is_derived_from_the_base_not_asserted_separately(self):
        """Two independent switches for one fact eventually disagree."""
        self.assertIn("const plainHttp = apiBase.startsWith('http://');", self.cfg)
        self.assertIn("allowMixedContent: plainHttp", self.cfg)
        self.assertIn("cleartext: plainHttp", self.cfg)

    def test_the_over_the_air_updater_is_off(self):
        self.assertIn("autoUpdate: false", self.cfg)
        self.assertNotIn("autoUpdate: true", self.cfg)

    def test_the_application_id_is_unchanged(self):
        """It is the app's identity to Android. Changing it turns the next APK
        into a second, empty copy of the app rather than an update to it."""
        self.assertIn("appId: 'com.taureye.terminal.app'", self.cfg)


class BuildTest(unittest.TestCase):
    def test_the_version_code_comes_from_the_build_not_a_hand_edited_line(self):
        """Android orders updates by versionCode alone. A constant means the
        second APK ever built cannot replace the first."""
        gradle = read("mobile", "android", "app", "build.gradle")
        self.assertIn('System.getenv("TAUREYE_VERSION_CODE")', gradle)

    def test_the_workflow_supplies_it(self):
        wf = read(".github", "workflows", "android.yml")
        self.assertIn("TAUREYE_VERSION_CODE: ${{ github.run_number }}", wf)

    def test_the_workflow_falls_back_to_https_too(self):
        wf = read(".github", "workflows", "android.yml")
        self.assertNotIn("161.118.174.177", wf)
        self.assertIn("vars.TAUREYE_API_BASE || 'https://taureye.com'", wf)

    def test_the_signing_caveat_is_written_down(self):
        """A debug APK is signed with a key the runner generates fresh, so it
        will not install over one from an earlier run. Whoever hands the file
        over needs to know that before the user sees 'App not installed'."""
        wf = read(".github", "workflows", "android.yml")
        self.assertIn("debug.keystore", wf)
        self.assertIn("Uninstall the old app first", wf)


class ServerTest(unittest.TestCase):
    def test_the_server_allows_the_webview_origin(self):
        """The shell loads from https://localhost and calls a different origin,
        so without this the APK builds cleanly and then shows nothing."""
        src = read("server.py")
        self.assertIn('"https://localhost"', src)
        self.assertIn("supports_credentials=True", src)


if __name__ == "__main__":
    unittest.main()
