// The coordinator registers verified replies privately. Compare the full reviewed row so an edit invalidates a pass.
export function evaluationPassed(ledger, row) {
  if (!ledger?.evaluationGate) return true;
  if (!row?.artifactDigest || !row.id) return false;
  const receipts = (ledger.evaluationReceipts || []).filter(r => r.reviewId === row.id && r.artifactDigest === row.artifactDigest);
  const receipt = receipts.at(-1);
  return Boolean(receipt?.verdict === 'PASS' && receipt.messageId && receipt.expected && receipt.observed &&
    receipt.evidenceUrl && receipt.evaluatorPath === ledger.evaluationGate.path &&
    JSON.stringify(receipt.review) === JSON.stringify(row));
}
