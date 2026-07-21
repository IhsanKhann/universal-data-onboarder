---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: "Universal Data Onboarding Engine"
  text: "Streaming-safe, adapter-driven data import pipeline"
  tagline: Extract, map, validate, and commit CSV / JSON / XLSX / SQL data to any target — with idempotent replay, guardrails, and swappable adapters.
  actions:
    - theme: brand
      text: Quickstart
      link: /quickstart
    - theme: alt
      text: Architecture
      link: /architecture
    - theme: alt
      text: GitHub
      link: https://github.com/IhsanKhann/universal-data-onboarder

features:
  - title: Streaming Parsers
    details: CSV, XLSX, JSON, SQL dump — parsed in streaming mode with zero full-file buffering. Memory scales with row width, not file size.
    icon: 📂
  - title: Idempotent Commit
    details: Natural-key dedup + status-gated resumability. Crash mid-commit? Re-run — already-committed rows are skipped, pending rows resume.
    icon: 🔒
  - title: Adapter Architecture
    details: Job store, queue, storage, and connection resolver are all injected interfaces. Swapping Mongoose → SQLite or BullMQ → SQS is an env var change.
    icon: 🔌
  - title: Target Descriptors
    details: Every entity type (employee, invoice, product) is a plain-object descriptor with a <code>commitRow</code> function. The engine has zero domain knowledge.
    icon: 📋
  - title: Guardrails
    details: Row-count and byte-size ceilings enforced before parsing. Tier-aware policy lets shared tenants have tighter limits than dedicated ones.
    icon: 🛡️
  - title: Multi-Job Sessions
    details: Topologically-sorted execution order with cross-job external-ID resolution. Chain employee → payroll → leave imports in one session.
    icon: 🧩
---
