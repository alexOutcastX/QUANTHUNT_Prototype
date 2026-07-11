"""
Curated company-relationship graph (demo dataset for the Terminal tab).

Hand-curated from widely known, public relationships — supplier/customer
links, group structures, financiers and competitors around the Indian
auto/steel/logistics cluster. Every edge carries a note and a confidence tag;
this is INDICATIVE knowledge, not verified filings data. The /graph response
shape is designed so an AI-generated graph (Claude API) can replace this
dataset later without frontend changes.

Edge types:
  supplies    directed: src supplies goods/components to dst
  group       undirected: same promoter group / parent-subsidiary
  competitor  undirected: competes in a core segment
  finances    directed: src finances purchases of dst's products
"""

# ticker -> {name, listed} (listed = tradable on NSE; unlisted nodes render grey)
COMPANIES = {
    "TMCV":       {"name": "Tata Motors Commercial Vehicles", "listed": True},
    "TATAMOTORS": {"name": "Tata Motors (Passenger Vehicles)", "listed": True},
    "TATASTEEL":  {"name": "Tata Steel", "listed": True},
    "JSWSTEEL":   {"name": "JSW Steel", "listed": True},
    "SAIL":       {"name": "Steel Authority of India", "listed": True},
    "NMDC":       {"name": "NMDC (iron ore)", "listed": True},
    "COALINDIA":  {"name": "Coal India", "listed": True},
    "NTPC":       {"name": "NTPC (power)", "listed": True},
    "BHARATFORG": {"name": "Bharat Forge", "listed": True},
    "MOTHERSON":  {"name": "Samvardhana Motherson", "listed": True},
    "UNOMINDA":   {"name": "Uno Minda", "listed": True},
    "BOSCHLTD":   {"name": "Bosch India", "listed": True},
    "APOLLOTYRE": {"name": "Apollo Tyres", "listed": True},
    "MRF":        {"name": "MRF", "listed": True},
    "ASHOKLEY":   {"name": "Ashok Leyland", "listed": True},
    "EICHERMOT":  {"name": "Eicher Motors (VECV)", "listed": True},
    "MARUTI":     {"name": "Maruti Suzuki", "listed": True},
    "M&M":        {"name": "Mahindra & Mahindra", "listed": True},
    "HYUNDAI":    {"name": "Hyundai Motor India", "listed": True},
    "CHOLAFIN":   {"name": "Cholamandalam Investment", "listed": True},
    "SUNDARMFIN": {"name": "Sundaram Finance", "listed": True},
    "INDUSINDBK": {"name": "IndusInd Bank", "listed": True},
    "TIINDIA":    {"name": "Tube Investments", "listed": True},
    "VRLLOG":     {"name": "VRL Logistics", "listed": True},
    "TCI":        {"name": "Transport Corporation of India", "listed": True},
    "LT":         {"name": "Larsen & Toubro", "listed": True},
    "JLR":        {"name": "Jaguar Land Rover", "listed": False},
    "SUZUKI":     {"name": "Suzuki Motor (Japan)", "listed": False},
    "TATASONS":   {"name": "Tata Sons (promoter)", "listed": False},
}

# (src, dst, type, note, confidence)
EDGES = [
    # ── TMCV: the worked example ──
    ("TATASTEEL", "TMCV", "supplies", "Automotive-grade steel; intra-group sourcing relationship", "high"),
    ("JSWSTEEL", "TMCV", "supplies", "Alternative supplier of auto-grade steel", "medium"),
    ("BHARATFORG", "TMCV", "supplies", "Forged components — axles, crankshafts for trucks", "high"),
    ("MOTHERSON", "TMCV", "supplies", "Wiring harnesses and polymer modules", "high"),
    ("BOSCHLTD", "TMCV", "supplies", "Fuel-injection systems, braking and vehicle electronics", "high"),
    ("APOLLOTYRE", "TMCV", "supplies", "OEM truck & bus tyres", "high"),
    ("MRF", "TMCV", "supplies", "OEM tyres", "medium"),
    ("TMCV", "VRLLOG", "supplies", "Fleet operator running Tata trucks — indirect demand exposure", "medium"),
    ("TMCV", "TCI", "supplies", "Logistics fleets purchase Tata CVs", "medium"),
    ("CHOLAFIN", "TMCV", "finances", "Major CV financier — retail/dealer loans on Tata trucks", "high"),
    ("SUNDARMFIN", "TMCV", "finances", "CV financing — demand for its loans tracks truck sales", "medium"),
    ("ASHOKLEY", "TMCV", "competitor", "Direct M&HCV competitor", "high"),
    ("EICHERMOT", "TMCV", "competitor", "VECV competes in trucks and buses", "high"),
    ("M&M", "TMCV", "competitor", "Competes in LCV / pickup segment", "high"),
    ("TATAMOTORS", "TMCV", "group", "2025 demerger split Tata Motors into CV and PV entities", "high"),
    ("TATASONS", "TMCV", "group", "Promoter group", "high"),

    # ── Tata Motors (PV) ──
    ("TATASONS", "TATAMOTORS", "group", "Promoter group", "high"),
    ("JLR", "TATAMOTORS", "group", "Wholly-owned luxury subsidiary", "high"),
    ("TATASTEEL", "TATAMOTORS", "supplies", "Body and structural steel", "high"),
    ("MOTHERSON", "TATAMOTORS", "supplies", "Wiring harnesses, mirrors, modules", "high"),
    ("BOSCHLTD", "TATAMOTORS", "supplies", "Powertrain and electronics components", "medium"),
    ("MARUTI", "TATAMOTORS", "competitor", "Passenger-vehicle market competitor", "high"),
    ("M&M", "TATAMOTORS", "competitor", "SUV segment competitor", "high"),
    ("HYUNDAI", "TATAMOTORS", "competitor", "Passenger-vehicle market competitor", "high"),

    # ── Steel upstream ──
    ("NMDC", "TATASTEEL", "supplies", "Iron ore (Tata Steel also has captive mines)", "medium"),
    ("COALINDIA", "TATASTEEL", "supplies", "Domestic coal; coking coal is largely imported", "medium"),
    ("NMDC", "JSWSTEEL", "supplies", "Iron ore purchases (part-captive since Odisha auctions)", "medium"),
    ("COALINDIA", "JSWSTEEL", "supplies", "Domestic thermal/coking coal linkages", "medium"),
    ("TATASTEEL", "LT", "supplies", "Structural steel for construction and infrastructure", "medium"),
    ("JSWSTEEL", "MARUTI", "supplies", "Auto-grade flat steel to PV makers", "medium"),
    ("JSWSTEEL", "TATASTEEL", "competitor", "India's two largest private steelmakers", "high"),
    ("SAIL", "TATASTEEL", "competitor", "Public-sector steel competitor", "high"),
    ("SAIL", "JSWSTEEL", "competitor", "Public-sector steel competitor", "high"),

    # ── Power / coal ──
    ("COALINDIA", "NTPC", "supplies", "Thermal coal for power generation — largest customer", "high"),

    # ── Maruti cluster ──
    ("SUZUKI", "MARUTI", "group", "Parent company (Japan)", "high"),
    ("MOTHERSON", "MARUTI", "supplies", "Largest customer historically — harnesses and modules", "high"),
    ("BOSCHLTD", "MARUTI", "supplies", "Powertrain components", "medium"),
    ("HYUNDAI", "MARUTI", "competitor", "Passenger-vehicle market competitor", "high"),
    ("M&M", "MARUTI", "competitor", "SUV segment competitor", "high"),

    # ── Ancillaries / finance / groups ──
    ("UNOMINDA", "MOTHERSON", "competitor", "Auto-ancillary components competitor", "medium"),
    ("BHARATFORG", "ASHOKLEY", "supplies", "Forged components for CVs", "medium"),
    ("APOLLOTYRE", "ASHOKLEY", "supplies", "OEM tyres", "medium"),
    ("CHOLAFIN", "ASHOKLEY", "finances", "Finances Ashok Leyland truck purchases too", "medium"),
    ("INDUSINDBK", "ASHOKLEY", "group", "Both Hinduja group companies", "high"),
    ("TIINDIA", "CHOLAFIN", "group", "Both Murugappa group companies", "high"),
]


def graph():
    """Full curated dataset in the AI-ready response shape."""
    return {
        "companies": COMPANIES,
        "edges": [
            {"src": s, "dst": d, "type": t, "note": n, "confidence": c}
            for (s, d, t, n, c) in EDGES
        ],
        "available": sorted(k for k in COMPANIES if any(
            k in (e[0], e[1]) for e in EDGES)),
        "source": "curated-demo",
        "disclaimer": ("Curated demo dataset — indicative public knowledge, not "
                       "verified filings data. AI-generated graphs for any "
                       "company arrive when an API key is configured."),
    }
