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
