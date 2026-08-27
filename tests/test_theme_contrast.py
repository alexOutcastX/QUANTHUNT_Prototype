"""Colour contrast for the app's design tokens.

Two failures shipped for months without anyone noticing, because contrast is
invisible to the person who chose the colour and obvious to the person who
cannot read it:

  dark.muted  #6a7688 on #0e1219 = 4.07:1  — every hint and secondary label
                                             in the DEFAULT theme
  light.green #0c9c6c on #ffffff = 3.51:1  — a price going UP, in daylight

Both are fixed. This test is here so the next palette edit cannot quietly
reintroduce them.
"""
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
THEME = os.path.join(ROOT, "mobile", "src", "theme.ts")

AA_BODY = 4.5      # WCAG AA, normal text
AA_LARGE = 3.0     # WCAG AA, >=18.66px bold or >=24px


def _luminance(hex_colour):
    h = hex_colour.lstrip("#")
    ch = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    ch = [c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4 for c in ch]
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]


def contrast(a, b):
    la, lb = _luminance(a), _luminance(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def _palette(name):
    """Pull a palette literal out of theme.ts without running TypeScript."""
    src = open(THEME, encoding="utf-8").read()
    m = re.search(name + r"\s*:\s*Palette\s*=\s*\{(.*?)\n\};", src, re.S)
    if not m:
        raise AssertionError(f"{name} palette not found in theme.ts")
    return dict(re.findall(r"(\w+)\s*:\s*'(#[0-9a-fA-F]{6})'", m.group(1)))


class TokenContrastTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dark = _palette("DARK")
        cls.light = _palette("LIGHT")

    def test_both_palettes_parsed(self):
        for pal, name in ((self.dark, "DARK"), (self.light, "LIGHT")):
            self.assertGreaterEqual(len(pal), 16, f"{name} looks truncated")

    def _check(self, palette, label, keys, surface_key, threshold):
        surface = palette[surface_key]
        for key in keys:
            with self.subTest(theme=label, token=key):
                got = contrast(palette[key], surface)
                self.assertGreaterEqual(
                    round(got, 2), threshold,
                    f"{label}.{key} {palette[key]} on {surface} is {got:.2f}:1, "
                    f"needs {threshold}:1")

    # Text tokens must be readable as body copy on both card and page surfaces.
    BODY_TOKENS = ("text", "muted", "muted2", "green", "red", "brand")

    def test_dark_text_tokens_on_card(self):
        self._check(self.dark, "dark", self.BODY_TOKENS, "surface", AA_BODY)

    def test_dark_text_tokens_on_page(self):
        self._check(self.dark, "dark", self.BODY_TOKENS, "bg", AA_BODY)

    def test_light_text_tokens_on_card(self):
        self._check(self.light, "light", self.BODY_TOKENS, "surface", AA_BODY)

    def test_light_text_tokens_on_page(self):
        self._check(self.light, "light", self.BODY_TOKENS, "bg", AA_BODY)

    def test_text_on_raised_surfaces(self):
        """surface2/surface3 carry table headers and chips."""
        for pal, label in ((self.dark, "dark"), (self.light, "light")):
            for surf in ("surface2", "surface3"):
                self._check(pal, label, ("text", "muted2"), surf, AA_BODY)

    def test_accent_pairs_are_legible(self):
        """onAccent is painted directly on accent — a filled button."""
        for pal, label in ((self.dark, "dark"), (self.light, "light")):
            with self.subTest(theme=label):
                got = contrast(pal["onAccent"], pal["accent"])
                self.assertGreaterEqual(round(got, 2), AA_BODY,
                                        f"{label}: button label on its own fill is {got:.2f}:1")

    def test_borders_are_at_least_visible(self):
        """Not a text requirement, but an invisible border is not a border."""
        for pal, label in ((self.dark, "dark"), (self.light, "light")):
            with self.subTest(theme=label):
                self.assertGreater(contrast(pal["border2"], pal["surface"]), 1.25)

    # ── the two specific regressions ──
    def test_dark_muted_regression(self):
        got = contrast(self.dark["muted"], self.dark["surface"])
        self.assertGreaterEqual(round(got, 2), AA_BODY,
                                "dark.muted is the colour of every hint in the default theme")
        self.assertNotEqual(self.dark["muted"], "#6a7688", "the old failing value is back")

    def test_light_green_regression(self):
        got = contrast(self.light["green"], self.light["surface"])
        self.assertGreaterEqual(round(got, 2), AA_BODY,
                                "light.green is a price going up, read in daylight")
        self.assertNotEqual(self.light["green"], "#0c9c6c", "the old failing value is back")

    def test_up_and_down_are_not_the_same_colour(self):
        """Green and red must at least be different colours.

        This deliberately does NOT assert a luminance ratio between them. On a
        light ground the two are mathematically boxed in: forcing both to clear
        4.5:1 against #f5f7fa squeezes their luminances into the same narrow
        band, so no pair can be both AA-legible and far apart in brightness. A
        first attempt at this test demanded 1.4:1 and was unsatisfiable.

        1.25 is what the light palette can actually achieve while both tokens
        still clear AA, and it is worth having: it survives a greyscale print.
        It does not, however, help a red-green colour-blind user — only a
        non-colour cue does, which is why the direction glyph beside every P&L
        figure is the real safeguard rather than anything asserted here.
        """
        for pal, label in ((self.dark, "dark"), (self.light, "light")):
            with self.subTest(theme=label):
                self.assertNotEqual(pal["green"], pal["red"])
                self.assertGreater(contrast(pal["green"], pal["red"]), 1.25,
                                   f"{label}: up and down are hard to separate in greyscale")


if __name__ == "__main__":
    unittest.main()
