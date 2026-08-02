// Deliberately violates the import guard. Never imported by real code.
// Its only job is to make the import-edge guard fail, so we know it can —
// now via a relative escape, since the `@/` alias died with the spike.
import "../../../../desktop/src/shared/lib/cn";

export const probe = true;
