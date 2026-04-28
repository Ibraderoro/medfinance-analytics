import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service';

const service = new AuthService();

export async function register(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
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
    res.status(201).json({ data: tokens });
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
    const { email, password } = req.body as { email: string; password: string };
    const tokens = await service.login(email, password);
    res.json({ data: tokens });
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
    res.json({ data: tokens });
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
