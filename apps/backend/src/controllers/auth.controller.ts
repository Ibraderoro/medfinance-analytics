import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service';
import { env } from '../config/env';

const service = new AuthService();

export async function register(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!env.ALLOW_SELF_SERVICE_REGISTRATION) {
      res.status(403).json({ error: 'Self-service registration is disabled' });
      return;
    }

    const { email, password, firstName, lastName, role, organizationId } = req.body as {
      email: string;
      password: string;
      firstName: string;
      lastName: string;
      role?: string;
      organizationId: string;
    };
    const tokens = await service.register(
      email,
      password,
      firstName,
      lastName,
      organizationId,
      role,
    );
    res.status(201).json(tokens);
  } catch (err) {
    next(err);
  }
}

export async function login(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { email, password, organizationId } = req.body as { email: string; password: string; organizationId: string };
    const tokens = await service.login(email, password, organizationId);
    res.json(tokens);
  } catch (err) {
    next(err);
  }
}

export async function refresh(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { refreshToken } = req.body as { refreshToken: string };
    const tokens = await service.refresh(refreshToken);
    res.json(tokens);
  } catch (err) {
    next(err);
  }
}

export async function logout(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { refreshToken } = req.body as { refreshToken?: string };
    if (refreshToken) {
      await service.logout(refreshToken);
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}
