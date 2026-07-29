"""The bhavcopy quote backfill, and the caching that keeps /index instant.

Only one of the three constituent sources carries prices, and it is the one
that is blocked from cloud IPs. In production that meant every index came back
as a bare list of symbols and the screener painted a full table of em-dashes.
These tests pin the two halves of the fix: the universe cache is used to fill
those prices in, and the quoteless sources are no longer re-fetched (through a
multi-second timeout) once a minute.
"""
import time
import unittest
from unittest import mock

try:
    import server
except Exception:                        # flask absent on the stdlib CI path
    server = None


_warm_patch = None


def setUpModule():
    """NSE is reachable from CI, so a background universe warm kicked off by one
    test lands in _universe_cache in the middle of the next one. Pin it shut."""
    global _warm_patch
    if server:
        _warm_patch = mock.patch.object(server, "_warm_universe_async")
        _warm_patch.start()


def tearDownModule():
    if _warm_patch:
        _warm_patch.stop()


def _uni(*rows):
    """Install rows as the universe cache and return the matching timestamp."""
    server._universe_cache = list(rows)
    server._universe_ts = time.time()
    server._QUOTE_IDX["ts"], server._QUOTE_IDX["map"] = 0.0, {}


BHAV = [
    {"symbol": "AAA", "exchange": "NSE", "price": 100.0, "prevClose": 98.0,
     "chg": 2.04, "absChg": 2.0, "open": 98.5, "high": 101.0, "low": 98.0,
     "volume": 12345.0, "turnover": 1234500.0},
    {"symbol": "BBB", "exchange": "NSE", "price": 50.0, "prevClose": 52.0,
     "chg": -3.85, "absChg": -2.0, "volume": 999.0, "turnover": 49950.0},
    # A symbol the bhavcopy knows about but that never traded — no usable price.
    {"symbol": "CCC", "exchange": "NSE", "price": 0.0, "chg": None},
]


@unittest.skipUnless(server, "server import unavailable")
class QuoteIndexTest(unittest.TestCase):
    def setUp(self):
        self._cache, self._ts = server._universe_cache, server._universe_ts
        self.addCleanup(self._restore)
        _uni(*BHAV)

    def _restore(self):
        server._universe_cache, server._universe_ts = self._cache, self._ts
        server._QUOTE_IDX["ts"], server._QUOTE_IDX["map"] = 0.0, {}

    def test_indexes_only_symbols_with_a_real_price(self):
        m = server._quote_index()
        self.assertIn("AAA", m)
        self.assertIn("BBB", m)
        self.assertNotIn("CCC", m, "a zero close is not a quote")

    def test_carries_the_whole_ohlcv_row(self):
        q = server._quote_index()["AAA"]
        for k in ("price", "prevClose", "chg", "absChg", "volume", "turnover"):
            self.assertIn(k, q, k)

    def test_a_flat_close_keeps_its_zero(self):
        """0.0 is a number we know, not a missing value — dropping it would
        render an em-dash for a stock that simply finished unchanged."""
        _uni({"symbol": "FLAT", "price": 42.0, "chg": 0.0, "absChg": 0.0})
        q = server._quote_index()["FLAT"]
        self.assertEqual(q["chg"], 0.0)
        self.assertEqual(q["absChg"], 0.0)

    def test_rebuilt_only_when_the_universe_turns_over(self):
        first = server._quote_index()
        self.assertIs(server._quote_index(), first, "rebuilt without a refresh")
        _uni(*BHAV)                       # new timestamp = new bhavcopy
        self.assertIsNot(server._quote_index(), first, "stale map served after refresh")

    def test_empty_universe_yields_an_empty_map(self):
        server._universe_cache = []
        self.assertEqual(server._quote_index(), {})


@unittest.skipUnless(server, "server import unavailable")
class EnrichQuotesTest(unittest.TestCase):
    def setUp(self):
        self._cache, self._ts = server._universe_cache, server._universe_ts
        self.addCleanup(self._restore)
        _uni(*BHAV)

    def _restore(self):
        server._universe_cache, server._universe_ts = self._cache, self._ts
        server._QUOTE_IDX["ts"], server._QUOTE_IDX["map"] = 0.0, {}

    def test_fills_a_bare_constituent_list(self):
        rows, filled = server._enrich_quotes([{"symbol": "AAA"}, {"symbol": "BBB"}])
        self.assertEqual(filled, 2)
        self.assertEqual(rows[0]["price"], 100.0)
        self.assertEqual(rows[0]["volume"], 12345.0)
        self.assertEqual(rows[1]["chg"], -3.85)

    def test_never_overwrites_a_live_quote(self):
        """A live NSE tick outranks a settled close — this is the whole reason
        the merge is field-by-field instead of a dict update."""
        rows, filled = server._enrich_quotes([{"symbol": "AAA", "price": 111.0, "chg": 5.0}])
        self.assertEqual(rows[0]["price"], 111.0)
        self.assertEqual(rows[0]["chg"], 5.0)
        self.assertEqual(filled, 0, "a row that already had a price was counted as filled")
        # ...but the gaps in that row are still worth filling.
        self.assertEqual(rows[0]["volume"], 12345.0)

    def test_does_not_mutate_the_caller_s_rows(self):
        """`rows` may be the memoised constituent list; writing settled closes
        into it would make them look live on the next request."""
        src = [{"symbol": "AAA"}]
        out, _ = server._enrich_quotes(src)
        self.assertIsNone(src[0].get("price"), "the shared cache was mutated")
        self.assertEqual(out[0]["price"], 100.0)

    def test_unknown_symbols_pass_through(self):
        rows, filled = server._enrich_quotes([{"symbol": "ZZZ"}])
        self.assertEqual(filled, 0)
        self.assertEqual(rows[0], {"symbol": "ZZZ"})

    def test_cold_universe_kicks_a_warm_and_returns_the_rows(self):
        server._universe_cache = []
        server._warm_universe_async.reset_mock()     # stubbed for the module
        rows, filled = server._enrich_quotes([{"symbol": "AAA"}])
        server._warm_universe_async.assert_called_once()
        self.assertEqual(filled, 0)
        self.assertEqual(rows[0], {"symbol": "AAA"})

    def test_empty_input(self):
        self.assertEqual(server._enrich_quotes([]), ([], 0))


@unittest.skipUnless(server, "server import unavailable")
class IndexRouteQuotesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.c = server.app.test_client()

    def setUp(self):
        self._cache, self._ts = server._universe_cache, server._universe_ts
        self._mem = dict(server._INDEX_MEM)
        self.addCleanup(self._restore)
        _uni(*BHAV)
        server._INDEX_MEM.clear()

    def _restore(self):
        server._universe_cache, server._universe_ts = self._cache, self._ts
        server._INDEX_MEM.clear()
        server._INDEX_MEM.update(self._mem)
        server._QUOTE_IDX["ts"], server._QUOTE_IDX["map"] = 0.0, {}

    def _get(self, rows, source):
        with mock.patch.object(server, "_get_constituents", return_value=(rows, source)):
            return self.c.get("/index?name=NIFTY%2050").get_json()

    def test_bare_csv_list_comes_back_priced(self):
        j = self._get([{"symbol": "AAA"}, {"symbol": "BBB"}], "niftyindices-csv")
        self.assertEqual(j["priced"], 2)
        self.assertEqual(j["quote_source"], "bhavcopy")
        self.assertEqual(j["data"][0]["price"], 100.0)

    def test_a_settled_close_is_dated(self):
        with mock.patch.object(server, "_BHAV_DATE", "2026-07-28"):
            j = self._get([{"symbol": "AAA"}], "niftyindices-csv")
        self.assertEqual(j["quote_date"], "2026-07-28",
                         "the client cannot label a stale price it isn't told about")

    def test_a_live_feed_is_labelled_live_and_undated(self):
        j = self._get([{"symbol": "AAA", "price": 111.0}], "nse")
        self.assertEqual(j["quote_source"], "nse")
        self.assertIsNone(j["quote_date"])
        self.assertEqual(j["data"][0]["price"], 111.0)

    def test_a_live_feed_missing_some_names_is_mixed(self):
        j = self._get([{"symbol": "AAA", "price": 111.0}, {"symbol": "BBB"}], "nse")
        self.assertEqual(j["quote_source"], "mixed")

    def test_a_bhavcopy_derived_group_is_not_mislabelled_live(self):
        """SME EMERGE rows already carry prices because they came FROM the
        bhavcopy. Deciding on fill count rather than source called those live."""
        j = self._get([{"symbol": "AAA", "price": 100.0}], "bhavcopy")
        self.assertEqual(j["quote_source"], "bhavcopy")

    def test_no_prices_anywhere_says_so(self):
        server._universe_cache = []
        j = self._get([{"symbol": "ZZZ"}], "niftyindices-csv")
        self.assertEqual(j["quote_source"], "none")
        self.assertEqual(j["priced"], 0)


@unittest.skipUnless(server, "server import unavailable")
class UniverseRouteTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.c = server.app.test_client()

    def test_master_list_carries_quotes(self):
        with mock.patch.object(server, "get_universe", return_value=list(BHAV)), \
             mock.patch.object(server, "_BHAV_DATE", "2026-07-28"):
            j = self.c.get("/universe").get_json()
        self.assertEqual(j["as_of"], "2026-07-28")
        by = {s["symbol"]: s for s in j["symbols"]}
        self.assertEqual(by["AAA"]["price"], 100.0)
        self.assertEqual(by["AAA"]["volume"], 12345.0)
        self.assertIsNone(by["CCC"]["price"], "a zero close should serialise as null")


@unittest.skipUnless(server, "server import unavailable")
class IndexCacheTtlTest(unittest.TestCase):
    def test_quoteless_sources_are_held_far_longer_than_live_ones(self):
        """The CSV and static lists carry no prices — re-fetching them every
        minute bought nothing and cost a multi-second stall each time."""
        self.assertEqual(server._index_mem_ttl("nse"), server._INDEX_MEM_TTL)
        for src in ("niftyindices-csv", "static", "stale-niftyindices-csv", "bhavcopy"):
            self.assertEqual(server._index_mem_ttl(src), server._INDEX_MEM_TTL_STATIC, src)
        self.assertGreater(server._INDEX_MEM_TTL_STATIC, server._INDEX_MEM_TTL * 5)

    def test_live_rows_still_expire_quickly(self):
        self.assertLessEqual(server._INDEX_MEM_TTL, 120)


@unittest.skipUnless(server, "server import unavailable")
class NseCooloffTest(unittest.TestCase):
    def setUp(self):
        self._mem = dict(server._INDEX_MEM)
        self._down = server._NSE_IDX_DOWN_UNTIL
        self.addCleanup(self._restore)
        server._INDEX_MEM.clear()
        server._NSE_IDX_DOWN_UNTIL = 0.0

    def _restore(self):
        server._INDEX_MEM.clear()
        server._INDEX_MEM.update(self._mem)
        server._NSE_IDX_DOWN_UNTIL = self._down

    def test_one_failure_stops_the_others_from_retrying(self):
        """equity-stockIndices is blocked wholesale, not per index. Sixteen
        indices each waiting out its own timeout is most of a cold load."""
        calls = []

        def boom(path, params=None):
            calls.append(params)
            raise RuntimeError("HTTP 404")

        with mock.patch.object(server, "nse_get", side_effect=boom), \
             mock.patch.object(server, "_fetch_niftyindices_csv",
                               return_value=[{"symbol": "AAA"}]):
            for name in ("NIFTY 50", "NIFTY 100", "NIFTY 200", "NIFTY 500"):
                rows, source = server._get_constituents(name)
                self.assertEqual(source, "niftyindices-csv")
        self.assertEqual(len(calls), 1, "kept hammering a known-dead endpoint")

    def test_the_cooloff_expires(self):
        server._NSE_IDX_DOWN_UNTIL = time.time() - 1
        with mock.patch.object(server, "nse_get",
                               return_value={"data": [{"symbol": "AAA", "lastPrice": 1.0}]}):
            rows, source = server._get_constituents("NIFTY 50")
        self.assertEqual(source, "nse")


@unittest.skipUnless(server, "server import unavailable")
class WarmSymbolsTest(unittest.TestCase):
    def test_warm_loop_uses_the_fallback_chain(self):
        """Asking NSE Direct straight meant the warm loop warmed nothing in
        production — the one place a hot cache actually matters."""
        with mock.patch.object(server, "_get_constituents",
                               return_value=([{"symbol": "AAA"}, {"symbol": "BBB"}],
                                             "niftyindices-csv")) as gc:
            syms = server._warm_index_symbols("nifty 50")
        gc.assert_called_once_with("NIFTY 50")
        self.assertEqual(syms, ["AAA", "BBB"])

    def test_a_dead_index_warms_nothing_rather_than_raising(self):
        with mock.patch.object(server, "_get_constituents", return_value=(None, None)):
            self.assertEqual(server._warm_index_symbols("NIFTY 50"), [])


if __name__ == "__main__":
    unittest.main()
