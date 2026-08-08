-- Split nomination flow: referral_pending, completion tokens, payment status, invite tracking
-- Apply manually on local + production MySQL.

ALTER TABLE nominations
  MODIFY COLUMN status ENUM(
    'draft',
    'pending_payment',
    'paid',
    'under_review',
    'referral_pending'
  ) NOT NULL DEFAULT 'draft';

ALTER TABLE nominations
  ADD COLUMN payment_status ENUM('unpaid', 'paid') NOT NULL DEFAULT 'unpaid' AFTER payment_id,
  ADD COLUMN completion_token VARCHAR(64) NULL AFTER payment_status,
  ADD COLUMN nominee_email VARCHAR(255) NOT NULL DEFAULT '' AFTER completion_token,
  ADD COLUMN invite_sent_at TIMESTAMP NULL AFTER nominee_email;

-- Backfill nominee email from JSON form_data when present
UPDATE nominations
SET nominee_email = LOWER(COALESCE(
  NULLIF(JSON_UNQUOTE(JSON_EXTRACT(form_data, '$.nomineeEmail')), ''),
  CONCAT('unknown-', id, '@placeholder.local')
))
WHERE nominee_email = '' OR nominee_email IS NULL;

-- Mark paid when a payment is already linked
UPDATE nominations
SET payment_status = 'paid'
WHERE payment_id IS NOT NULL AND payment_id != '';

-- Deduplicate nominee_email before unique index (keep newest row; suffix older duplicates)
UPDATE nominations n
JOIN (
  SELECT nominee_email, MIN(created_at) AS keep_created
  FROM nominations
  WHERE nominee_email != '' AND nominee_email NOT LIKE 'unknown-%@placeholder.local'
  GROUP BY nominee_email
  HAVING COUNT(*) > 1
) d ON n.nominee_email = d.nominee_email AND n.created_at > d.keep_created
SET n.nominee_email = CONCAT('dup-', n.id, '-', n.nominee_email);

CREATE UNIQUE INDEX nominations_completion_token_uidx ON nominations (completion_token);
CREATE UNIQUE INDEX nominations_nominee_email_uidx ON nominations (nominee_email);
