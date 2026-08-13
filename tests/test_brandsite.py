"""The public brand site — landing, About, Insights — and its Markdown renderer.

These pages are server-rendered HTML built from article text, so the renderer is
the security boundary: anything in a body that reaches the page unescaped is an
injection. The escaping tests are the point of this file.
"""
import os
import unittest

import brandsite as bs


class ArticleDataTest(unittest.TestCase):
    def test_articles_loaded_from_the_old_site(self):
        arts = bs.articles()
        self.assertGreaterEqual(len(arts), 20, "article content did not load")

    def test_every_article_has_what_the_templates_read(self):
        for a in bs.articles():
            for key in ("slug", "title", "summary", "category", "date", "readMins", "body"):
                self.assertIn(key, a, f"{a.get('slug')} missing {key}")
            self.assertTrue(a["body"].strip(), f"{a['slug']} has an empty body")

    def test_slugs_are_unique(self):
        slugs = [a["slug"] for a in bs.articles()]
        self.assertEqual(len(slugs), len(set(slugs)))

    def test_newest_first(self):
        dates = [a["date"] for a in bs.articles()]
        self.assertEqual(dates, sorted(dates, reverse=True))

    def test_lookup_by_slug(self):
        first = bs.articles()[0]
        self.assertEqual(bs.article(first["slug"])["title"], first["title"])
        self.assertIsNone(bs.article("no-such-article"))


class MarkdownTest(unittest.TestCase):
    def test_headings_paragraphs_and_lists(self):
        out = bs.markdown("## Why it matters\n\nSome text.\n\n- one\n- two")
        self.assertIn("<h3>Why it matters</h3>", out)
        self.assertIn("<p>Some text.</p>", out)
        self.assertIn("<li>one</li>", out)
        self.assertIn("<li>two</li>", out)

    def test_inline_emphasis_and_code(self):
        out = bs.markdown("**bold** and *italic* and `code`")
        self.assertIn("<strong>bold</strong>", out)
        self.assertIn("<em>italic</em>", out)
        self.assertIn("<code>code</code>", out)

    def test_blockquote(self):
        self.assertIn("<blockquote>", bs.markdown("> a quote"))

    def test_html_in_a_body_is_escaped_not_executed(self):
        """The whole reason this renderer escapes before it marks up."""
        out = bs.markdown("<script>alert(1)</script>")
        self.assertNotIn("<script>", out)
        self.assertIn("&lt;script&gt;", out)

    def test_html_inside_emphasis_is_still_escaped(self):
        out = bs.markdown("**<img src=x onerror=alert(1)>**")
        self.assertNotIn("<img", out)
        self.assertIn("&lt;img", out)

    def test_only_safe_link_schemes_survive(self):
        self.assertIn('href="https://example.com"', bs.markdown("[x](https://example.com)"))
        self.assertIn('href="/site/about"', bs.markdown("[x](/site/about)"))
        # javascript: and data: are dropped to plain text rather than linked.
        for bad in ("javascript:alert(1)", "data:text/html,<script>x</script>"):
            out = bs.markdown(f"[click]({bad})")
            self.assertNotIn("href", out, out)
            self.assertIn("click", out)

    def test_external_links_do_not_leak_the_opener(self):
        out = bs.markdown("[x](https://example.com)")
        self.assertIn('rel="noopener noreferrer"', out)

    def test_empty_input_is_harmless(self):
        self.assertEqual(bs.markdown(""), "")
        self.assertEqual(bs.markdown(None), "")

    def test_every_real_article_renders_without_leaking_markup(self):
        for a in bs.articles():
            out = bs.markdown(a["body"])
            self.assertNotIn("<script", out.lower(), a["slug"])
            self.assertTrue(out.strip(), a["slug"])


class PageTest(unittest.TestCase):
    def test_landing_carries_the_brand_and_a_way_into_the_app(self):
        h = bs.landing_html()
        self.assertIn("/brand/logo.png", h)
        self.assertIn("/brand/wordmark.png", h)
        self.assertIn('href="/"', h)          # Launch app
        self.assertIn("Watch. Analyze. Trade.", h)

    def test_pages_declare_social_and_icon_metadata(self):
        for h in (bs.landing_html(), bs.about_html(), bs.insights_html()):
            self.assertIn("og:title", h)
            self.assertIn("/brand/og-image.png", h)
            self.assertIn("/brand/favicon-32.png", h)
            self.assertIn("<meta name='viewport'", h)

    def test_insights_lists_every_article_and_links_each_one(self):
        h = bs.insights_html()
        for a in bs.articles():
            self.assertIn(f"/site/insights/{a['slug']}", h, a["slug"])

    def test_an_article_page_renders_its_body(self):
        a = bs.articles()[0]
        h = bs.article_html(a["slug"])
        self.assertIsNotNone(h)
        self.assertIn(a["title"].split("(")[0].strip()[:20], h)
        self.assertIn("<article class=\"body\">", h)

    def test_unknown_article_returns_none_for_the_route_to_404(self):
        self.assertIsNone(bs.article_html("nope"))

    def test_titles_with_markup_cannot_break_the_page(self):
        html = bs.page("<script>x</script>", "<p>body</p>")
        self.assertNotIn("<script>x</script>", html)

    def test_every_page_carries_the_not_advice_disclaimer(self):
        for h in (bs.landing_html(), bs.about_html(), bs.insights_html()):
            self.assertIn("not investment advice", h)
            self.assertIn("SEBI", h)


class BrandAssetTest(unittest.TestCase):
    def test_the_assets_the_pages_reference_actually_exist(self):
        for name in ("logo.png", "wordmark.png", "og-image.png", "favicon-32.png",
                     "apple-touch-icon.png", "bull-hero.png"):
            self.assertTrue(os.path.isfile(os.path.join(bs.IMG_DIR, name)),
                            f"{name} missing — the page would render a broken image")


if __name__ == "__main__":
    unittest.main()
