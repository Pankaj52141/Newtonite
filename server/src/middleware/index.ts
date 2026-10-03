import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { ZodError } from 'zod';
import { AppError } from '../errors';

/**
 * Augment Express Request with our custom properties.
 */
declare global {
  namespace Express {
    interface Request {
      requestId: string;
      userId?: string;
    }
  }
}

// ─── Request ID Middleware ────────────────────────────────────────────

export function requestIdMiddleware(req: Request, _res: Response, next: NextFunction) {
  req.requestId = (req.headers['x-request-id'] as string) || uuidv4();
  next();
}

// ─── Structured Request Logging ──────────────────────────────────────

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const log = {
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration: `${duration}ms`,
      userId: req.userId || 'anonymous',
    };

    if (res.statusCode >= 500) {
      console.error(JSON.stringify(log));
    } else if (res.statusCode >= 400) {
      console.warn(JSON.stringify(log));
    } else {
      console.log(JSON.stringify(log));
    }
  });

  next();
}

// ─── Authentication Middleware (Development) ─────────────────────────
/**
 * Development-only authentication using X-User-Id header or query parameter.
 *
 * PRODUCTION NOTE: This is intentionally simplified for the challenge.
 * In production, this would be replaced with proper OAuth 2.0 / JWT / SSO.
 * The important thing is that AUTHORIZATION is correctly implemented on the backend.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  // Allow unauthenticated access to /users for the demo user switcher
  if (req.path === '/users') {
    return next();
  }

  const userId = req.headers['x-user-id'] as string || req.query['userId'] as string;

  if (!userId) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Authentication required. Provide X-User-Id header.',
        requestId: req.requestId,
      },
    });
  }

  req.userId = userId;
  next();
}

// ─── Global Error Handler ────────────────────────────────────────────

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  // Handle Zod validation errors
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request data',
        details: err.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
        requestId: req.requestId,
      },
    });
  }

  // Handle domain errors
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
        requestId: req.requestId,
      },
    });
  }

  // Unexpected errors — log full details but return safe message
  console.error({
    requestId: req.requestId,
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    userId: req.userId,
  });

  return res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      requestId: req.requestId,
    },
  });
}
