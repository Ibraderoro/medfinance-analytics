process.env.JWT_SECRET = process.env.JWT_SECRET ?? '12345678901234567890123456789012';
process.env.REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET ?? '12345678901234567890123456789012';
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://user:pass@localhost:5432/test';
import http from 'http';
import { NextFunction, Request, Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
const mockQuery = jest.fn();

jest.mock('../config/redis', () => ({ getRedis: () => ({ get: async () => null, setex: async () => 'OK', del: async () => 1, scan: async () => ['0', []], ping: async () => 'PONG' }) }));

jest.mock('../config/database', () => ({ query: (...args: unknown[]) => mockQuery(...args), getPool: () => ({ connect: async () => ({ release: () => undefined }) }) }));
jest.mock('../middleware/auth', () => {
  const actual = jest.requireActual('../middleware/auth');
  return { ...actual, authenticate: (req: AuthenticatedRequest, _res: Response, next: NextFunction) => { req.user = { id: 'u1', email: 'e', role: 'viewer', organization_id: 'org-1' }; next(); } };
});
import { app } from '../app';

async function get(path: string) { const s=http.createServer(app); await new Promise<void>(r=>s.listen(0,r)); const port=(s.address() as any).port; const resp= await new Promise<any>((resolve)=>{ http.get({hostname:'127.0.0.1',port,path},(res)=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>resolve({status:res.statusCode, body:JSON.parse(d||'{}')}));});}); await new Promise<void>(r=>s.close(()=>r())); return resp; }

describe('controllers integration', () => {
  beforeEach(() => mockQuery.mockReset());
  it('covers financials, compliance, forecasting routes', async () => {
    mockQuery.mockResolvedValue([]);
    expect((await get('/api/v1/financials/summary?year=2026&period=monthly')).status).toBeGreaterThanOrEqual(200);
    expect((await get('/api/v1/compliance/audit-log?limit=5000')).status).toBe(400);
    expect((await get('/api/v1/forecasting/forecast?months=-1')).status).toBe(400);
    expect((await get('/api/v1/financials/not-real')).status).toBe(404);
  });
});
