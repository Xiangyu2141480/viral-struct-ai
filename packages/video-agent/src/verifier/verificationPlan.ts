export interface VerificationPlan {
  id: string;
  checks: Array<{
    id: string;
    description: string;
    required: boolean;
  }>;
}
