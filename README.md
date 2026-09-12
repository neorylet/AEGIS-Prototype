# AEGIS-Prototype

## The prototype that proved the stack

> ⚠️ **This repository is a prototype.**
>
> It is **not** the production AEGIS system. It is a working proof of the
> Rust + Tauri + SQLite stack and the endpoint telemetry pipeline.
>
> The real AEGIS — designed from a written specification, with a proper
> detection engine, alert lifecycle, and multi-agent architecture — will
> live in a separate repository.
>
> **Journey:** Icaros (packet capture) → **AEGIS-Prototype** (this repo) → AEGIS (planned).

---

## What Is This?

AEGIS-Prototype is a desktop endpoint security monitoring tool built with:
- **Backend:** Rust + Tauri v1
- **Frontend:** React + TypeScript + Tailwind CSS
- **Storage:** SQLite (local)

It collects process and network telemetry from a Windows machine, builds
statistical baselines of "normal" behavior, and flags deviations as
anomalies — all inside a dark/light themed desktop application.

It was built iteratively over several weeks to validate the concept
before committing to a full product design.

---

## What Works

### Telemetry Collection
- **`poll_processes()`** – collects running processes every 5 seconds via `sysinfo`
- **`poll_connections()`** – collects TCP/UDP connections every 5 seconds via `netstat -an`
- **Deduplication** – HashSet-based tracking prevents unbounded database growth
- **Real-time streaming** – new events push to the UI via Tauri `emit_all`

### Baseline Engine
- **Welford's online algorithm** for streaming mean/stddev computation
- **8 features per asset:** event_count, connection_rate, unique_destinations, unique_ports, process_cpu_avg, process_cpu_max, process_mem_avg, process_mem_max
- **Baseline persistence** to SQLite – survives restarts
- **z-score + IQR hybrid scoring** with severity bucketing (Low / Medium / High / Critical)
- **Confidence scoring** based on sample count

### Alert Management
- **Anomaly persistence** to SQLite
- **Alert lifecycle:** Open → Acknowledged → Resolved
- **Cooldown logic** to reduce duplicate alerts
- **Bulk acknowledge/resolve** actions

### Frontend
- **Dashboard** with KPIs, 24-hour telemetry chart, and live event table
- **Alerts page** with severity filters, expandable rows, and deviation details
- **Dark / light theme** with CSS variables
- **Real-time updates** via Tauri event listener

---

## What Doesn't Work (And Why We Paused)

Iterative development surfaced **fundamental design gaps** that cannot be
solved by patching. Development is paused to plan the real system.

### Known Issues in This Prototype

| Area | Issue |
| :--- | :--- |
| **Baseline math** | σ=0 edge case produces fake z-scores (division-by-zero clamp) |
| **Detection philosophy** | No coherent threat model – features were chosen ad-hoc |
| **Alert volume** | No signal-to-noise strategy – hundreds of false positives at scale |
| **Alert lifecycle** | Deduplication is inconsistent; no FP feedback loop; no severity decay |
| **Multi-agent** | Undefined protocol, no trust model, no offline caching design |
| **Frontend** | Symptoms of a confused data model (no grouping, no sorting, 50-item limit) |

### The Real Problem

AEGIS-Prototype proved that **the stack works**. It did not prove that the
**design works**. Those are different problems. The second one requires a
specification, not iteration.

---

## Why the Pause

This is not a failure. It's a deliberate engineering decision.

Real security tools are not built by patching – they're built from a
specification. The prototype proved what needed to be proved:

- Rust + Tauri + SQLite can power an endpoint security tool
- A React + Tailwind frontend can render telemetry cleanly
- Welford online statistics work for lightweight baselines
- Real-time streaming from Rust to React is viable

What it did not prove – and what the next system will address:

- What AEGIS actually detects (threat model)
- How alerts flow from anomaly → alert → incident
- How multiple agents report to a central console
- How the system behaves at scale
- How false positives are minimized
- How the analyst actually triages alerts

---

## The Road Ahead

The next repository (`AEGIS`) will be built from a written spec, in phases:

1. **Week 1 – Planning.** Scope, architecture, detection spec, alert lifecycle, paper wireframes.
2. **Phase 0 – Foundation.** Console + agent skeleton, no detection yet.
3. **Phase 1 – Telemetry.** Multi-agent collection with a central console.
4. **Phase 2 – Detection.** Designed detection engine, tested against real threats.
5. **Phase 3 – Response.** Alert lifecycle, incident grouping, triage workflow.

**The first commit of the new AEGIS repo will be a specification, not code.**

---

## Historical Context

This project has gone through multiple iterations:

| Iteration | What It Was | What It Taught |
| :--- | :--- | :--- |
| **Icaros** | Packet capture experiments | Flow-based thinking; WebSocket memory limits; frontend shouldn't process raw telemetry |
| **AEGIS-Prototype** (this repo) | Endpoint telemetry + baseline engine | The stack works; the design must come first |
| **AEGIS** (planned) | Spec-driven endpoint security monitoring | TBD – this is the real product |

Each iteration teaches. Each pause sharpens the goal.

---

## Repository Status

- **Status:** Frozen as reference implementation
- **Purpose:** Historical record of the prototype phase
- **Next repo:** `github.com/neorylet/AEGIS` (will be created after the planning week)
- **Licensing:** See `LICENSE`

---

## Documentation

The `docs/` directory contains design notes, architecture decisions, and
research from the prototype phase. It is preserved for reference.

Key documents:
- `docs/AEGIS_CANONICAL_SPECIFICATION.md` – the original (prototype-scope) spec
- `docs/IMPLEMENTATION_STATUS.md` – what was actually implemented
- `docs/AUDIT_REPORT.md` – the prototype audit

**Note:** These documents describe the prototype's ambitions, not the
final AEGIS design. The real spec will be written from scratch in the
next repository.

---

## Contributing

This repository is **not accepting contributions**. It is archived in
spirit and preserved for reference.

If you're interested in the real AEGIS project, watch the future repo.

---

## A Note on Honesty

This README does not claim AEGIS-Prototype is a finished product. It
is not. It is a working prototype that validated a stack and taught
its builder a hard lesson: **you cannot patch your way to good
detection. You have to design it.**

The next system will be built differently. That's the point.
