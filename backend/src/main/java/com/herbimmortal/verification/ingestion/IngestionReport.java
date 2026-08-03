package com.herbimmortal.verification.ingestion;

import java.time.Duration;
import java.util.Map;

/**
 * The end of run summary. Returned as well as logged, so a future admin
 * endpoint or a test can assert on it rather than parsing log output.
 *
 * The reconciliation that must always hold:
 *     rowsRead == inserted + unchanged + rejected
 * If it does not, a row went missing and that is a bug, not a data problem.
 */
public record IngestionReport(
        String sourceBatch,
        long rowsRead,
        long inserted,
        long unchanged,
        long rejected,
        long supersededFromEarlierBatches,
        Map<RejectReason, Long> rejectsByReason,
        Duration elapsed
) {

    public boolean reconciles() {
        return rowsRead == inserted + unchanged + rejected;
    }

    public String toLogLines() {
        StringBuilder sb = new StringBuilder("""
                
                ============================================================
                 Registry ingestion complete
                ============================================================
                """);
        sb.append("  batch          : ").append(sourceBatch).append('\n');
        sb.append("  rows read      : ").append(rowsRead).append('\n');
        sb.append("  inserted       : ").append(inserted).append('\n');
        sb.append("  unchanged      : ").append(unchanged).append('\n');
        sb.append("  rejected       : ").append(rejected).append('\n');
        sb.append("  superseded     : ").append(supersededFromEarlierBatches)
                .append("  (rows from earlier batches no longer matchable)\n");
        sb.append("  elapsed        : ").append(elapsed.toMillis()).append(" ms\n");
        if (!rejectsByReason.isEmpty()) {
            sb.append("  rejects by reason:\n");
            rejectsByReason.forEach((reason, count) ->
                    sb.append("      ").append(String.format("%-24s", reason)).append(count).append('\n'));
        }
        sb.append("  reconciles     : ").append(reconciles() ? "yes" : "NO, THIS IS A BUG").append('\n');
        sb.append("============================================================");
        return sb.toString();
    }
}
