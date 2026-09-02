import path from "node:path";
import { fileURLToPath } from "node:url";
import "./config/load-env.js";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pino from "pino";
import { pinoHttp } from "pino-http";
import { bootstrapAdminUser, ensureDevAdminUser } from "./bootstrap/admin.js";
import { getDatabaseHealth, initDatabase } from "./db/index.js";
import { logMailConfigStatus } from "./config/mail.js";
import { logRazorpayConfigStatus } from "./config/razorpay.js";
import { corsMiddleware } from "./middleware/cors.js";
import {
  postAdminChangePassword,
  postAdminLogin,
  requireAdminAuth,
} from "./middleware/adminAuth.js";
import {
  getDashboard,
  getDevAccess,
  getInquiryById,
  getInquiries,
  getNominationById,
  getNominations,
  getPaymentById,
  getPayments,
  getSponsorshipById,
  getSponsorships,
  patchNomination,
  patchInquiry,
  patchSponsorship,
  postSendInvite,
} from "./routes/admin.js";
import multer from "multer";
import { initLocalStorage, getStorageMode } from "./storage/index.js";
import { getAdminFile } from "./routes/files.js";
import { postUpload } from "./routes/uploads.js";
import {
  postApplication,
  postCheckNomineeEmail,
  postContact,
  postNominationCreateOrder,
  postNominationPayment,
  postPaymentsWebhook,
  postSponsorshipCreateOrder,
  postSponsorshipPayment,
  postSponsorshipRegister,
} from "./routes/public.js";
import { postPasscodesCheck, postPasscodesValidate } from "./routes/passcodes.js";
import { postAdminPasscodesGenerate } from "./routes/passcodesAdmin.js";
import { getMailStatus, postMailTest, postMailVerify } from "./routes/mailAdmin.js";
import {
  getNotificationScenarios,
  postNotificationRun,
} from "./routes/notificationsAdmin.js";
import { runStartupMailCheck } from "./utils/mailer.js";

const logger = pino({ name: "fg-media-hub-api" });
const app = express();

// GoDaddy sits behind a reverse proxy and sets X-Forwarded-For. Required for
// express-rate-limit and accurate req.ip (without this, rate-limit throws ERR_ERL_UNEXPECTED_X_FORWARDED_FOR).
const trustProxy = process.env.TRUST_PROXY?.trim();
app.set(
  "trust proxy",
  trustProxy === "false" ? false : trustProxy ? Number(trustProxy) || 1 : 1,
);

// GoDaddy health probe — must respond 200 before any middleware that could fail
app.get("/", (_req, res) => {
  res.status(200).send("OK");
});

app.get("/health", async (_req, res) => {
  try {
    const dbHealth = await getDatabaseHealth();

    res.status(200).json({
      ok: true,
      service: "fg-media-hub-api",
      db: dbHealth.ok,
      ...(dbHealth.ok
        ? {}
        : {
            error_message: dbHealth.error_message,
            error_code: dbHealth.error_code,
          }),
    });
  } catch (err) {
    const e = err as { message?: string; code?: string | number };
    res.status(200).json({
      ok: true,
      service: "fg-media-hub-api",
      db: false,
      error_message: e?.message ?? String(err),
      error_code: String(e?.code ?? "HEALTH_CHECK_FAILED"),
    });
  }
});

// CORS before helmet/rate-limit so preflight always gets ACAO headers.
app.use(corsMiddleware);

app.use(
  pinoHttp({
    logger,
    autoLogging: process.env.NODE_ENV !== "test",
  }),
);
app.use(
  helmet({
    // API is called from fgco.in — default same-origin CORP blocks cross-subdomain fetches.
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Try again later." },
});

const passcodeCheckLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many passcode attempts. Try again later." },
});
app.post(
  "/api/payments/webhook",
  express.raw({ type: "application/json" }),
  postPaymentsWebhook,
);

app.use(express.json({ limit: "1mb" }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(
  "/email-assets",
  express.static(path.resolve(__dirname, "../assets/email"), {
    maxAge: "7d",
    fallthrough: false,
  }),
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

function handleUpload(req: Request, res: Response, next: NextFunction) {
  upload.single("file")(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({ error: "File too large. Maximum upload size is 100MB." });
        return;
      }
      res.status(400).json({ error: err.message });
      return;
    }
    if (err) {
      res.status(500).json({ error: "Upload failed" });
      return;
    }
    next();
  });
}

app.post("/api/uploads", handleUpload, postUpload);
app.post("/api/contact", postContact);
app.post("/api/passcodes/check", passcodeCheckLimiter, postPasscodesCheck);
app.post("/api/passcodes/validate", passcodeCheckLimiter, postPasscodesValidate);
app.post("/api/nominations/create-order", postNominationCreateOrder);
app.post("/api/nominations/complete-payment", postNominationPayment);
app.post("/api/nominations/check-email", postCheckNomineeEmail);
app.post("/api/applications", postApplication);
app.post("/api/sponsorship/register", postSponsorshipRegister);
app.post("/api/sponsorship/create-order", postSponsorshipCreateOrder);
app.post("/api/sponsorship/complete-payment", postSponsorshipPayment);

app.post("/api/admin/login", adminLoginLimiter, postAdminLogin);
app.get("/api/admin/dev-access", getDevAccess);

const adminRouter = express.Router();
adminRouter.use(requireAdminAuth);
adminRouter.post("/change-password", postAdminChangePassword);
adminRouter.get("/dashboard", getDashboard);
adminRouter.get("/nominations", getNominations);
adminRouter.get("/nominations/:id", getNominationById);
adminRouter.patch("/nominations/:id", patchNomination);
adminRouter.get("/payments", getPayments);
adminRouter.get("/payments/:id", getPaymentById);
adminRouter.get("/inquiries", getInquiries);
adminRouter.get("/inquiries/:id", getInquiryById);
adminRouter.patch("/inquiries/:id", patchInquiry);
adminRouter.get("/sponsorships", getSponsorships);
adminRouter.get("/sponsorships/:id", getSponsorshipById);
adminRouter.patch("/sponsorships/:id", patchSponsorship);
adminRouter.get("/files", getAdminFile);
adminRouter.post("/send-invite", postSendInvite);
adminRouter.post("/passcodes/generate", postAdminPasscodesGenerate);
adminRouter.get("/mail/status", getMailStatus);
adminRouter.post("/mail/verify", postMailVerify);
adminRouter.post("/mail/test", postMailTest);
adminRouter.get("/notifications/scenarios", getNotificationScenarios);
adminRouter.post("/notifications/run", postNotificationRun);

app.use("/api/admin", adminRouter);

app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: "File too large. Maximum upload size is 100MB." });
      return;
    }
    res.status(400).json({ error: err.message });
    return;
  }

  logger.error({ err }, "Unhandled API error");
  res.status(500).json({
    error: err instanceof Error ? err.message : "Internal server error",
  });
});

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on port ${PORT}`);
  logger.info({ port: PORT, host: "0.0.0.0" }, "FG Media Hub API ready");

  logMailConfigStatus();
  logRazorpayConfigStatus();
  void runStartupMailCheck();

  // Non-blocking DB — do not await before listen
  initDatabase()
    .then(async (ok) => {
      if (!ok) return;
      try {
        await bootstrapAdminUser();
        await ensureDevAdminUser();
      } catch (err) {
        logger.error({ err }, "Admin bootstrap failed");
      }
    })
    .catch((err) => {
      logger.error({ err }, "Unexpected error during database initialization");
    });

  if (getStorageMode() === "local") {
    initLocalStorage().catch((err: unknown) => {
      logger.error({ err }, "Failed to initialize local upload directory");
    });
  } else {
    logger.info("Using R2 object storage for uploads");
  }
});

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection");
});

process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception");
});
