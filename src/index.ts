import "dotenv/config";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pino from "pino";
import { pinoHttp } from "pino-http";

const logger = pino({ name: "fg-media-hub-api" });
const app = express();

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

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "fg-media-hub-api" });
});

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`FG Media Hub API listening on port ${PORT}`);
  logger.info({ port: PORT, host: "0.0.0.0" }, "FG Media Hub API ready");
});
