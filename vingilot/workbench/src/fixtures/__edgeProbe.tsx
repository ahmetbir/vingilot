// Deliberately violates ADR-001 exit criterion 2. Never imported by real code.
// Its only job is to make the import-edge guard fail, so we know it can.
import "@/app/App";

export const probe = true;
