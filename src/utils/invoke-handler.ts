import type { Request, Response } from "express";

type HandlerResult<T> = {
  status: number;
  body: T;
};

/**
 * Invokes an Express route handler with a mock req/res and returns the JSON response.
 */
export async function invokeRouteHandler<T = Record<string, unknown>>(
  handler: (req: Request, res: Response) => Promise<void> | void,
  options: {
    body?: unknown;
    params?: Record<string, string>;
    query?: Record<string, string>;
    headers?: Record<string, string>;
  } = {},
): Promise<HandlerResult<T>> {
  return new Promise((resolve, reject) => {
    const req = {
      body: options.body ?? {},
      params: options.params ?? {},
      query: options.query ?? {},
      headers: options.headers ?? {},
    } as Request;

    let settled = false;
    let statusCode = 200;

    const res = {
      get statusCode() {
        return statusCode;
      },
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(payload: unknown) {
        if (!settled) {
          settled = true;
          resolve({ status: statusCode, body: payload as T });
        }
        return this;
      },
      send(payload?: unknown) {
        if (!settled) {
          settled = true;
          resolve({
            status: statusCode,
            body: (payload ?? {}) as T,
          });
        }
        return this;
      },
      end() {
        if (!settled) {
          settled = true;
          resolve({ status: statusCode, body: {} as T });
        }
      },
    } as Partial<Response> as Response;

    Promise.resolve(handler(req, res))
      .then(() => {
        if (!settled) {
          settled = true;
          resolve({ status: statusCode, body: {} as T });
        }
      })
      .catch(reject);
  });
}
