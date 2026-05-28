import { buildPageMeta, normalizePagination } from '../utils/pagination';

describe('normalizePagination', () => {
  it('uses defaults when page and limit are missing', () => {
    expect(normalizePagination({})).toEqual({ page: 1, limit: 50, offset: 0 });
  });

  it('normalizes page to minimum 1 and floors decimal values', () => {
    expect(normalizePagination({ page: 0.8, limit: 10 })).toEqual({ page: 1, limit: 10, offset: 0 });
  });

  it('clamps limit to maxLimit and computes offset', () => {
    expect(normalizePagination({ page: 3, limit: 999 }, { page: 1, limit: 25, maxLimit: 100 })).toEqual({
      page: 3,
      limit: 100,
      offset: 200,
    });
  });

  it('clamps limit to minimum 1 for non-positive input', () => {
    expect(normalizePagination({ page: 2, limit: -5 })).toEqual({ page: 2, limit: 1, offset: 1 });
  });
});

describe('buildPageMeta', () => {
  it('returns hasNextPage true and hasPreviousPage false on first page with remaining pages', () => {
    expect(buildPageMeta(1, 10, 35)).toEqual({
      page: 1,
      limit: 10,
      total: 35,
      totalPages: 4,
      hasNextPage: true,
      hasPreviousPage: false,
    });
  });

  it('returns hasNextPage false and hasPreviousPage true on final page', () => {
    expect(buildPageMeta(4, 10, 35)).toEqual({
      page: 4,
      limit: 10,
      total: 35,
      totalPages: 4,
      hasNextPage: false,
      hasPreviousPage: true,
    });
  });

  it('ensures totalPages is at least 1 when total is zero', () => {
    expect(buildPageMeta(1, 10, 0)).toEqual({
      page: 1,
      limit: 10,
      total: 0,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    });
  });
});
