import unittest

import news


RSS = b"""<?xml version="1.0"?>
<rss><channel>
<item>
  <title>Top Gainers &amp;amp; Losers on 24 July</title>
  <link>https://example.com/a</link>
  <pubDate>Thu, 24 Jul 2026 10:00:00 +0530</pubDate>
</item>
<item>
  <title>Plain &amp; simple headline</title>
  <link>https://example.com/b</link>
</item>
<item>
  <title></title>
  <link>https://example.com/skipped</link>
</item>
</channel></rss>"""


class TestNewsParse(unittest.TestCase):
    def test_double_encoded_entities_unescaped(self):
        items = news.parse_feed(RSS, "Test")
        titles = [i["title"] for i in items]
        self.assertIn("Top Gainers & Losers on 24 July", titles)
        self.assertIn("Plain & simple headline", titles)
        self.assertNotIn("&amp;", " ".join(titles))

    def test_empty_titles_skipped_and_never_raises(self):
        items = news.parse_feed(RSS, "Test")
        self.assertEqual(len(items), 2)
        self.assertEqual(news.parse_feed(b"not xml at all", "Test"), [])


class TestSummary(unittest.TestCase):
    """The article popup shows the feed's standfirst, so it must be plain text.

    Publisher descriptions are HTML fragments (thumbnail, wrapping <p>, a
    trailing "read more" anchor) and are frequently double-escaped.
    """

    def test_strips_markup_and_unescapes_twice(self):
        raw = ('&lt;a href="x"&gt;&lt;img src="t.jpg"/&gt;&lt;/a&gt; Banks led gains '
               '&amp;amp; autos followed.')
        self.assertEqual(news.clean_summary(raw),
                         "Banks led gains & autos followed.")

    def test_collapses_whitespace(self):
        self.assertEqual(news.clean_summary("a\n\n  b\tc"), "a b c")

    def test_missing_description_is_empty_not_none(self):
        self.assertEqual(news.clean_summary(""), "")
        self.assertEqual(news.clean_summary(None or ""), "")

    def test_truncates_on_a_word_boundary(self):
        out = news.clean_summary("word " * 200)
        self.assertLessEqual(len(out), news.SUMMARY_MAX + 1)
        self.assertTrue(out.endswith("…"))
        self.assertNotIn("wor…", out)          # never splits mid-word

    def test_summary_reaches_the_item(self):
        feed = (b'<rss><channel><item><title>T</title><link>https://e.com/a</link>'
                b'<description>&lt;p&gt;A standfirst.&lt;/p&gt;</description>'
                b'</item></channel></rss>')
        self.assertEqual(news.parse_feed(feed, "Test")[0]["summary"], "A standfirst.")

    def test_description_that_merely_repeats_the_headline_is_dropped(self):
        # Google News descriptions are link markup that strips back to the
        # headline — showing it twice in the popup would be noise.
        feed = (b'<rss><channel><item><title>Sensex up 500</title>'
                b'<link>https://e.com/a</link>'
                b'<description>Sensex up 500</description></item></channel></rss>')
        self.assertEqual(news.parse_feed(feed, "Test")[0]["summary"], "")

    def test_item_without_description_still_carries_the_key(self):
        # The UI branches on a plain falsy check, so the key must always exist.
        items = news.parse_feed(RSS, "Test")
        self.assertTrue(all("summary" in i for i in items))
