"""Show/hide password, on both sign-in surfaces.

A typo in a field you cannot read is the most common reason a correct password
appears to fail, and on a phone keyboard it is close to guaranteed. Two things
are easy to get wrong and both are checked here: a bare <button> inside a form
SUBMITS it, and switching an input's type moves the caret to the end.
"""
import os
import re
import unittest

import brandsite as bs

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GATE = os.path.join(ROOT, "mobile", "src", "components", "LoginGate.tsx")


class LandingToggleTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = bs.landing_html()

    def test_the_button_exists_next_to_the_password(self):
        self.assertIn('id="lpx"', self.html)
        self.assertIn('aria-controls="lp"', self.html)

    def test_it_cannot_submit_the_form(self):
        """A <button> with no type inside a <form> defaults to submit, so
        tapping 'Show' would try to sign you in with a half-typed password."""
        m = re.search(r'<button[^>]*id="lpx"[^>]*>', self.html)
        self.assertIsNotNone(m)
        self.assertIn('type="button"', m.group(0))

    def test_it_reports_its_state_to_a_screen_reader(self):
        self.assertIn('aria-pressed="false"', self.html)
        self.assertIn("aria-pressed'", self.html.replace('"', "'"))
        self.assertIn("Show password", self.html)
        self.assertIn("Hide password", self.html)

    def test_the_caret_is_restored_after_toggling(self):
        """Changing input.type jumps the cursor to the end — maddening in the
        middle of correcting a character."""
        self.assertIn("setSelectionRange", self.html)
        self.assertIn("selectionStart", self.html)

    def test_the_password_is_rehidden_on_submit(self):
        """Never leave a password legible on screen after the form is used."""
        self.assertIn("f.addEventListener('submit'", self.html)
        tail = self.html[self.html.index("f.addEventListener('submit'"):]
        self.assertIn("pw.type='password'", tail[:400])

    def test_the_field_leaves_room_for_the_button(self):
        """Without padding the text runs underneath the control."""
        self.assertIn(".pw input{padding-right:", bs.CSS)

    def test_the_control_is_a_real_touch_target(self):
        self.assertIn("min-width:48px", bs.CSS)
        self.assertIn("min-height:32px", bs.CSS)

    def test_it_has_a_visible_focus_state(self):
        self.assertIn(".pw-eye:focus-visible", bs.CSS)

    def test_the_password_input_still_starts_hidden(self):
        m = re.search(r'<input[^>]*id="lp"[^>]*>', self.html)
        self.assertIn('type="password"', m.group(0))


class AppLoginGateToggleTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(GATE, encoding="utf-8") as fh:
            cls.src = fh.read()

    def test_secure_entry_follows_the_toggle(self):
        self.assertIn("secureTextEntry={!showPw}", self.src)

    def test_the_toggle_is_reachable_and_labelled(self):
        self.assertIn('testID="login-pw-toggle"', self.src)
        self.assertIn("accessibilityLabel={showPw ? 'Hide password' : 'Show password'}", self.src)
        self.assertIn("accessibilityRole=\"button\"", self.src)

    def test_it_reports_state(self):
        self.assertIn("accessibilityState={{ selected: showPw }}", self.src)

    def test_it_is_a_real_touch_target(self):
        self.assertIn("hitSlop=", self.src)
        self.assertIn("minWidth: 48", self.src)

    def test_the_password_is_rehidden_on_submit(self):
        """`login` became `submit` when the gate grew a create-account mode;
        the field must still be re-hidden either way you use it."""
        body = self.src[self.src.index("const submit = useCallback"):]
        self.assertIn("setShowPw(false)", body[:700])

    def test_the_field_leaves_room_for_the_button(self):
        self.assertIn("pwInput: { paddingRight:", self.src)

    def test_autocorrect_is_off_on_the_password(self):
        """With the password visible, a keyboard would happily autocorrect it."""
        block = self.src[self.src.index("<View style={styles.pwRow}>"):
                         self.src.index("</View>", self.src.index("<View style={styles.pwRow}>"))]
        self.assertIn("autoCorrect={false}", block)
        self.assertIn('autoCapitalize="none"', block)


if __name__ == "__main__":
    unittest.main()
