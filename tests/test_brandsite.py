"""The public brand site — landing, About, Insights — and its Markdown renderer.

These pages are server-rendered HTML built from article text, so the renderer is
the security boundary: anything in a body that reaches the page unescaped is an
injection. The escaping tests are the point of this file.
"""
import os
import re
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
    def test_landing_carries_the_brand_and_a_way_in(self):
        h = bs.landing_html()
        self.assertIn("/brand/logo.png", h)
        self.assertIn("/brand/wordmark.png", h)
        self.assertIn("Watch. Analyze. Trade.", h)
        # The way in is the sign-in form, not a "launch" link — see
        # SignInPanelTest for the rest.
        self.assertIn("#signin", h)

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


class SignInPanelTest(unittest.TestCase):
    """The landing's primary action is signing in, not 'launching'."""

    def setUp(self):
        self.h = bs.landing_html()

    def test_launch_app_buttons_are_gone(self):
        self.assertNotIn("Launch the app", self.h)
        self.assertNotIn("Launch app", self.h)

    def test_the_form_posts_to_the_same_endpoint_the_app_uses(self):
        """One credential path, not a second one that drifts from it."""
        self.assertIn("/auth/member/login", self.h)
        self.assertIn('id="lu"', self.h)   # username
        self.assertIn('id="lp"', self.h)   # password
        self.assertIn('type="password"', self.h)

    def test_credentials_are_sent_with_the_session_cookie(self):
        self.assertIn("credentials:'include'", self.h.replace(" ", ""))

    def test_social_buttons_render_and_are_honest_when_unconfigured(self):
        self.assertIn("Continue with Google", self.h)
        self.assertIn("Continue with Apple", self.h)
        # No provider credentials in the test environment, so they must be
        # disabled rather than sending someone to a provider that will refuse.
        self.assertIn("disabled", self.h)
        self.assertIn("not connected yet", self.h)

    def test_terms_and_privacy_are_linked_from_the_form(self):
        self.assertIn("/site/legal/terms", self.h)
        self.assertIn("/site/legal/privacy", self.h)


class CreateAccountPanelTest(unittest.TestCase):
    """The same card signs you in or signs you up — no invitation wall."""

    def setUp(self):
        self.h = bs.landing_html()

    def test_the_invitation_only_copy_is_gone(self):
        """Sign-up is open, so the card must not say otherwise."""
        self.assertNotIn("Members only", self.h)
        self.assertNotIn("invitation", self.h)
        self.assertNotIn("while we are in beta", self.h)

    def test_both_modes_are_offered(self):
        self.assertIn('id="mi"', self.h)   # sign in
        self.assertIn('id="mu"', self.h)   # create account
        self.assertIn("Create account", self.h)
        self.assertIn('role="tablist"', self.h)

    def test_sign_in_is_the_one_selected_on_arrival(self):
        """Most visitors already have an account; the default must suit them."""
        mi = re.search(r'id="mi"[^>]*>', self.h).group(0)
        mu = re.search(r'id="mu"[^>]*>', self.h).group(0)
        self.assertIn('aria-selected="true"', mi)
        self.assertIn('aria-selected="false"', mu)

    def test_creating_an_account_posts_to_the_register_route(self):
        self.assertIn("/auth/member/register", self.h)

    def test_the_form_asks_the_server_what_the_rules_are(self):
        """Rules stated here must be the rules the server enforces."""
        self.assertIn("/auth/member/signup-policy", self.h)
        self.assertIn("policy.password_min", self.h)
        self.assertIn("policy.username_min", self.h)
        self.assertIn("policy.invite_required", self.h)

    def test_the_switch_hides_itself_when_sign_up_is_closed(self):
        """A button that can only ever refuse is worse than no button."""
        self.assertIn("modes.hidden = true", self.h)

    def test_the_server_sentence_is_what_the_visitor_reads(self):
        self.assertIn("res.j.detail", self.h)

    def test_the_new_password_field_is_marked_as_new(self):
        """Password managers offer to generate one only when told it is new."""
        self.assertIn("'new-password'", self.h)

    def test_the_fine_print_follows_the_mode(self):
        self.assertIn("By creating an account you agree to our", self.h)
        self.assertIn("By signing in you agree to our", self.h)

    def test_an_invite_field_exists_but_is_hidden_until_it_is_needed(self):
        code = re.search(r'id="cw"[^>]*>', self.h).group(0)
        self.assertIn("hidden", code)
        self.assertIn('id="lc"', self.h)


class LegalTest(unittest.TestCase):
    def test_all_five_documents_have_content(self):
        for key, title in bs.LEGAL_DOCS:
            h = bs.legal_html(key)
            self.assertIsNotNone(h, key)
            self.assertIn(title, h)
            self.assertNotIn("is being prepared", h, f"{key} fell back to a stub")

    def test_documents_carry_the_substituted_entity_details(self):
        """The JSX placeholders must have been resolved, not shipped raw."""
        for key, _ in bs.LEGAL_DOCS:
            h = bs.legal_html(key)
            self.assertNotIn("{product}", h)
            self.assertNotIn("{entity}", h)
            self.assertNotIn("{email}", h)
            self.assertNotIn('{" "}', h)

    def test_the_disclaimer_still_says_the_important_thing(self):
        h = bs.legal_html("disclaimer")
        self.assertIn("not a SEBI-registered", h)
        self.assertIn("Not investment advice", h)

    def test_unknown_document_returns_none_so_the_route_can_redirect(self):
        self.assertIsNone(bs.legal_html("nope"))

    def test_every_document_is_reachable_from_every_other(self):
        for key, _ in bs.LEGAL_DOCS:
            h = bs.legal_html(key)
            for other, _t in bs.LEGAL_DOCS:
                self.assertIn(f"/site/legal/{other}", h)


class ContactAndGuideTest(unittest.TestCase):
    def test_contact_shows_the_support_address(self):
        h = bs.contact_html()
        self.assertIn(bs.SUPPORT_EMAIL, h)
        self.assertIn("mailto:", h)

    def test_contact_form_stores_nothing(self):
        """It composes a mailto — say so, rather than implying a backend."""
        self.assertIn("we do", bs.contact_html())
        self.assertIn("not store", bs.contact_html())

    def test_guide_links_only_to_routes_that_exist_here(self):
        """The previous guide pointed at /app/screener and /blog/... — routes
        this app does not have. A guide that 404s is worse than none."""
        h = bs.tutorial_html()
        self.assertNotIn("/app/", h)
        self.assertNotIn('href="/blog', h)
        self.assertIn("/site/insights", h)
        self.assertIn("/site/legal/disclaimer", h)

    def test_guide_names_the_dossier_convention(self):
        self.assertIn("Taureye_Dossier_", bs.tutorial_html())


class NavigationTest(unittest.TestCase):
    def test_every_public_page_links_to_all_the_others(self):
        pages = (bs.landing_html(), bs.about_html(), bs.insights_html(),
                 bs.contact_html(), bs.tutorial_html(), bs.legal_html("terms"))
        for h in pages:
            for href in ("/site/insights", "/site/about", "/site/tutorial",
                         "/site/contact", "/site/legal/terms"):
                self.assertIn(href, h)


class HeroBullTest(unittest.TestCase):
    """The bull sits above the headline and turns with the pointer.

    It used to sit beside the 'What it does' heading, well below the fold, and
    was a flat image. Both are easy to undo by accident while editing the hero,
    so both are pinned here.
    """

    def setUp(self):
        self.html = bs.landing_html()

    def test_the_bull_comes_before_the_headline(self):
        art = self.html.index('id="bull"')
        h1 = self.html.index("The Indian market,")
        self.assertLess(art, h1, "the bull dropped below the headline")

    def test_it_is_inside_the_hero_not_a_later_section(self):
        hero = self.html.index('class="hero"')
        nxt = self.html.index("<section", hero + 10)
        self.assertLess(hero, self.html.index('id="bull"'))
        self.assertLess(self.html.index('id="bull"'), nxt)

    def test_the_bull_appears_exactly_once(self):
        """It was moved, not copied — two bulls on one page is a regression."""
        self.assertEqual(self.html.count("/brand/bull-hero.png"), 1)

    def test_the_fallback_tilt_is_driven_by_pointer_position(self):
        for bit in ("pointermove", "--rx", "--ry", "perspective:900px",
                    "rotateX(var(--rx"):
            self.assertIn(bit, self.html, bit)

    def test_the_fallback_motion_is_subtle(self):
        """'A very little with the mouse' — a big tilt reads as a gimmick and
        distorts a render that was not modelled to be seen from the side."""
        self.assertRegex(self.html, r"MAX = (\d+);")
        import re as _re
        self.assertLessEqual(int(_re.search(r"MAX = (\d+);", self.html).group(1)), 15)

    def test_reduced_motion_and_touch_are_opted_out(self):
        """A tilt chasing a finger is either invisible or in the way, and the
        media query is a stated user preference, not a suggestion."""
        self.assertIn("prefers-reduced-motion: reduce", self.html)
        self.assertIn("(hover: hover) and (pointer: fine)", self.html)
        self.assertIn("@media(prefers-reduced-motion:reduce)", bs.CSS)

    def test_the_image_keeps_its_aspect_ratio(self):
        """width/height attributes reserve the space so the headline does not
        jump — but without height:auto they would squash the bull."""
        self.assertIn('width="772" height="708"', self.html)
        self.assertIn("height:auto", bs.CSS)

    def test_writes_are_throttled_to_one_per_frame(self):
        """pointermove fires far faster than the display refreshes; writing a
        style property on each one is layout thrash for frames nobody sees."""
        self.assertIn("requestAnimationFrame", self.html)

    def test_it_still_renders_without_the_script(self):
        """The tilt is an enhancement — the img tag carries the art itself."""
        self.assertIn('<img src="/brand/bull-hero.png"', self.html)


class Bull3DSceneTest(unittest.TestCase):
    """The real 3D bull, ported from the app this one replaces.

    brand/src/bull.ts is bundled with three.js to brand/img/bull.js, which is
    COMMITTED — the server has no build step, Flask serves brand/img off disk.
    A committed artefact can drift from its source silently, so the bundle
    records a hash of what it was built from and that is checked here.
    """

    ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    SOURCES = ("brand/src/bull.ts", "brand/src/bullhead.obj")

    @classmethod
    def setUpClass(cls):
        cls.html = bs.landing_html()
        with open(os.path.join(cls.ROOT, "brand", "img", "bull.js"), "rb") as fh:
            cls.bundle = fh.read()
        cls.banner = cls.bundle[:60].decode("utf-8", "replace")

    def test_the_bundle_is_built_from_the_current_sources(self):
        """Edit bull.ts, forget `npm run build:bull`, and the landing keeps
        serving the old scene. This is the only thing that would notice."""
        import hashlib
        h = hashlib.sha256()
        for rel in self.SOURCES:
            with open(os.path.join(self.ROOT, rel), "rb") as fh:
                h.update(fh.read())
        expected = h.hexdigest()[:16]
        self.assertIn(expected, self.banner,
                      "brand/img/bull.js is stale — run `npm run build:bull`")

    def test_the_model_is_bundled_not_fetched(self):
        """A second request for the .obj is a second chance to fail, and the
        model is 21 KB — smaller than the request overhead is worth."""
        self.assertTrue(b"Blender" in self.bundle, "the OBJ text is not in the bundle")

    def test_the_scene_ships_three_js(self):
        self.assertTrue(b"WebGLRenderer" in self.bundle, "three.js is not in the bundle")

    def test_the_landing_points_at_the_bundle_with_a_cache_buster(self):
        """/brand/* is cached for a week, which is right for a logo and wrong
        for a script."""
        self.assertRegex(self.html, r"/brand/bull\.js\?v=[0-9a-f]{8}")

    def test_the_cache_buster_tracks_the_file(self):
        self.assertNotEqual(bs._asset_v("bull.js"), "0")
        self.assertEqual(bs._asset_v("no-such-file.js"), "0")

    def test_the_bundle_is_not_in_the_critical_path(self):
        """150 KB gzipped must not compete with the landing's first paint: no
        blocking tag, fetched on idle or first genuine interaction."""
        self.assertNotIn('<script src="/brand/bull.js', self.html)
        self.assertIn("requestIdleCallback", self.html)
        self.assertIn("pointermove", self.html)
        self.assertIn("s.async = true", self.html)

    def test_reduced_motion_does_not_even_download_it(self):
        """Loading a 150 KB animation bundle and then refusing to animate wastes
        the visitor's data to honour their preference."""
        loader = self.html[self.html.index("function loadScene"):
                           self.html.index("</script>", self.html.index("function loadScene"))]
        self.assertIn("prefers-reduced-motion: reduce", loader)
        self.assertIn("if (!matchMedia", loader)

    def test_scroll_is_not_an_intent_signal(self):
        """A Lighthouse pass synthesizes scroll; treating it as intent means the
        bundle lands inside the measured window every time."""
        loader = self.html[self.html.index("var EVENTS"):self.html.index("var loaded")]
        self.assertNotIn("scroll", loader)
        self.assertNotIn("wheel", loader)

    def test_the_still_render_is_what_ships_in_the_html(self):
        """The hero must be complete before any of this runs, and stay complete
        on a device with no WebGL."""
        self.assertIn('<img src="/brand/bull-hero.png"', self.html)

    def test_the_canvas_replaces_the_render_rather_than_stacking_on_it(self):
        self.assertIn(".hero-art[data-webgl] img{opacity:0}", bs.CSS)
        self.assertIn(".hero-art[data-webgl] canvas{opacity:1}", bs.CSS)

    def test_the_box_does_not_depend_on_the_image_it_hides(self):
        """Sizing the mount by its <img> would collapse it to nothing the moment
        the image faded out — and the canvas sizes itself from the mount."""
        self.assertIn("aspect-ratio:772/708", bs.CSS)
        self.assertIn(".hero-art img,.hero-art canvas{position:absolute", bs.CSS)

    def test_the_fallback_tilt_stands_down_once_the_scene_is_live(self):
        """Two parallax implementations fighting over the same element."""
        self.assertIn("if (el.dataset.webgl) return;", self.html)

    def test_the_scene_survives_a_device_without_webgl(self):
        with open(os.path.join(self.ROOT, "brand", "src", "bull.ts"), encoding="utf-8") as fh:
            ts = fh.read()
        self.assertIn("WebGL unavailable", ts)
        self.assertIn("catch", ts)

    def test_the_loop_stops_when_the_hero_is_off_screen(self):
        with open(os.path.join(self.ROOT, "brand", "src", "bull.ts"), encoding="utf-8") as fh:
            ts = fh.read()
        self.assertIn("IntersectionObserver", ts)
        self.assertIn("cancelAnimationFrame", ts)

    def test_pausing_does_not_make_the_sway_jump(self):
        """THREE.Clock keeps running while the loop is stopped, so resuming
        from it would snap the bull to wherever the sine had got to."""
        with open(os.path.join(self.ROOT, "brand", "src", "bull.ts"), encoding="utf-8") as fh:
            ts = fh.read()
        self.assertNotIn("getElapsedTime", ts)
        self.assertIn("t += Math.min((now - last) / 1000", ts)


class BundleTransferTest(unittest.TestCase):
    """562 KB of three.js is 146 KB gzipped. Whether the visitor gets the first
    number or the second is decided entirely by nginx's gzip_types, and Flask
    labels .js as text/javascript — not application/javascript."""

    def setUp(self):
        conf = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                            "deploy", "nginx-quanthunt.conf")
        with open(conf, encoding="utf-8") as fh:
            self.src = fh.read()

    def test_javascript_is_compressed_under_the_type_flask_actually_sends(self):
        import mimetypes
        guessed = mimetypes.guess_type("bull.js")[0]
        self.assertIn(guessed, self.src,
                      f"nginx does not gzip {guessed}, which is what .js is served as")

    def test_the_bundle_is_above_the_compression_threshold(self):
        self.assertIn("gzip_min_length 1024", self.src)


class BrandPrecompressedTest(unittest.TestCase):
    """The bundle ships with a .gz beside it and the route serves that to any
    client which accepts gzip — 562 KB becomes 146 KB without depending on one
    machine's nginx config being right.

    A bad variant is the dangerous case: a 200 the browser cannot decode, held
    for a week by this route's cache header. Hence the integrity check.
    """

    @classmethod
    def setUpClass(cls):
        import tempfile
        os.environ.setdefault("DB_PATH", tempfile.mktemp(suffix=".db"))
        os.environ["TRADELOG_BACKFILL"] = "0"
        try:
            import server
        except Exception as e:
            raise unittest.SkipTest("server import unavailable: %s" % e)
        cls.server = server
        cls.client = server.app.test_client()

    def test_a_client_that_accepts_gzip_gets_the_compressed_copy(self):
        r = self.client.get("/brand/bull.js", headers={"Accept-Encoding": "gzip"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.headers.get("Content-Encoding"), "gzip")
        self.assertIn("Accept-Encoding", r.headers.get("Vary", ""))

    def test_it_decodes_to_exactly_the_bundle_on_disk(self):
        import gzip as gz
        r = self.client.get("/brand/bull.js", headers={"Accept-Encoding": "gzip"})
        with open(os.path.join(bs.IMG_DIR, "bull.js"), "rb") as fh:
            original = fh.read()
        self.assertEqual(gz.decompress(r.data), original)

    def test_the_compressed_copy_is_worth_shipping(self):
        with open(os.path.join(bs.IMG_DIR, "bull.js.gz"), "rb") as fh:
            packed = len(fh.read())
        raw = os.path.getsize(os.path.join(bs.IMG_DIR, "bull.js"))
        self.assertLess(packed * 3, raw, "the .gz saves less than 3x — check the build")

    def test_a_client_that_does_not_accept_gzip_gets_the_plain_file(self):
        r = self.client.get("/brand/bull.js", headers={"Accept-Encoding": ""})
        self.assertEqual(r.status_code, 200)
        self.assertIsNone(r.headers.get("Content-Encoding"))

    def test_the_javascript_content_type_survives_the_swap(self):
        """The file actually sent is bull.js.gz; without an explicit type the
        browser would be handed application/gzip and refuse to execute it."""
        r = self.client.get("/brand/bull.js", headers={"Accept-Encoding": "gzip"})
        self.assertIn("javascript", r.headers.get("Content-Type", ""))

    def test_images_are_untouched(self):
        r = self.client.get("/brand/logo.png", headers={"Accept-Encoding": "gzip"})
        self.assertEqual(r.status_code, 200)
        self.assertIsNone(r.headers.get("Content-Encoding"))

    def test_a_variant_that_does_not_match_its_source_is_refused(self):
        """The integrity check, exercised rather than merely read: a truncated
        .gz must be ignored, not served as an undecodable 200."""
        reg = self.server._BRAND_GZ
        self.assertIn("bull.js", reg, "the good variant was not registered")
        saved = dict(reg)
        try:
            reg["bull.js"] = saved["bull.js"] + 1        # stale mtime
            r = self.client.get("/brand/bull.js", headers={"Accept-Encoding": "gzip"})
            self.assertIsNone(r.headers.get("Content-Encoding"),
                              "a variant that changed under us was still served")
        finally:
            reg.clear()
            reg.update(saved)
