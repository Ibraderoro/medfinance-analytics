export interface PageInput {
  page?: number;
  limit?: number;
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export function normalizePagination(input: PageInput, defaults = { page: 1, limit: 50, maxLimit: 200 }) {
  const page = Number.isFinite(input.page) ? Math.max(1, Math.floor(Number(input.page))) : defaults.page;
  const limitRaw = Number.isFinite(input.limit) ? Math.floor(Number(input.limit)) : defaults.limit;
  const limit = Math.min(defaults.maxLimit, Math.max(1, limitRaw));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

export function buildPageMeta(page: number, limit: number, total: number): PageMeta {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
}
