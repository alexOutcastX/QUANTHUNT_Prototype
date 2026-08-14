"""The boot-screen gallop, carried over from the app this one replaces.

Source-level assertions: the component is a timer, six requires and an opacity
swap inside a React Native tree, which a browser-less test cannot mount. What
can actually regress is the wiring — a missing frame, a dropped reduce-motion
check, or the boot screen quietly going back to a spinner.
"""
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUN = os.path.join(ROOT, "mobile", "src", "components", "BullRun.tsx")
GATE = os.path.join(ROOT, "mobile", "src", "components", "LoginGate.tsx")
FRAMES = os.path.join(ROOT, "mobile", "assets", "brand", "bull")


def _read(p):
    with open(p, encoding="utf-8") as fh:
        return fh.read()


class FrameAssetTest(unittest.TestCase):
    def test_all_six_frames_are_present(self):
        for i in range(6):
            p = os.path.join(FRAMES, f"{i}.png")
            self.assertTrue(os.path.isfile(p), f"{i}.png missing — the gallop would stutter")
            self.assertGreater(os.path.getsize(p), 1000, f"{i}.png is suspiciously small")

    def test_every_frame_is_the_same_size(self):
        """The frames are registered on the bull's centre of mass. One frame at
        a different size would make it jump on that beat."""
        import struct
        dims = set()
        for i in range(6):
            with open(os.path.join(FRAMES, f"{i}.png"), "rb") as fh:
                dims.add(struct.unpack(">II", fh.read(33)[16:24]))
        self.assertEqual(len(dims), 1, f"frames differ in size: {dims}")
        self.assertEqual(dims.pop(), (363, 200))


class BullRunTest(unittest.TestCase):
    def setUp(self):
        self.src = _read(RUN)

    def test_it_requires_every_frame(self):
        for i in range(6):
            self.assertIn(f"bull/{i}.png", self.src)

    def test_the_aspect_ratio_matches_the_frames(self):
        self.assertIn("200 / 363", self.src)

    def test_the_cycle_matches_the_original(self):
        """0.6s over six frames — the old app's CSS animation timing."""
        self.assertIn("CYCLE_MS = 600", self.src)
        self.assertIn("CYCLE_MS / FRAMES.length", self.src)

    def test_frames_are_stacked_and_swapped_by_opacity(self):
        """Swapping one <Image>'s source flashes the first time each frame
        paints, which on a boot screen is the whole visible lifetime."""
        self.assertIn("opacity: i === shown ? 1 : 0", self.src)
        self.assertIn("position: 'absolute'", self.src)
        self.assertIn("fadeDuration={0}", self.src)

    def test_reduce_motion_holds_a_single_frame(self):
        """A gallop is exactly what the setting is asking us not to play — but
        falling back to nothing would leave the boot screen empty."""
        self.assertIn("isReduceMotionEnabled", self.src)
        self.assertIn("reduceMotionChanged", self.src)
        self.assertIn("const shown = still ? 0 : frame", self.src)

    def test_the_timer_is_cleared(self):
        self.assertIn("clearInterval", self.src)
        self.assertIn("sub?.remove?.()", self.src)

    def test_it_is_hidden_from_screen_readers(self):
        """Decorative: announcing six identical images is noise."""
        self.assertIn("accessibilityElementsHidden", self.src)


class BootScreenTest(unittest.TestCase):
    def setUp(self):
        self.src = _read(GATE)

    def test_the_boot_wait_shows_the_bull(self):
        self.assertIn("<BullRun size={170} />", self.src)

    def test_the_spinner_is_gone(self):
        """Left in place it would be dead weight and an unused import."""
        code = "\n".join(l for l in self.src.splitlines()
                         if not l.lstrip().startswith(("//", "*", "/*")))
        self.assertNotIn("ActivityIndicator", code)

    def test_it_replaces_the_boot_state_not_the_login_form(self):
        """The bull belongs in the `!checked` branch — showing it behind the
        password box would just be decoration in the way."""
        m = re.search(r"\{!checked \? \((.*?)\) : \(", self.src, re.S)
        self.assertIsNotNone(m, "the boot branch changed shape")
        self.assertIn("BullRun", m.group(1))


if __name__ == "__main__":
    unittest.main()
