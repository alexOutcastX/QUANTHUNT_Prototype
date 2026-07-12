"""Unit tests for option-chain parsing + analytics (crafted payloads, no network)."""
import importlib
import unittest


def _leg(oi, iv, ltp):
    return {"openInterest": oi, "changeinOpenInterest": 0, "impliedVolatility": iv,
            "lastPrice": ltp, "totalTradedVolume": 0}


class DerivativesTest(unittest.TestCase):
    def setUp(self):
        import derivatives
        self.d = importlib.reload(derivatives)

    def _chain(self):
        # Underlying at 100; strikes 90..110. Put OI heavier than call OI.
        rows = []
        for k in (90, 95, 100, 105, 110):
            rows.append({
                "strikePrice": k, "expiryDate": "31-Jul-2026",
                "CE": _leg(100, 20 + k - 100, max(100 - k, 0) + 2),
                "PE": _leg(200, 22 + 100 - k, max(k - 100, 0) + 2),
            })
        # A second expiry that must be ignored when we ask for the first.
        rows.append({"strikePrice": 100, "expiryDate": "28-Aug-2026", "CE": _leg(9, 9, 9)})
        return {"records": {"expiryDates": ["31-Jul-2026", "28-Aug-2026"],
                            "underlyingValue": 100, "data": rows}}

    def test_parse_basic(self):
        out = self.d.parse_chain(self._chain())
        self.assertEqual(out["underlying"], 100)
        self.assertEqual(out["expiry"], "31-Jul-2026")
        self.assertEqual(len(out["strikes"]), 5)  # second expiry excluded
        self.assertEqual(out["atm"], 100)
        self.assertEqual(out["source"], "NSE")

    def test_pcr(self):
        out = self.d.parse_chain(self._chain())
        # total PE OI (200*5) / total CE OI (100*5) = 2.0
        self.assertEqual(out["pcr"], 2.0)
        self.assertEqual(out["total_ce_oi"], 500)
        self.assertEqual(out["total_pe_oi"], 1000)

    def test_max_pain_is_a_strike(self):
        out = self.d.parse_chain(self._chain())
        self.assertIn(out["max_pain"], [90, 95, 100, 105, 110])

    def test_max_pain_symmetric(self):
        # Uniform call+put OI across three strikes => pain minimised at the centre.
        ladder = [
            {"strike": k, "ce": {"oi": 100}, "pe": {"oi": 100}} for k in (90, 100, 110)
        ]
        self.assertEqual(self.d.max_pain(ladder), 100)

    def test_max_pain_skewed(self):
        # Heavy put OI at the top strike drags the min-loss point up to 110.
        ladder = [
            {"strike": 90, "ce": {"oi": 100}, "pe": {"oi": 100}},
            {"strike": 100, "ce": {"oi": 100}, "pe": {"oi": 100}},
            {"strike": 110, "ce": {"oi": 100}, "pe": {"oi": 500}},
        ]
        self.assertEqual(self.d.max_pain(ladder), 110)

    def test_expiry_selection(self):
        out = self.d.parse_chain(self._chain(), expiry="28-Aug-2026")
        self.assertEqual(out["expiry"], "28-Aug-2026")
        self.assertEqual(len(out["strikes"]), 1)

    def test_endpoint_routing(self):
        self.assertEqual(self.d._endpoint("NIFTY"), "indices")
        self.assertEqual(self.d._endpoint("BANKNIFTY"), "indices")
        self.assertEqual(self.d._endpoint("RELIANCE"), "equities")

    def test_empty_payload(self):
        out = self.d.parse_chain({})
        self.assertEqual(out["strikes"], [])
        self.assertIsNone(out["pcr"])
        self.assertIsNone(out["max_pain"])

    def test_option_chain_injected_fetch(self):
        captured = {}

        def fake_fetch(url):
            captured["url"] = url
            return self._chain()

        out = self.d.option_chain("NIFTY", fake_fetch)
        self.assertIn("option-chain-indices", captured["url"])
        self.assertEqual(out["symbol"], "NIFTY")
        self.assertEqual(out["pcr"], 2.0)


if __name__ == "__main__":
    unittest.main()
