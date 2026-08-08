import {
  int,
  json,
  mysqlEnum,
  mysqlTable,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

export const payments = mysqlTable("payments", {
  id: varchar("id", { length: 36 }).primaryKey(),
  type: mysqlEnum("type", ["nomination", "sponsorship"]).notNull(),
  razorpayOrderId: varchar("razorpay_order_id", { length: 64 }).notNull().unique(),
  razorpayPaymentId: varchar("razorpay_payment_id", { length: 64 }),
  amountPaise: int("amount_paise").notNull(),
  basePaise: int("base_paise").notNull(),
  gstPaise: int("gst_paise").notNull(),
  currency: varchar("currency", { length: 8 }).notNull().default("INR"),
  status: mysqlEnum("status", ["created", "paid", "failed"]).notNull().default("created"),
  metadata: json("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export const nominations = mysqlTable(
  "nominations",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    referenceId: varchar("reference_id", { length: 64 }),
    status: mysqlEnum("status", [
      "draft",
      "pending_payment",
      "paid",
      "under_review",
      "referral_pending",
    ])
      .notNull()
      .default("draft"),
    reviewStatus: mysqlEnum("review_status", ["pending", "approved"]).notNull().default("pending"),
    paymentId: varchar("payment_id", { length: 36 }),
    paymentStatus: mysqlEnum("payment_status", ["unpaid", "paid"]).notNull().default("unpaid"),
    completionToken: varchar("completion_token", { length: 64 }),
    nomineeEmail: varchar("nominee_email", { length: 255 }).notNull().default(""),
    inviteSentAt: timestamp("invite_sent_at"),
    nominatorName: varchar("nominator_name", { length: 255 }).notNull(),
    nominatorEmail: varchar("nominator_email", { length: 255 }).notNull(),
    nominatorPhone: varchar("nominator_phone", { length: 32 }).notNull(),
    nomineeName: varchar("nominee_name", { length: 255 }).notNull(),
    category: varchar("category", { length: 255 }).notNull(),
    profilePhotoKey: varchar("profile_photo_key", { length: 512 }),
    supportingDocsKey: varchar("supporting_docs_key", { length: 512 }),
    videoKey: varchar("video_key", { length: 512 }),
    formData: json("form_data").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    uniqueIndex("nominations_completion_token_uidx").on(table.completionToken),
    uniqueIndex("nominations_nominee_email_uidx").on(table.nomineeEmail),
  ],
);

export const sponsorshipReservations = mysqlTable("sponsorship_reservations", {
  id: varchar("id", { length: 36 }).primaryKey(),
  referenceId: varchar("reference_id", { length: 64 }),
  tierId: varchar("tier_id", { length: 64 }).notNull(),
  tierName: varchar("tier_name", { length: 255 }).notNull(),
  company: varchar("company", { length: 255 }).notNull(),
  contactName: varchar("contact_name", { length: 255 }).notNull(),
  contactEmail: varchar("contact_email", { length: 255 }).notNull(),
  contactPhone: varchar("contact_phone", { length: 32 }).notNull(),
  message: varchar("message", { length: 2000 }),
  status: mysqlEnum("status", ["pending", "confirmed", "cancelled"]).notNull().default("pending"),
  paymentId: varchar("payment_id", { length: 36 }),
  spots: int("spots").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export const contactInquiries = mysqlTable("contact_inquiries", {
  id: varchar("id", { length: 36 }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  company: varchar("company", { length: 255 }),
  inquiryType: varchar("inquiry_type", { length: 128 }),
  message: varchar("message", { length: 5000 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
