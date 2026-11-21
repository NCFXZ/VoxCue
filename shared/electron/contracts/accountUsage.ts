import type { AccountService } from './auth';

export interface AccountQuota {
  id: string;
  label: string;
  unit: 'ai_credits' | 'requests' | 'tokens' | 'percent' | 'unknown';
  total: number | null;
  used: number | null;
  remaining: number | null;
  remainingPercent: number | null;
  unlimited: boolean;
  state: 'available' | 'exhausted' | 'restricted' | 'unknown' | 'unavailable';
  additionalUsageAllowed: boolean | null;
  advisory: boolean;
  resetAt: number | null;
  resetEstimated: boolean;
}
export interface AccountUsage {
  provider: AccountService;
  status: 'available' | 'unavailable';
  plan:
    | 'free'
    | 'go'
    | 'plus'
    | 'edu'
    | 'pro'
    | 'pro_plus'
    | 'max'
    | 'business'
    | 'enterprise'
    | 'unknown';
  quotas: AccountQuota[];
  queriedAt: number;
}
