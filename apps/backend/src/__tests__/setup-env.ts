if (!process.env.JWT_SECRET || process.env.JWT_SECRET.trim().length === 0) process.env.JWT_SECRET = '12345678901234567890123456789012';
if (!process.env.REFRESH_TOKEN_SECRET || process.env.REFRESH_TOKEN_SECRET.trim().length === 0) process.env.REFRESH_TOKEN_SECRET = 'abcdefabcdefabcdefabcdefabcdef12';
if (!process.env.AUDIT_EXPORT_SIGNING_SECRET || process.env.AUDIT_EXPORT_SIGNING_SECRET.trim().length === 0) process.env.AUDIT_EXPORT_SIGNING_SECRET = 'abcdefghijklmnopqrstuvwxyz123456';
if (!process.env.DATABASE_URL || process.env.DATABASE_URL.trim().length === 0) process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test';
