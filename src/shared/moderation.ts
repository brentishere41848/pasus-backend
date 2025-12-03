export type ModerationStage =
  | 'NONE'
  | 'WARNING_1'
  | 'WARNING_2'
  | 'WARNING_3'
  | 'WARNING_4'
  | 'TERMINATED';

export const MODERATION_STAGES: ModerationStage[] = [
  'NONE',
  'WARNING_1',
  'WARNING_2',
  'WARNING_3',
  'WARNING_4',
  'TERMINATED',
];

export type ModerationReason = {
  code: string;
  label: string;
  description: string;
};

export const MODERATION_REASONS: ModerationReason[] = [
  { code: 'SPAM', label: 'Spam / unsolicited content', description: 'Repeated unsolicited messages or advertisements.' },
  { code: 'HARASSMENT', label: 'Harassment', description: 'Targeted harassment, bullying, or intimidation.' },
  { code: 'HATE_SPEECH', label: 'Hate speech', description: 'Content that attacks a protected class or identity.' },
  { code: 'NSFW_CONTENT', label: 'NSFW content', description: 'Adult or explicit material outside allowed areas.' },
  { code: 'IMPERSONATION', label: 'Impersonation', description: 'Pretending to be another person or brand.' },
  { code: 'SELF_PROMOTION_ABUSE', label: 'Self-promotion abuse', description: 'Excessive self-promotion disrupting communities.' },
  { code: 'ILLEGAL_CONTENT', label: 'Illegal or dangerous content', description: 'Sharing illegal, violent, or dangerous material.' },
  { code: 'OTHER', label: 'Other', description: 'Other violations not covered above.' },
];

export const MODERATION_REASON_MAP = Object.fromEntries(
  MODERATION_REASONS.map((r) => [r.code, r.label])
);

export function getReasonText(reasonCode: string): string {
  return MODERATION_REASON_MAP[reasonCode] || 'Policy violation';
}
