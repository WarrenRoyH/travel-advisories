#!/usr/bin/env python3
"""
daily_sync.py
Autonomous Daily Advisory Synchronization & Delta Engine.
Detects status changes from the previous day, maintains persistent audit history,
and compiles production JSON datasets for the tactical web interface.
"""

import json
import os
import sys
import uuid
from datetime import datetime, timezone, timedelta

# Import ingestion logic
sys.path.insert(0, os.path.dirname(__file__))
from fetch_advisories import build_dataset, LEVEL_META

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DATA_DIR = os.path.join(BASE_DIR, "data")
SNAPSHOTS_DIR = os.path.join(DATA_DIR, "snapshots")
PUBLIC_DATA_DIR = os.path.join(BASE_DIR, "public", "data")
HISTORY_FILE = os.path.join(DATA_DIR, "changes_history.json")
LATEST_FILE = os.path.join(DATA_DIR, "latest.json")

os.makedirs(SNAPSHOTS_DIR, exist_ok=True)
os.makedirs(PUBLIC_DATA_DIR, exist_ok=True)

def load_previous_snapshot() -> dict:
    if os.path.exists(LATEST_FILE):
        try:
            with open(LATEST_FILE, "r") as f:
                return json.load(f)
        except Exception as e:
            print(f"[!] Warning reading latest.json: {e}")
    return {}

def load_history() -> list:
    if os.path.exists(HISTORY_FILE):
        try:
            with open(HISTORY_FILE, "r") as f:
                return json.load(f)
        except Exception as e:
            print(f"[!] Warning reading changes_history.json: {e}")
    return []

def save_history(history: list):
    with open(HISTORY_FILE, "w") as f:
        json.dump(history, f, indent=2)

def detect_deltas(current_data: dict, previous_data: dict) -> list:
    new_deltas = []
    now_utc = datetime.now(timezone.utc)
    now_str = now_utc.isoformat()
    today_date = now_utc.strftime("%Y-%m-%d")

    current_countries = current_data.get("countries", {})
    prev_countries = previous_data.get("countries", {})

    for key, curr in current_countries.items():
        name = curr["name"]
        iso_3 = curr.get("iso_3", key)
        curr_lvl = curr["level"]
        curr_sub_risk = curr.get("has_sub_risk", False)
        adv_date = curr.get("adv_date")

        if key in prev_countries:
            prev = prev_countries[key]
            prev_lvl = prev["level"]
            prev_sub_risk = prev.get("has_sub_risk", False)

            # Check for level shift
            if curr_lvl != prev_lvl:
                if curr_lvl > prev_lvl:
                    change_type = "ESCALATION"
                    urgency = "CRITICAL" if curr_lvl == 4 else "HIGH"
                    headline = f"THREAT ESCALATION: {name.upper()} RAISED FROM {LEVEL_META[prev_lvl]['code']} TO {LEVEL_META[curr_lvl]['code']}"
                else:
                    change_type = "DE-ESCALATION"
                    urgency = "MEDIUM"
                    headline = f"THREAT DE-ESCALATION: {name.upper()} LOWERED FROM {LEVEL_META[prev_lvl]['code']} TO {LEVEL_META[curr_lvl]['code']}"

                new_deltas.append({
                    "id": str(uuid.uuid4())[:8],
                    "timestamp": now_str,
                    "date": today_date,
                    "iso_3": iso_3,
                    "country": name,
                    "type": change_type,
                    "urgency": urgency,
                    "old_level": prev_lvl,
                    "new_level": curr_lvl,
                    "headline": headline,
                    "summary": curr.get("summary", ""),
                    "indicators": curr.get("indicators", []),
                    "adv_date": adv_date,
                    "url": curr.get("url")
                })

            # Check for regional risk warning update
            elif curr_sub_risk != prev_sub_risk:
                sub_status = "ADDED" if curr_sub_risk else "REMOVED"
                headline = f"SECURITY BOUNDARY SHIFT: {name.upper()} HIGH-RISK REGIONAL AREAS {sub_status}"
                new_deltas.append({
                    "id": str(uuid.uuid4())[:8],
                    "timestamp": now_str,
                    "date": today_date,
                    "iso_3": iso_3,
                    "country": name,
                    "type": "REGIONAL_RISK_SHIFT",
                    "urgency": "MEDIUM",
                    "old_level": prev_lvl,
                    "new_level": curr_lvl,
                    "headline": headline,
                    "summary": curr.get("summary", ""),
                    "indicators": curr.get("indicators", []),
                    "adv_date": adv_date,
                    "url": curr.get("url")
                })

            # Check for advisory revision date change
            elif curr.get("adv_ts") and prev.get("adv_ts") and curr.get("adv_ts") != prev.get("adv_ts"):
                headline = f"ADVISORY BULLETIN REVISED: {name.upper()} UPDATED [{adv_date}]"
                new_deltas.append({
                    "id": str(uuid.uuid4())[:8],
                    "timestamp": now_str,
                    "date": today_date,
                    "iso_3": iso_3,
                    "country": name,
                    "type": "BULLETIN_REVISION",
                    "urgency": "INFO",
                    "old_level": prev_lvl,
                    "new_level": curr_lvl,
                    "headline": headline,
                    "summary": curr.get("summary", ""),
                    "indicators": curr.get("indicators", []),
                    "adv_date": adv_date,
                    "url": curr.get("url")
                })

    return new_deltas

def seed_initial_history(current_data: dict) -> list:
    """
    On initial bootstrap, populate history using official State Dept publication timestamps
    so recent real-world shifts are represented immediately.
    """
    print("[*] Generating baseline history from recent State Dept publication dates...")
    history = []
    countries = current_data.get("countries", {})

    sorted_by_date = []
    for key, c in countries.items():
        if c.get("adv_ts") and c.get("level") in (1, 2, 3, 4):
            sorted_by_date.append(c)

    sorted_by_date.sort(key=lambda x: x["adv_ts"], reverse=True)

    # Take the 25 most recent advisories published
    for c in sorted_by_date[:25]:
        lvl = c["level"]
        adv_date = c.get("adv_date")
        iso_3 = c.get("iso_3", "")
        name = c["name"]
        indicators = c.get("indicators", [])

        if lvl == 4:
            change_type = "CRITICAL_ADVISORY"
            urgency = "CRITICAL"
            headline = f"CRITICAL BULLETIN: {name.upper()} RETAINS LEVEL 4 [DO NOT TRAVEL]"
        elif lvl == 3:
            change_type = "ELEVATED_ADVISORY"
            urgency = "HIGH"
            headline = f"ELEVATED THREAT: {name.upper()} CLASSIFIED LEVEL 3 [RECONSIDER TRAVEL]"
        elif lvl == 2:
            change_type = "CAUTION_ADVISORY"
            urgency = "MEDIUM"
            headline = f"CAUTION DIRECTIVE: {name.upper()} CLASSIFIED LEVEL 2 [INCREASED CAUTION]"
        else:
            change_type = "STANDARD_ADVISORY"
            urgency = "LOW"
            headline = f"STANDARD ADVISORY: {name.upper()} CONFIRMED LEVEL 1 [NORMAL PRECAUTIONS]"

        history.append({
            "id": str(uuid.uuid4())[:8],
            "timestamp": f"{adv_date}T12:00:00Z",
            "date": adv_date,
            "iso_3": iso_3,
            "country": name,
            "type": change_type,
            "urgency": urgency,
            "old_level": lvl,
            "new_level": lvl,
            "headline": headline,
            "summary": c.get("summary", ""),
            "indicators": indicators,
            "adv_date": adv_date,
            "url": c.get("url")
        })

    return history

def run_sync():
    print("=" * 60)
    print(f"[*] Starting Daily Advisory Sync: {datetime.now(timezone.utc).isoformat()}")
    print("=" * 60)

    # 1. Fetch live data
    current_data = build_dataset()
    previous_data = load_previous_snapshot()
    history = load_history()

    # 2. Compute deltas
    today_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    is_initial_run = (len(previous_data) == 0 or len(history) == 0)

    if is_initial_run:
        history = seed_initial_history(current_data)
        new_deltas = []
        print(f"[+] Bootstrap complete. Seeded {len(history)} recent advisory events.")
    else:
        new_deltas = detect_deltas(current_data, previous_data)
        print(f"[+] Detected {len(new_deltas)} status changes since previous snapshot.")
        if new_deltas:
            for d in new_deltas:
                print(f"    - {d['headline']}")
                # Prepend to history
                history.insert(0, d)

    # Save running history
    save_history(history)

    # 3. Categorize changes for the web client
    now_utc = datetime.now(timezone.utc)
    cutoff_24h = now_utc - timedelta(hours=24)
    cutoff_30d = now_utc - timedelta(days=30)

    def parse_item_date(item):
        try:
            return datetime.fromisoformat(item["timestamp"].replace("Z", "+00:00"))
        except:
            return now_utc

    # Sort history descending
    history.sort(key=parse_item_date, reverse=True)

    changes_24h = [h for h in history if parse_item_date(h) >= cutoff_24h]
    recent_changes = history[:20]

    # Map delta indicators directly onto countries in the dataset
    delta_country_isos_24h = {h["iso_3"] for h in changes_24h if h.get("iso_3")}
    recent_country_isos = {h["iso_3"] for h in recent_changes if h.get("iso_3")}

    for key, c in current_data["countries"].items():
        iso = c.get("iso_3")
        c["has_24h_delta"] = (iso in delta_country_isos_24h)
        c["has_recent_delta"] = (iso in recent_country_isos)
        matching = [h for h in history if h.get("iso_3") == iso]
        c["latest_delta"] = matching[0] if matching else None

    # 4. Save snapshots & production artifacts
    # Save today's snapshot
    snapshot_file = os.path.join(SNAPSHOTS_DIR, f"{today_date}.json")
    with open(snapshot_file, "w") as f:
        json.dump(current_data, f, indent=2)

    # Save latest baseline
    with open(LATEST_FILE, "w") as f:
        json.dump(current_data, f, indent=2)

    # Save public advisories
    pub_advisories = os.path.join(PUBLIC_DATA_DIR, "advisories.json")
    with open(pub_advisories, "w") as f:
        json.dump(current_data, f)
    print(f"[+] Saved public advisories: {pub_advisories}")

    # Save public changes
    pub_changes = os.path.join(PUBLIC_DATA_DIR, "changes.json")
    changes_payload = {
        "generated_at": now_utc.isoformat(),
        "today_changes_count": len(changes_24h),
        "changes_24h": changes_24h,
        "recent_changes": recent_changes,
        "all_history": history[:50],
        "delta_countries_24h": list(delta_country_isos_24h),
        "recent_countries": list(recent_country_isos)
    }
    with open(pub_changes, "w") as f:
        json.dump(changes_payload, f)
    print(f"[+] Saved public changes: {pub_changes}")

    # Save public summary
    pub_summary = os.path.join(PUBLIC_DATA_DIR, "summary.json")
    summary_payload = {
        "generated_at": now_utc.isoformat(),
        "total_countries": current_data["total_countries"],
        "counts": current_data["counts"],
        "critical_count": current_data["counts"].get(4, 0),
        "elevated_count": current_data["counts"].get(3, 0),
        "caution_count": current_data["counts"].get(2, 0),
        "normal_count": current_data["counts"].get(1, 0),
        "domestic_count": current_data["counts"].get(0, 0),
        "recent_24h_deltas": len(changes_24h),
        "recent_30d_deltas": len(recent_changes),
        "delta_countries_24h": list(delta_country_isos_24h),
        "status": "OPERATIONAL"
    }
    with open(pub_summary, "w") as f:
        json.dump(summary_payload, f)
    print(f"[+] Saved public summary: {pub_summary}")

    print("=" * 60)
    print("[+] Sync successfully completed.")
    print("=" * 60)
    return summary_payload

if __name__ == "__main__":
    run_sync()
