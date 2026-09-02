-- Employee referral passcodes (single-use, tied to employee details)
-- Apply manually on local + production MySQL, or run `npm run db:push`.

CREATE TABLE IF NOT EXISTS passcodes (
  id VARCHAR(36) PRIMARY KEY,
  code VARCHAR(32) NOT NULL,
  employee_name VARCHAR(255) NOT NULL,
  employee_email VARCHAR(255) NOT NULL,
  employee_phone VARCHAR(32) NOT NULL,
  discount_type ENUM('PERCENTAGE', 'FREE') NOT NULL,
  discount_value INT NOT NULL,
  is_used BOOLEAN NOT NULL DEFAULT FALSE,
  used_at TIMESTAMP NULL,
  batch_id VARCHAR(36) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY passcodes_code_uidx (code)
);
