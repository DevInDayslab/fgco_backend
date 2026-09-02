-- FG Media Hub — full MySQL schema for GoDaddy phpMyAdmin
-- Safe to run on empty OR existing databases (CREATE TABLE IF NOT EXISTS).
-- Import this single file in phpMyAdmin → Import, or paste into SQL tab and Go.
--
-- Database: use your existing GoDaddy DB (e.g. fgmedia_db). Do NOT create a new DB
-- unless you intend to migrate data separately.

-- ---------------------------------------------------------------------------
-- Admins
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admins (
  id VARCHAR(36) PRIMARY KEY,
  username VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  token_version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY admins_username_uidx (username)
);

-- ---------------------------------------------------------------------------
-- Payments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
  id VARCHAR(36) PRIMARY KEY,
  type ENUM('nomination', 'sponsorship') NOT NULL,
  razorpay_order_id VARCHAR(64) NOT NULL,
  razorpay_payment_id VARCHAR(64) NULL,
  amount_paise INT NOT NULL,
  base_paise INT NOT NULL,
  gst_paise INT NOT NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'INR',
  status ENUM('created', 'paid', 'failed') NOT NULL DEFAULT 'created',
  metadata JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY payments_razorpay_order_id_uidx (razorpay_order_id)
);

-- ---------------------------------------------------------------------------
-- Nominations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nominations (
  id VARCHAR(36) PRIMARY KEY,
  reference_id VARCHAR(64) NULL,
  status ENUM('draft', 'pending_payment', 'paid', 'under_review') NOT NULL DEFAULT 'draft',
  review_status ENUM('pending', 'approved') NOT NULL DEFAULT 'pending',
  payment_id VARCHAR(36) NULL,
  payment_status ENUM('unpaid', 'paid') NOT NULL DEFAULT 'unpaid',
  nominee_email VARCHAR(255) NOT NULL DEFAULT '',
  nominator_name VARCHAR(255) NOT NULL,
  nominator_email VARCHAR(255) NOT NULL,
  nominator_phone VARCHAR(32) NOT NULL,
  nominee_name VARCHAR(255) NOT NULL,
  category VARCHAR(255) NOT NULL,
  profile_photo_key VARCHAR(512) NULL,
  supporting_docs_key VARCHAR(512) NULL,
  video_key VARCHAR(512) NULL,
  form_data JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY nominations_nominee_email_uidx (nominee_email)
);

-- ---------------------------------------------------------------------------
-- Sponsorship reservations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sponsorship_reservations (
  id VARCHAR(36) PRIMARY KEY,
  reference_id VARCHAR(64) NULL,
  tier_id VARCHAR(64) NOT NULL,
  tier_name VARCHAR(255) NOT NULL,
  company VARCHAR(255) NOT NULL,
  contact_name VARCHAR(255) NOT NULL,
  contact_email VARCHAR(255) NOT NULL,
  contact_phone VARCHAR(32) NOT NULL,
  message VARCHAR(2000) NULL,
  status ENUM('pending', 'confirmed', 'cancelled') NOT NULL DEFAULT 'pending',
  payment_id VARCHAR(36) NULL,
  spots INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- Contact inquiries
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contact_inquiries (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  company VARCHAR(255) NULL,
  inquiry_type VARCHAR(128) NULL,
  message VARCHAR(5000) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- Employee referral passcodes (new)
-- ---------------------------------------------------------------------------
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
