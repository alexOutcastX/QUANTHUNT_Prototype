"""The type scale shrinks inside the Android shell, and only there.

The shell runs the SAME bundle as the web app. Type sized for a browser card
reads oversized on a phone held at arm's length: fewer rows fit per screen, and
density is most of what a terminal is for.

Two things make this delicate rather than a one-line constant:

  * it must be decided at MODULE LOAD. Every StyleSheet.create in the app runs
    at module load, and a size baked into one cannot be rescaled afterwards, so
    a hook or a context would be too late to matter.
  * it must not fire on the web. The fallback detection recognises the shell by
    where it is served from, and the Expo dev server is also on localhost — so
    the check has to separate them, or every developer's browser silently
    renders at phone sizes.
"""
import os
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as fh:
        return fh.read()


class TypeScaleTest(unittest.TestCase):
    def setUp(self):
        self.theme = read("mobile", "src", "theme.ts")

    def test_the_scale_is_reduced_inside_the_shell(self):
        self.assertIn("const NATIVE_SHELL", self.theme)
        self.assertIn("NATIVE_SHELL ? Math.max(9, Math.round(n * 0.9)) : n", self.theme)

    def test_every_step_of_the_scale_goes_through_it(self):
        """A step left as a literal keeps the web size, and the result is a
        scale that no longer steps evenly."""
        line = [l for l in self.theme.splitlines() if l.strip().startswith("fs: {")][0]
        for step in ("xs", "sm", "md", "lg", "xl", "xxl", "h1"):
            self.assertIn(f"{step}: fz(", line, step)

    def test_the_smallest_step_has_a_floor(self):
        """The micro-labels already sit at nine pixels. Scaling below that is
        not density, it is a smaller thing nobody can read."""
        self.assertIn("Math.max(9,", self.theme)

    def test_it_is_decided_at_module_load(self):
        self.assertIn("const fz = (n: number) =>", self.theme)
        self.assertNotIn("useNativeShell", self.theme)

    def test_capacitor_is_the_primary_signal(self):
        self.assertIn("isNativePlatform", self.theme)

    def test_the_fallback_cannot_catch_the_dev_server(self):
        """Expo dev is localhost too. It is http and carries a port; the shell
        is https with none, so all three have to be checked."""
        self.assertIn("l.protocol === 'https:'", self.theme)
        self.assertIn("l.hostname === 'localhost'", self.theme)
        self.assertIn("!l.port", self.theme)

    def test_detection_failing_leaves_the_web_scale(self):
        """Larger than intended is the status quo. Smaller than intended on the
        web would be a regression nobody asked for."""
        self.assertIn("} catch {", self.theme)

    def test_the_web_scale_itself_is_unchanged(self):
        """The reduction is for the shell. Nothing about the browser moved."""
        self.assertIn("fs: { xs: fz(10), sm: fz(12), md: fz(14), lg: fz(16), "
                      "xl: fz(20), xxl: fz(24), h1: fz(28) }", self.theme)


if __name__ == "__main__":
    unittest.main()
