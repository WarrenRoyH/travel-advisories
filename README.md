# Global Travel Advisories // Tactical SITREP Monitor

**Live Production URL:** [https://travel-advisories.hyltons.us](https://travel-advisories.hyltons.us)

A military-minimalist, high-density tactical world monitor displaying current **U.S. Department of State Travel Advisory Levels** across all recognized global jurisdictions. Built with automated daily delta synchronization to audit, record, and highlight any threat level shifts from the day before.

---

## Technical Architecture & Threat Taxonomy

### 1. Data Ingestion Pipeline
The telemetry engine correlates two authoritative U.S. Department of State data surfaces:
- **ArcGIS Enterprise FeatureServer (Layer 54):** Live machine-readable polygon and attribute feed containing exact threat levels (1–4), ISO-3 codes, consular URLs, revision timestamps (`EditDate`), and sub-national status layers (e.g. Mexico's 32 individual state advisories).
- **Consular Affairs Advisory Feed (`TAsTWs.xml`):** Executive consular briefings, date advisories, and risk factor disclosures.
- **Threat Indicator Extraction:** Automatic extraction of standard State Department risk flags:
  - `[TERRORISM]`, `[ARMED CONFLICT]`, `[CIVIL UNREST]`, `[CRIME]`, `[KIDNAPPING]`, `[DRONE / MISSILE]`, `[WRONGFUL DETENTION]`, `[HEALTH / EPIDEMIC]`, `[NATURAL DISASTER]`, `[UNEXPLODED ORDNANCE]`.

### 2. Threat Level Classification Schema
| Level | DOS Designation | Tactical Classification | Hex Color | Visual Indicator |
| :---: | :--- | :--- | :---: | :--- |
| **L4** | **Do Not Travel** | Critical Threat // DEFCON 1–2 | `#ef4444` | High-vis crimson, glowing perimeter |
| **L3** | **Reconsider Travel** | Elevated Threat // DEFCON 3 | `#f97316` | Tactical amber-orange |
| **L2** | **Exercise Increased Caution** | Caution // DEFCON 4 | `#eab308` | Tactical yellow |
| **L1** | **Exercise Normal Precautions** | Normal Precautions // DEFCON 5 | `#10b981` | Phosphor emerald green |
| **L0** | **US Domestic Jurisdiction** | Command Post // Secure Base | `#38bdf8` | Cyan boundary |

---

## 24-Hour Delta Engine & Daily Sync

### Daily Shift Tracking
The site maintains persistent audit snapshots in `data/snapshots/YYYY-MM-DD.json` and a baseline state in `data/latest.json`.
When `scripts/daily_sync.py` runs:
1. It compares the current advisory matrix against the previous snapshot.
2. Identifies:
   - **Escalations** (e.g., Level 2 $\rightarrow$ Level 3, or Level 3 $\rightarrow$ Level 4).
   - **De-escalations** (e.g., Level 4 $\rightarrow$ Level 3).
   - **Regional Warning Shifts** (added/removed localized high-risk zones).
   - **Bulletin Revisions** (updated consular warning text or dates).
3. Appends detected events to `data/changes_history.json`.
4. Outputs `public/data/changes.json` and flags `has_24h_delta` on active countries.
5. In the UI:
   - Countries with 24-hour deltas receive pulsating radar blips and alert badges.
   - The **24H SITREP / DELTAS** drawer presents a comprehensive change briefing.
   - When no deltas occurred in the last 24h, the system displays `STATUS STEADY: 0 Deltas in 24h` and presents chronological recent shifts (e.g., Cambodia, Italy, North Macedonia, UK, Suriname).

### Automated Schedule
Configured in user `crontab` to execute daily at **06:00 UTC (01:00 AM CST)**:
```cron
0 6 * * * /home/warren/agy-projects/travel-advisories/scripts/deploy.sh >> /home/warren/agy-projects/travel-advisories/logs/daily_sync.log 2>&1
```

---

## Tactical Interface Features

- **Vector World Atlas:** Rendered with D3.js and TopoJSON 50m resolution.
- **Cursor Telemetry:** Real-time latitude/longitude reticle tracking in the HUD header.
- **Filter Matrix:** Quick filtering by `[ALL SECTORS]`, `[L4 CRITICAL]`, `[L3 ELEVATED]`, `[L2 CAUTION]`, `[L1 NORMAL]`, and `[RECENT SHIFTS]`.
- **Target Intel Dossier:** Click any nation to slide open a detailed profile containing risk tags, consular summary, sub-region breakdowns (e.g., Mexican states), and links to travel.state.gov.
- **Tactical Search:** Instant autocomplete search by country name or ISO-3 code with automatic pan and zoom.

---

## Deployment & Manual Run

### Manual Sync & Deploy
```bash
cd /home/warren/agy-projects/travel-advisories
./scripts/deploy.sh
```

### Local Development Server
```bash
npm run test-server
# Browse to http://localhost:8787
```
