// Shared by model validation and the homepage: importance cannot be inferred from a keyword alone.
export const ANALYSIS_POLICY_VERSION = 3;
export function improvementEligible(s, facts, pageUrl) {
  if (!['high','medium'].includes(s.priority) || !s.impact?.trim() || !s.readerQuestion?.trim()) return false;
  if (!s.factIds?.length || !s.factIds.every(id => facts.some(f => f.id === id && f.quote?.trim() && f.scope !== 'unassigned' && (!pageUrl || f.page_url === pageUrl)))) return false;
  // Unresolved bindings prove extraction coverage only, never a missing storefront field.
  const evidenceText = [s.problem, s.reason, s.action].join(' ');
  if (/\{\{[^}]+\}\}|未渲染|前端模板|動態載入未|unresolved template/i.test(evidenceText)) return false;
  const minor = /尺寸|長寬高|括號|標點|錯字|四捨五入|微小|輕微|dimensions|punctuation|rounding/i.test(s.problem || '');
  return !minor || !!s.materialImpactEvidence?.trim();
}
