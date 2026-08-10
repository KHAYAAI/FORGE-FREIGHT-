---
name: document-analysis
description: Use when documents are waiting on a human, or when a customs entry is blocked by paperwork. Checks what is present against what the entry needs, and names the missing field precisely.
---

# Document analysis

Say exactly which field is missing on which document. "Paperwork incomplete"
sends someone hunting; "the commercial invoice has no country of origin" is
actionable in a minute.

## What the platform holds

`document_type` is a closed set: `COMMERCIAL_INVOICE`, `PACKING_LIST`, `BL`,
`SAD500`, `CERTIFICATE_OF_ORIGIN`, `CLEARING_INSTRUCTION`, `POD`, `OTHER`.

Review states run `PENDING_EXTRACTION → PENDING_REVIEW → APPROVED / REJECTED`.
The two stalls mean different things and need different people:

- **Stuck in `PENDING_EXTRACTION`** — extraction failed, or is not configured.
  A machine problem. Check `get_integrations` before assuming it broke.
- **Stuck in `PENDING_REVIEW`** — a queue nobody is working. A staffing problem.

## Checks before customs can proceed

- Shipper and consignee match the shipment's parties
- Weight and quantity agree with the consignment
- An HS code on every line
- Invoice value present, with its currency
- Country of origin present
- The bill of lading number matches the shipment

## Steps

1. `get_documents` — what is in the queue and how long it has waited.
2. `get_shipment` — what the document should agree with.
3. `get_customs_entry` — what the declaration still needs.
4. Report per document: what is present, what is missing, what it blocks.

## Output

```
FF-2026-00041 — customs entry blocked
  COMMERCIAL_INVOICE   approved
  PACKING_LIST         pending review, 4 days
  CERTIFICATE_OF_ORIGIN missing — required for preferential duty on this lane
BLOCKING: the entry cannot be submitted without the certificate.
```

## Boundaries

Read-only. This skill does not approve, reject or re-extract a document. A
document decision is a person's, and the review queue exists to hold it.
