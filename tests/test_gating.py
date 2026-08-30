"""Paywalls, and where gating is allowed to live.

hasFeature() was exported and called nowhere for the whole life of the plan
ladder, so every feature was open to anyone who could sign in. The fix is not
just "add checks" — it is that checks live in exactly ONE component, because
gating scattered across screens is gating that gets forgotten on the next one.
"""
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "mobile", "src")


def read(*parts):
    with open(os.path.join(SRC, *parts), encoding="utf-8") as fh:
        return fh.read()


class GateComponentTest(unittest.TestCase):
    def setUp(self):
        self.src = read("components", "Gate.tsx")

    def test_it_reads_the_plan_not_a_local_flag(self):
        self.assertIn("hasFeature(feature)", self.src)

    def test_an_allowed_user_sees_no_difference(self):
        """No badge, no watermark — a paying customer should not be reminded
        they are paying on every screen."""
        self.assertIn("if (hasFeature(feature) || unlocked) return <>{children}</>;", self.src)

    def test_blur_keeps_the_content_on_screen(self):
        """A count of matches sells the upgrade; a description of them does not."""
        self.assertIn("mode === 'blur'", self.src)
        self.assertIn("blurred", self.src)

    def test_credits_are_offered_as_the_alternative(self):
        self.assertIn("chargeFor(", self.src)
        self.assertIn("Use ${creditCost} credits", self.src)

    def test_an_unlock_is_not_persisted_client_side(self):
        """Re-deriving entitlement from client state would let a reload grant
        it for free; the ledger is the record."""
        self.assertIn("React.useState(false)", self.src)
        self.assertNotIn("AsyncStorage", self.src)
        self.assertNotIn("localStorage", self.src)

    def test_a_failed_charge_does_not_unlock(self):
        self.assertIn("if (r.ok || (!r.ok && r.reason === 'covered-by-plan')) setUnlocked(true);",
                      self.src)


class GatedScreensTest(unittest.TestCase):
    """Each of these was open to anyone signed in."""

    EXPECTED = {
        "BacktestScreen.tsx": ("backtest", "max"),
        "TerminalScreen.tsx": ("terminal", "max"),
        "AnalysisScreen.tsx": ("dossier", "max"),
        "PatternScreen.tsx": ("patterns", "pro"),
        "RecommendationsScreen.tsx": ("recommendations", "pro"),
    }

    def test_each_screen_is_wrapped(self):
        for fname, (feature, plan) in self.EXPECTED.items():
            with self.subTest(screen=fname):
                src = read("screens", fname)
                self.assertIn("<Gate", src, f"{fname} is not gated")
                self.assertIn(f'feature="{feature}"', src)
                self.assertIn(f'requiredPlan="{plan}"', src)

    def test_the_default_export_is_the_gated_one(self):
        """Wrapping an inner component but exporting the raw one would gate
        nothing while looking gated."""
        for fname in self.EXPECTED:
            with self.subTest(screen=fname):
                src = read("screens", fname)
                m = re.search(r"export default function \w+\([^)]*\)[^{]*\{(.*?)\n\}", src, re.S)
                self.assertIsNotNone(m, f"{fname}: no default export found")
                self.assertIn("<Gate", m.group(1),
                              f"{fname}: the default export bypasses the gate")

    def test_no_screen_checks_the_plan_inline(self):
        """The one rule that keeps gating from drifting."""
        import glob
        for path in glob.glob(os.path.join(SRC, "screens", "*.tsx")):
            with self.subTest(screen=os.path.basename(path)):
                with open(path, encoding="utf-8") as fh:
                    body = fh.read()
                self.assertFalse(
                    "hasFeature(" in body,
                    f"{os.path.basename(path)} calls hasFeature() directly. Render "
                    f"gating belongs in <Gate>; an allowance check belongs in "
                    f"chargeFor(..., {{ feature }}).")


class CreditChargingTest(unittest.TestCase):
    def setUp(self):
        self.src = read("credits.ts")

    def test_a_plan_that_covers_it_never_pays(self):
        """Credits are the way IN for someone whose plan does not cover a
        feature, not a second toll on people already paying."""
        self.assertIn("if (opts.feature && hasFeature(opts.feature))", self.src)
        self.assertIn("'covered-by-plan'", self.src)

    def test_the_caller_supplies_a_stable_ref(self):
        self.assertIn("ref: string", self.src)
        self.assertIn("MUST be stable", self.src)

    def test_a_failure_never_reports_success(self):
        """The caller must not proceed as though it had paid."""
        self.assertIn("reason: 'unavailable'", self.src)
        self.assertIn("catch", self.src)

    def test_alerts_charge_only_beyond_the_free_five(self):
        src = read("screens", "AlertsScreen.tsx")
        self.assertIn("FREE_ALERTS = 5", src)
        self.assertIn("chargeFor('extra_alert'", src)

    def test_the_alert_is_charged_before_it_is_created(self):
        """An alert that exists but was never paid for is the worse failure."""
        src = read("screens", "AlertsScreen.tsx")
        self.assertLess(src.index("chargeFor('extra_alert'"), src.index("api.alertsCreate("))


if __name__ == "__main__":
    unittest.main()
