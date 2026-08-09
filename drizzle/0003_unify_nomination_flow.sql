-- Unify nomination flow: drop referral/completion-token columns
-- Apply manually on local + production MySQL.

UPDATE nominations
SET status = 'under_review'
WHERE status = 'referral_pending';

ALTER TABLE nominations
  DROP INDEX nominations_completion_token_uidx,
  DROP COLUMN completion_token,
  DROP COLUMN invite_sent_at;

ALTER TABLE nominations
  MODIFY COLUMN status ENUM(
    'draft',
    'pending_payment',
    'paid',
    'under_review'
  ) NOT NULL DEFAULT 'draft';
