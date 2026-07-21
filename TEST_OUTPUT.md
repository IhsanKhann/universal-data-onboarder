▶ Guardrail — row ceiling
  ✔ accepts a file within the row limit (603.1105ms)
[onboarder] [importGuardrail.service] guardrail rejected import {"tenantId":"test-tenant","limit":5,"storageMode":"shared","sourceFormat":"csv"}
[onboarder] [importGuardrail.service] guardrail rejected upload on size {"tenantId":"test-tenant","sizeBytes":99999,"limitBytes":1024,"storageMode":"shared"}
  ✔ rejects a file at exactly limit+1 rows (268.9999ms)
✔ Guardrail — row ceiling (878.0349ms)
▶ Guardrail — byte ceiling
  ✔ rejects a size over the ceiling (2.4462ms)
✔ Guardrail — byte ceiling (3.2243ms)
▶ Commit idempotency
  ✔ commits rows on first pass (5189.7735ms)
  ✔ produces zero duplicates on re-run (1.7292ms)
✔ Commit idempotency (5266.8281ms)
▶ Resume after crash
  ✔ commits only pending rows after crash (0.9093ms)
  ✔ re-running produces no additional entities (0.7285ms)
✔ Resume after crash (3.8203ms)
▶ Dual topology
  ✔ commitBatch works with in-memory store (1.0402ms)
  ✔ resolver mock works (105.3282ms)
✔ Dual topology (107.872ms)
ℹ tests 9
ℹ suites 5
ℹ pass 9
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 6425.6604
