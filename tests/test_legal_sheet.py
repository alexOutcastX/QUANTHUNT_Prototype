"""The disclaimer opens over the app, and says exactly what legal.html says.

The header's DISCLAIMER control called Linking.openURL('/legal.html'). On the
web that replaces the app with a plain document; in a standalone install it
opens a page with no way back. You could read the disclaimer and then you were
stuck in it — which is the one thing a notice you are meant to glance at and
dismiss must not do.

It is a sheet now. Which means the text exists twice: as the served
legal.html (what a link from outside the app opens) and as data the app
renders. Two copies of a legal notice that can disagree is worse than an
awkward link, so this parses the served file and fails if a single block of it
is missing from — or added to — what the app shows.
"""
import html
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as fh:
        return fh.read()


def parse_legal_html():
    """(sections, note) from the served page — headings, paragraphs, bullets."""
    body = _read("legal.html").split("<main>", 1)[1].split("</main>", 1)[0]

    def clean(t):
        return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", t))).strip()

    sections, cur, note = [], None, None
    for m in re.finditer(r"<(h1|h2|p|ul)(?:\s([^>]*))?>(.*?)</\1>", body, re.S):
        tag, attrs, inner = m.group(1), m.group(2) or "", m.group(3)
        if tag == "h1":
            continue
        if tag == "h2":
            cur = {"title": clean(inner), "blocks": []}
            sections.append(cur)
        elif tag == "ul":
            for li in re.finditer(r"<li>(.*?)</li>", inner, re.S):
                cur["blocks"].append(clean(li.group(1)))
        elif tag == "p":
            txt = clean(inner)
            if "note" in attrs:
                note = txt
            else:
                cur["blocks"].append(txt)
    return sections, note


def code_only(src):
    """Source with whole-line comments dropped.

    Necessary before looking for string literals: an apostrophe in a comment
    ("the header's DISCLAIMER") opens a literal that swallows everything to the
    next quote, and every assertion downstream then compares nonsense.
    """
    return "\n".join(
        l for l in src.splitlines() if not l.strip().startswith(("//", "*", "/*")))


def ts_strings(src):
    """Every single-quoted string literal in a .ts file, unescaped."""
    return [m.group(1).replace("\\'", "'").replace("\\\\", "\\")
            for m in re.finditer(r"'((?:[^'\\]|\\.)*)'", code_only(src))]


class LegalParityTest(unittest.TestCase):
    def setUp(self):
        self.ts = _read("mobile", "src", "legal.ts")
        self.sections, self.note = parse_legal_html()

    def test_the_served_page_is_worth_comparing_against(self):
        self.assertGreaterEqual(len(self.sections), 4)
        self.assertTrue(self.note)

    def test_every_heading_appears_in_the_app(self):
        strings = ts_strings(self.ts)
        for sec in self.sections:
            self.assertIn(sec["title"], strings, sec["title"])

    def test_every_paragraph_and_bullet_appears_in_the_app(self):
        strings = ts_strings(self.ts)
        for sec in self.sections:
            for block in sec["blocks"]:
                self.assertIn(block, strings, f"{sec['title']}: {block[:60]}…")

    def test_the_closing_note_appears_too(self):
        self.assertIn(self.note, ts_strings(self.ts))

    def test_the_app_adds_nothing_the_page_does_not_say(self):
        """Drift in the other direction is just as bad: a term shown in the app
        and not in the served notice is a term nobody agreed to."""
        served = {s["title"] for s in self.sections}
        served |= {b for s in self.sections for b in s["blocks"]}
        served.add(self.note)
        served.add("Disclaimer & Privacy")
        # Only the prose literals — kinds, keys and the title constant aside.
        prose = [t for t in ts_strings(self.ts) if len(t) > 40]
        for t in prose:
            self.assertIn(t, served, t[:60] + "…")

    def test_a_bullet_stays_a_bullet_and_a_paragraph_a_paragraph(self):
        li = sum(1 for s in self.sections for b in s["blocks"] if b.startswith(
            ("Market data", "Relationship graphs", "Backtests", "Your watchlists",
             "The server keeps", "News links")))
        # With the brace and comma: a bare "kind: 'p'" also matches the type
        # declaration one line up.
        self.assertEqual(self.ts.count("{ kind: 'li',"), li)
        self.assertEqual(
            self.ts.count("{ kind: 'p',"),
            sum(len(s["blocks"]) for s in self.sections) - li)


class LegalSheetTest(unittest.TestCase):
    def setUp(self):
        self.sheet = _read("mobile", "src", "components", "LegalSheet.tsx")
        self.shell = _read("mobile", "src", "Shell.tsx")

    def test_the_disclaimer_no_longer_leaves_the_app(self):
        code = code_only(self.shell)
        self.assertNotIn("Linking.openURL", code)
        self.assertNotIn("/legal.html", code)

    def test_it_opens_over_whatever_you_were_on(self):
        self.assertIn("{open ? <LegalSheet onClose={() => setOpen(false)} /> : null}", self.shell)
        # Sheet portals through a Modal, so it draws over the header too.
        self.assertIn("<Sheet onClose={onClose}", self.sheet)

    def test_it_can_be_closed(self):
        self.assertIn('accessibilityLabel="Close the disclaimer"', self.sheet)
        self.assertIn("✕ Close", self.sheet)
        self.assertIn("onPress={onClose}", self.sheet)

    def test_the_control_says_it_is_a_button_not_a_link(self):
        """It stopped being a link the moment it stopped navigating."""
        legal = self.shell.split("function LegalLink")[1].split("\n}\n")[0]
        self.assertIn('accessibilityRole="button"', legal)
        self.assertNotIn('accessibilityRole="link"', legal)

    def test_it_renders_the_shared_text_rather_than_its_own_copy(self):
        self.assertIn("from '../legal'", self.sheet)
        self.assertIn("LEGAL_SECTIONS.map", self.sheet)
        self.assertIn("{LEGAL_NOTE}", self.sheet)
        # No prose of its own — that is what would drift.
        body = self.sheet.split("const s = StyleSheet.create")[0]
        for lit in ts_strings(body):
            # ts_strings pairs quotes in order; a bare length regex would pair
            # the CLOSING quote of one import with the OPENING quote of the
            # next and call the gap between them prose.
            if len(lit) > 60:
                self.fail("hard-coded prose in the sheet: " + lit[:60])

    def test_the_served_page_is_still_there_for_links_from_outside(self):
        self.assertTrue(os.path.exists(os.path.join(ROOT, "legal.html")))


if __name__ == "__main__":
    unittest.main()
