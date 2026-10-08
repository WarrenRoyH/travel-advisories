#!/usr/bin/env python3
"""
fetch_advisories.py
Fetches, normalizes, and correlates travel advisory data from:
1. US Department of State ArcGIS FeatureServer (Layer 54)
2. US Department of State Travel Advisories RSS Feed (TAsTWs.xml)
3. ISO-3166 Standard Reference for world atlas integration
"""

import json
import os
import re
import unicodedata
import urllib.request
from datetime import datetime, timezone

HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    "Accept": "application/json, text/xml, application/xml, */*",
}

ARCGIS_URL = (
    "https://services6.arcgis.com/R6wlO6UHmSzqm9Vs/arcgis/rest/services/"
    "Travel_Advisory_Levels__(2024)_View_Layer/FeatureServer/54/query?"
    "where=NAME+IS+NOT+NULL&outFields=*&returnGeometry=false&f=json"
)

RSS_URL = "https://travel.state.gov/_res/rss/TAsTWs.xml"

# Level metadata dictionary
LEVEL_META = {
    1: {
        "code": "L1",
        "title": "Level 1: Exercise Normal Precautions",
        "badge": "NORMAL PRECAUTIONS",
        "tactical_status": "NORMAL // DEFCON 5",
        "color": "#10b981", # Emerald
        "border_color": "#34d399",
        "bg_glow": "rgba(16, 185, 129, 0.2)",
    },
    2: {
        "code": "L2",
        "title": "Level 2: Exercise Increased Caution",
        "badge": "INCREASED CAUTION",
        "tactical_status": "CAUTION // DEFCON 4",
        "color": "#eab308", # Tactical Amber-Yellow
        "border_color": "#fde047",
        "bg_glow": "rgba(234, 179, 8, 0.25)",
    },
    3: {
        "code": "L3",
        "title": "Level 3: Reconsider Travel",
        "badge": "RECONSIDER TRAVEL",
        "tactical_status": "ELEVATED THREAT // DEFCON 3",
        "color": "#f97316", # Tactical Orange
        "border_color": "#fb923c",
        "bg_glow": "rgba(249, 115, 22, 0.3)",
    },
    4: {
        "code": "L4",
        "title": "Level 4: Do Not Travel",
        "badge": "DO NOT TRAVEL",
        "tactical_status": "CRITICAL RISK // DEFCON 1-2",
        "color": "#ef4444", # Tactical Crimson
        "border_color": "#f87171",
        "bg_glow": "rgba(239, 68, 68, 0.4)",
    },
    0: {
        "code": "L0",
        "title": "Domestic Base / Territory",
        "badge": "DOMESTIC BASE",
        "tactical_status": "HOME BASE // SECURE",
        "color": "#38bdf8", # Cyan
        "border_color": "#7dd3fc",
        "bg_glow": "rgba(56, 189, 248, 0.2)",
    }
}

# Standard DOS Risk Indicator Tags
INDICATOR_KEYWORDS = [
    ("TERRORISM", ["terroris", "extremis", "militan"]),
    ("CRIME", ["crime", "violent crime", "homicide", "robbery", "theft", "carjacking"]),
    ("CIVIL UNREST", ["civil unrest", "demonstration", "protest", "riot", "strike"]),
    ("KIDNAPPING", ["kidnap", "hostage"]),
    ("ARMED CONFLICT", ["armed conflict", "war", "hostilities", "military action", "shelling", "clashes"]),
    ("DRONE / MISSILE", ["drone", "missile", "airstrike", "rocket"]),
    ("WRONGFUL DETENTION", ["wrongful detention", "arbitrary detention", "unlawful detention"]),
    ("HEALTH / EPIDEMIC", ["health", "medical infrastructure", "disease", "outbreak", "fever", "malaria"]),
    ("NATURAL DISASTER", ["hurricane", "earthquake", "volcano", "cyclone", "flood", "typhoon"]),
    ("PIRACY", ["piracy", "maritime attack"]),
    ("UNEXPLODED ORDNANCE", ["unexploded ordnance", "landmine", "minefield", "ordnance"]),
]

NAME_ALIASES = {
    "mexico travel advisory": "mexico",
    "kingdom of denmark": "denmark",
    "french west indies": "guadeloupe",
    "french saint martin": "saint martin",
    "saba and sint eustatius": "bonaire",
    "republic of congo": "congo",
    "the bahamas": "bahamas",
    "the gambia": "gambia",
    "gaza": "gaza strip",
    "west bank and gaza": "west bank",
    "côte d’ivoire": "cote d'ivoire",
    "côte d'ivoire": "cote d'ivoire",
    "são tomé and príncipe": "sao tome and principe",
    "sao tome & principe": "sao tome and principe",
    "curacao": "curaçao",
    "turkiye": "turkey",
    "burma (myanmar)": "burma",
    "myanmar": "burma",
    "viet nam": "vietnam",
    "democratic republic of the congo": "democratic republic of the congo",
    "republic of the congo": "congo",
    "timor-leste": "east timor",
    "eswatini": "swaziland",
}

def normalize_text(text: str) -> str:
    if not text:
        return ""
    # NFKD decompose and remove diacritics
    nfkd = unicodedata.normalize("NFKD", text)
    cleaned = "".join([c for c in nfkd if not unicodedata.combining(c)])
    cleaned = re.sub(r"[^\w\s-]", "", cleaned).strip().lower()
    return cleaned

def clean_html_summary(html_str: str) -> str:
    if not html_str:
        return ""
    # Strip HTML tags
    cleaned = re.sub(r"<[^>]+>", " ", html_str)
    # Remove excessive whitespace
    cleaned = " ".join(cleaned.split())
    # Unescape common html entities
    cleaned = cleaned.replace("&nbsp;", " ").replace("&amp;", "&").replace("&quot;", '"').replace("&#39;", "'")
    return " ".join(cleaned.split())

def extract_threat_indicators(text: str) -> list:
    tags = []
    text_lower = text.lower()
    for tag_name, keywords in INDICATOR_KEYWORDS:
        if any(kw in text_lower for kw in keywords):
            tags.append(tag_name)
    return tags

def fetch_rss_feed() -> dict:
    print("[*] Ingesting US State Dept RSS Feed (TAsTWs.xml)...")
    req = urllib.request.Request(RSS_URL, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            xml_data = resp.read()
    except Exception as e:
        print(f"[!] Warning: RSS fetch failed: {e}")
        return {}

    import xml.etree.ElementTree as ET
    try:
        root = ET.fromstring(xml_data)
    except Exception as e:
        print(f"[!] Warning: RSS XML parse error: {e}")
        return {}

    rss_items = {}
    for item in root.findall(".//item"):
        title = item.findtext("title", "").strip()
        link = item.findtext("link", "").strip()
        pub_date = item.findtext("pubDate", "").strip()
        desc = item.findtext("description", "").strip()

        # Extract country name from Title: "Country Name - Level X: ..."
        parts = title.split(" - ")
        country_candidate = parts[0].strip()
        level_label = parts[1].strip() if len(parts) > 1 else ""

        norm_name = normalize_text(country_candidate)
        if norm_name in NAME_ALIASES:
            norm_name = normalize_text(NAME_ALIASES[norm_name])

        clean_desc = clean_html_summary(desc)
        indicators = extract_threat_indicators(clean_desc + " " + title)

        rss_items[norm_name] = {
            "title": title,
            "link": link,
            "pub_date": pub_date,
            "summary": clean_desc,
            "indicators": indicators,
            "level_label": level_label
        }

    print(f"[+] Ingested {len(rss_items)} RSS advisories.")
    return rss_items

def fetch_arcgis_features() -> list:
    print("[*] Ingesting US State Dept ArcGIS FeatureServer (Layer 54)...")
    req = urllib.request.Request(ARCGIS_URL, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=25) as resp:
        data = json.loads(resp.read().decode("utf-8"))

    features = data.get("features", [])
    print(f"[+] Ingested {len(features)} ArcGIS features.")
    return features

def load_iso_mapping() -> tuple:
    iso_path = os.path.join(os.path.dirname(__file__), "../data/iso_mapping.json")
    if not os.path.exists(iso_path):
        return {}, {}
    with open(iso_path, "r") as f:
        data = json.load(f)
    num_to_iso3 = {k: v["alpha3"] for k, v in data.items()}
    iso3_to_num = {v["alpha3"]: k for k, v in data.items()}
    return num_to_iso3, iso3_to_num, data

def build_dataset() -> dict:
    num_to_iso3, iso3_to_num, iso_full = load_iso_mapping()
    rss_data = fetch_rss_feed()
    features = fetch_arcgis_features()

    countries = {}
    mexico_states = []
    territories = []

    for f in features:
        attrs = f.get("attributes", {})
        raw_name = (attrs.get("NAME") or "").strip()
        iso3 = (attrs.get("ISO_3") or "").strip().upper()
        raw_level = attrs.get("LEVEL_")
        url = (attrs.get("URL") or "").strip()
        adv_ts = attrs.get("ADVDATE")
        edit_ts = attrs.get("EditDate")
        ad_od_text = attrs.get("AD_OD_Text")

        if not raw_name:
            continue

        # Check if this is a Mexican state entry
        if iso3 == "MEX" and raw_name != "Mexico":
            mexico_states.append({
                "name": raw_name,
                "level": raw_level,
                "level_meta": LEVEL_META.get(raw_level, LEVEL_META[2]),
                "url": url,
                "adv_date": datetime.fromtimestamp(adv_ts / 1000, tz=timezone.utc).strftime("%Y-%m-%d") if adv_ts else None
            })
            continue

        # Base level parsing
        base_level = 1
        has_sub_risk = False
        if raw_level is not None:
            if raw_level in (10, 20, 30):
                base_level = raw_level // 10
                has_sub_risk = True
            elif raw_level in (1, 2, 3, 4):
                base_level = raw_level
        elif iso3 == "MEX":
            # Mexico national level is Level 2 with state-by-state high risk areas
            base_level = 2
            has_sub_risk = True
        elif iso3 in ("USA", "ASM", "GUM", "MNP", "PRI", "VIR"):
            base_level = 0  # Domestic base

        adv_date_str = None
        if adv_ts:
            adv_date_str = datetime.fromtimestamp(adv_ts / 1000, tz=timezone.utc).strftime("%Y-%m-%d")

        edit_date_str = None
        if edit_ts:
            edit_date_str = datetime.fromtimestamp(edit_ts / 1000, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

        # Correlate with RSS data for summary and threat indicators
        norm_name = normalize_text(raw_name)
        rss_match = rss_data.get(norm_name)
        if not rss_match and norm_name in NAME_ALIASES:
            rss_match = rss_data.get(normalize_text(NAME_ALIASES[norm_name]))

        summary = ""
        indicators = []
        rss_link = ""
        if rss_match:
            summary = rss_match["summary"]
            indicators = rss_match["indicators"]
            rss_link = rss_match["link"]

        # If indicators are still empty, infer baseline indicators
        if not indicators:
            if base_level == 4:
                indicators = ["CRITICAL RISK", "ARMED CONFLICT / SEVERE CRIME"]
            elif base_level == 3:
                indicators = ["ELEVATED THREAT", "SECURITY CONCERNS"]
            elif base_level == 2:
                indicators = ["INCREASED CAUTION", "LOCAL SECURITY RISK"]
            elif base_level == 1:
                indicators = ["NORMAL PRECAUTIONS"]
            elif base_level == 0:
                indicators = ["DOMESTIC BASE"]

        # Default fallback summary if RSS didn't have full body
        if not summary:
            if base_level == 4:
                summary = f"Do not travel to {raw_name} due to severe security risks, armed hostilities, high crime, or political instability."
            elif base_level == 3:
                summary = f"Reconsider travel to {raw_name} due to elevated safety threats, civil unrest, or localized security risks."
            elif base_level == 2:
                summary = f"Exercise increased caution when traveling in {raw_name} due to crime, localized demonstrations, or specific security advisories."
            elif base_level == 1:
                summary = f"Exercise normal precautions in {raw_name}. Standard security awareness applies."
            elif base_level == 0:
                summary = "United States Domestic Territory / Home Jurisdiction."

        # Numeric ISO code lookup for world atlas integration
        iso_num = iso3_to_num.get(iso3, "")

        # Target entry
        country_entry = {
            "name": raw_name,
            "iso_3": iso3,
            "iso_num": iso_num,
            "level": base_level,
            "raw_level": raw_level,
            "has_sub_risk": has_sub_risk,
            "level_meta": LEVEL_META.get(base_level, LEVEL_META[1]),
            "summary": summary,
            "indicators": indicators,
            "url": rss_link or url or f"https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories.html",
            "adv_date": adv_date_str,
            "adv_ts": adv_ts,
            "edit_date": edit_date_str,
            "edit_ts": edit_ts,
            "ad_od_text": ad_od_text
        }

        # Index by iso3 if available, else by normalized name
        key = iso3 if (iso3 and iso3 not in ("NONE", "NULL")) else f"X_{norm_name}"
        countries[key] = country_entry

    # Attach Mexico states breakdown
    if "MEX" in countries and mexico_states:
        # Sort states by level descending (Level 4 first)
        mexico_states.sort(key=lambda s: (-(s["level"] or 0), s["name"]))
        countries["MEX"]["sub_regions"] = mexico_states
        l4_states = [s["name"] for s in mexico_states if s["level"] == 4]
        l3_states = [s["name"] for s in mexico_states if s["level"] == 3]
        countries["MEX"]["summary"] = (
            f"Exercise increased caution in Mexico due to crime. "
            f"State-by-State Advisories in effect: {len(l4_states)} States at Level 4 (Do Not Travel): {', '.join(l4_states)}. "
            f"{len(l3_states)} States at Level 3 (Reconsider Travel): {', '.join(l3_states)}."
        )
        countries["MEX"]["indicators"] = ["CRIME", "KIDNAPPING", "CIVIL UNREST"]

    # Ensure USA domestic entry exists
    if "USA" not in countries:
        today_midnight = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        countries["USA"] = {
            "name": "United States",
            "iso_3": "USA",
            "iso_num": "840",
            "level": 0,
            "raw_level": 0,
            "has_sub_risk": False,
            "level_meta": LEVEL_META[0],
            "summary": "United States of America. Domestic Headquarters & Command Post.",
            "indicators": ["DOMESTIC BASE", "COMMAND POST"],
            "url": "https://travel.state.gov",
            "adv_date": today_midnight.strftime("%Y-%m-%d"),
            "adv_ts": int(today_midnight.timestamp() * 1000),
            "edit_date": today_midnight.strftime("%Y-%m-%d 00:00:00 UTC"),
            "edit_ts": int(today_midnight.timestamp() * 1000),
            "ad_od_text": None
        }

    # Add territorial/regional aliases for atlas matching
    atlas_aliases = {
        "PSE": ("Gaza Strip", 4, ["ARMED CONFLICT", "TERRORISM", "CIVIL UNREST"]),
        "ESH": ("Western Sahara", 2, ["CIVIL UNREST", "LANDMINES"]),
        "X_somaliland": ("Somaliland", 4, ["TERRORISM", "KIDNAPPING"]),
        "X_north_cyprus": ("Northern Cyprus", 2, ["BORDER PROTOCOLS"]),
    }

    # Count statistics
    counts = {0: 0, 1: 0, 2: 0, 3: 0, 4: 0}
    for c in countries.values():
        lvl = c.get("level", 1)
        counts[lvl] = counts.get(lvl, 0) + 1

    result = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total_countries": len(countries),
        "counts": counts,
        "countries": countries
    }

    print(f"[+] Built unified advisory dataset: {len(countries)} entities.")
    print(f"    L4 (Critical): {counts[4]} | L3 (Elevated): {counts[3]} | L2 (Caution): {counts[2]} | L1 (Normal): {counts[1]}")
    return result

if __name__ == "__main__":
    data = build_dataset()
    out_path = os.path.join(os.path.dirname(__file__), "../data/test_output.json")
    with open(out_path, "w") as f:
        json.dump(data, f, indent=2)
    print(f"[+] Saved test output to {out_path}")
