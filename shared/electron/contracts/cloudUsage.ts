export interface CloudEntitlements {
  permanent: boolean;
  remainingSeconds: number | null;
  zeroSince: number | null;
  cloudDeleteAfter: number | null;
  cloudPurgePending: boolean;
}
export function isLowInterviewCredit(value?: CloudEntitlements) {
  return (
    !!value && !value.permanent && value.remainingSeconds !== null && value.remainingSeconds < 900
  );
}
export interface InterviewUsageState {
  state: 'active' | 'expired';
  permanent: boolean;
  remainingSeconds: number | null;
  reason?: 'exhausted' | 'connection';
}
export function hasInterviewUsageNotice(usage?: InterviewUsageState | null) {
  return (
    !!usage && (usage.state === 'expired' || (!usage.permanent && usage.remainingSeconds! <= 300))
  );
}
export type CloudUsageCall = { action: 'status' } | { action: 'redeem'; code: string };
export type CloudUsageResult =
  { ok: true; entitlements: CloudEntitlements } | { ok: false; error: string };
