import "dotenv/config";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pino from "pino";
import { pinoHttp } from "pino-http";
import { initDatabase, isDbReady } from "./db/index.js";
import { logMailConfigStatus } from "./config/mail.js";

const logger = pino({ name: "fg-media-hub-api" });
const app = express();

// GoDaddy health probe — must respond 200 before any middleware that could fail
app.get("/", (_req, res) => {
  res.status(200).send("OK");
});

app.get("/health", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "fg-media-hub-api",
    db: isDbReady(),
  });
});

const corsOrigins = process.env.CORS_ORIGIN?.split(",").map((o) => o.trim()).filter(Boolean);

app.use(
  pinoHttp({
    logger,
    autoLogging: process.env.NODE_ENV !== "test",
  }),
);
app.use(helmet());
app.use(
  cors({
    origin: corsOrigins?.length ? corsOrigins : true,
    credentials: true,
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

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on port ${PORT}`);
  logger.info({ port: PORT, host: "0.0.0.0" }, "FG Media Hub API ready");

  logMailConfigStatus();

  // Non-blocking DB — do not await before listen
  initDatabase().catch((err) => {
    logger.error({ err }, "Unexpected error during database initialization");
  });
});

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection");
});

process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception");
});
