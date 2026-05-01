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
      res.status(403).json({
        success: false,
        error: { message: 'Self-service registration is disabled', code: 'AUTH_REGISTRATION_DISABLED' },
        data: null,
      });
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
    res.success(tokens, 201);
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
    res.success(tokens);
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
    if (!refreshToken || refreshToken.trim().length === 0) {
      res.status(400).json({
        success: false,
        error: { message: 'refreshToken is required', code: 'AUTH_REFRESH_TOKEN_REQUIRED' },
        data: null,
      });
      return;
    }
    const tokens = await service.refresh(refreshToken);
    res.success(tokens);
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
    res.success({ loggedOut: true });
  } catch (err) {
    next(err);
  }
}
