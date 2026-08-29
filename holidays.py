"""
NSE trading holidays + live market open/closed status (IST).

IMPORTANT: NSE publishes the official trading-holiday calendar via circulars
late in the preceding year and may amend it (especially the lunar-calendar
holidays: Holi, Id-Ul-Fitr, Bakri Id, Ganesh Chaturthi, Dussehra, Diwali,
Guru Nanak Jayanti). The 2026 list below is INDICATIVE — best-known dates —
and must be verified against NSE circulars before relying on it.
"""
import datetime

IST = datetime.timezone(datetime.timedelta(hours=5, minutes=30), "IST")

# Indicative NSE trading holidays for 2026 — verify with NSE circulars.
NSE_HOLIDAYS_2026 = [
    ("2026-01-26", "Republic Day"),
    ("2026-02-15", "Mahashivratri"),
    ("2026-03-04", "Holi"),
    ("2026-03-20", "Id-Ul-Fitr (Ramzan Id)"),
    ("2026-04-03", "Good Friday"),
    ("2026-04-14", "Dr. Baba Saheb Ambedkar Jayanti"),
    ("2026-05-01", "Maharashtra Day"),
    ("2026-05-27", "Bakri Id"),
    ("2026-08-15", "Independence Day"),
    ("2026-09-14", "Ganesh Chaturthi"),
    ("2026-10-02", "Mahatma Gandhi Jayanti"),
    ("2026-10-20", "Dussehra"),
    ("2026-11-08", "Diwali (Laxmi Pujan)"),
    ("2026-11-24", "Guru Nanak Jayanti"),
    ("2026-12-25", "Christmas"),
]

_HOLIDAY_DATES = {d for d, _ in NSE_HOLIDAYS_2026}


def market_status(now=None):
    """Is the NSE cash market open right now (Mon-Fri 09:15-15:30 IST,
    excluding trading holidays)? `now` (datetime, aware or naive-IST) is for
    tests; defaults to the current time.
    """
    if now is None:
        now = datetime.datetime.now(datetime.timezone.utc)
    if now.tzinfo is not None:
        now = now.astimezone(IST)
    today = now.strftime("%Y-%m-%d")
    minutes = now.hour * 60 + now.minute
    is_open = (now.weekday() < 5
               and today not in _HOLIDAY_DATES
               and 9 * 60 + 15 <= minutes <= 15 * 60 + 30)
    next_holiday = None
    for d, name in sorted(NSE_HOLIDAYS_2026):
        if d >= today:
            next_holiday = {"date": d, "name": name}
            break
    return {"open": bool(is_open),
            "now_ist": now.strftime("%Y-%m-%d %H:%M"),
            "next_holiday": next_holiday}


def holidays():
    """Full holiday list, sorted by date, with the weekday name."""
    return [{"date": d, "name": name,
             "day": datetime.datetime.strptime(d, "%Y-%m-%d").strftime("%A")}
            for d, name in sorted(NSE_HOLIDAYS_2026)]


def is_trading_day(d):
    """Weekday, and not on the published holiday list."""
    if isinstance(d, str):
        d = datetime.datetime.strptime(d, "%Y-%m-%d").date()
    return d.weekday() < 5 and d.strftime("%Y-%m-%d") not in _HOLIDAY_DATES


def last_session(now=None):
    """The trading date the current quotes belong to, as YYYY-MM-DD.

    Today once the session has opened; otherwise the previous trading day. On
    a Saturday, a Sunday, or a Monday before 09:15 that is Friday — which is
    the whole point: a quote taken then IS Friday's close, and its change
    belongs to Friday's session, not to a session that has not happened.

    Walks back day by day rather than subtracting a fixed offset, so a long
    weekend or a Diwali cluster resolves to the last day that actually traded.
    """
    if now is None:
        now = datetime.datetime.now(datetime.timezone.utc)
    if now.tzinfo is not None:
        now = now.astimezone(IST)
    d = now.date()
    open_yet = now.hour * 60 + now.minute >= 9 * 60 + 15
    if not (is_trading_day(d) and open_yet):
        d -= datetime.timedelta(days=1)
        # 14 is comfortably more than the longest stretch the NSE has ever
        # been shut; the bound only stops a bad holiday table looping forever.
        for _ in range(14):
            if is_trading_day(d):
                break
            d -= datetime.timedelta(days=1)
    return d.strftime("%Y-%m-%d")
