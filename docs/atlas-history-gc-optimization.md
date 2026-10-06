> Generated evidence referenced below was deleted during the 6 October 2026 cleanup at the user's request. Filenames identify historical captures, not current verification. See [output storage and reruns](development-artifacts.md).

# Atlas history compaction — 6 October 2026

The 200 MiB fixture exposed repeated full dictionary scans while trying successive
checkpoint cutoffs. Restore preparation also scanned all record payloads when
its references changed. These scans read hundreds of megabytes unrelated to the
requested restore, often several times in one write.

The database now calculates the retention cutoff once from reference counts and
exact record sizes. A native size index supplies key/size metadata without record
payloads. Old event/checkpoint prefixes are deleted by range, and unreachable
records are deleted once. Current state and every retained operation participate
in reachability; shared records are released only after their last reference is
removed. Ledger changes and deletions remain one atomic transaction. Quota errors
still trigger at most one forced cleanup and one retry.

Schema v2 adds `records.bytes` from existing row sizes. The v1 upgrade does not
rewrite snapshots, operation data or the ledger. Existing owners close on version
change. Future schemas remain rejected without downgrade or clearing.

## Same fixture before and after

Actual near-budget native IndexedDB and module Worker, synthetic Chrome/local
adapters, disposable headless Chrome. Payload is 187.85–188.01 MiB; datasets have
100/1,000/10,000 active links. Both runs use the same workload on this machine.
The write/GC measurement includes adding large historical collections until
trimming occurs; it is not the duration of the collector alone.

| Links | Write + GC before | After | Speedup | Restore before → after | Undo before → after |
| --- | ---: | ---: | ---: | ---: | ---: |
| 100 | 12,803ms | 1,628ms | 7.9× | 1,855 → 225ms | 3,516 → 375ms |
| 1,000 | 12,997ms | 1,509ms | 8.6× | 1,541 → 261ms | 3,168 → 453ms |
| 10,000 | 14,498ms | 2,299ms | 6.3× | 3,163 → 1,973ms | 5,517 → 3,718ms |

Before: benchmark (`atlas-history-200mb-performance.json`, deleted capture).
After: benchmark (`atlas-history-gc-performance.json`, deleted capture).
Trimmed payload is identical: 156.98/157.15/159.41 MiB. Restore/Undo commit current
collections twice; protected return data and exact ledger audit pass. Warm useful
preview p95 is 72.2/109.8/390.3ms; after Worker restart 125.7/200.5/670.7ms.
The 200 MiB budget remains accounted payload, not guaranteed physical disk usage.

## Verification

- Native IDB 25/25 (`atlas-history-gc-native.json`, deleted capture): v1 upgrade retains every row's
  ledger, both historical states and protected Undo; shared-version compaction
  reconstructs every retained moment; no dictionary payload cursor scan during
  compaction or restore protection. Existing quota rollback, one-retry bound,
  stale-cache, corruption, preparation and replay checks pass.
- Active migration/restore 6/6 (`atlas-history-gc-active.json`, deleted capture).
- Node verification 335/335 (`atlas-history-gc-verification.txt`, deleted capture).
- Current general UI 32/32 at desktop and narrow sizes, automatic startup 4/4.
- Future-schema, corrupt-storage and stopped-quota UI each 2/2, including explicit
  Clear/Cancel, resume and future sentinel preservation.

Not verified: installed MV3 service-worker lifecycle/profile quota, large v1
upgrade timing, cross-device speed, real browser restart. The v1 preservation
test is a small valid fixture; the 200 MiB benchmark uses the new schema. No new
dependencies, extension permissions, version, commit, push or release changes.
