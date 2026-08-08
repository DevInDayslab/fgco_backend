import type { Request, Response, NextFunction } from "express";

export function requireAdminPasscode(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.ADMIN_PASSCODE?.trim();
  if (!expected) {
    res.status(503).json({ error: "Admin passcode not configured" });
    return;
  }

  const provided = req.header("X-Admin-Passcode")?.trim();
  if (!provided || provided !== expected) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}
