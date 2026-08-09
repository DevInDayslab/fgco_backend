import type { NextFunction, Request, Response } from "express";

function isAllowedOrigin(origin: string): boolean {
  const listed =
    process.env.CORS_ORIGIN?.split(",")
      .map((entry) => entry.trim())
      .filter(Boolean) ?? [];

  if (listed.includes(origin)) {
    return true;
  }

  // FG Media production frontends (apex, www, subdomains)
  if (/^https:\/\/([a-z0-9-]+\.)*fgco\.in$/i.test(origin)) {
    return true;
  }

  // Local development
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
    return true;
  }

  return false;
}

function applyCorsHeaders(req: Request, res: Response): void {
  const origin = req.headers.origin;
  if (!origin || !isAllowedOrigin(origin)) {
    return;
  }

  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Vary", "Origin");
}

/** Explicit CORS — avoids cors-package callback rejections on production. */
export function corsMiddleware(req: Request, res: Response, next: NextFunction) {
  applyCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  next();
}
