# Scripts & API entrypoints

CLI scripts under `src/scripts/` and REST handlers under `src/pages/api/` should stay **thin**.

## Conventions

- Scripts: arg parsing, checkpoints, `process.exit` — call shared/domain functions for real work
- API routes: `withApiAuth` + call the same functions scripts use (avoid duplicating portal logic)
- Portal login / act mapping / Excel parsers: prefer `src/shared/`
- Blitz RPC: domain folders (`src/challan`, `src/conso`, `src/form16`, `src/justification`, …)

## Preferred imports

```ts
import { loginIncomeTaxPortal } from "src/shared/portals/incomeTax"
import { loginWithTracesApiAndPreauth } from "src/shared/portals/traces"
import { incomeTaxActForFinancialYear } from "src/shared/portals/act"
import { createBatchFromCompanies } from "src/shared/jobs"
```
