import { act, render, renderHook, screen } from '@testing-library/react';
import { Skeleton } from '../components/common/Skeleton';
import { useLastUpdated } from '../hooks/useLastUpdated';

// ─── Skeleton ─────────────────────────────────────────────────────────────

describe('Skeleton', () => {
  it('renders a hidden div with default dimensions', () => {
    const { container } = render(<Skeleton />);
    const el = container.firstChild as HTMLElement;
    expect(el).toBeInTheDocument();
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.style.width).toBe('100%');
    expect(el.style.height).toBe('1rem');
    expect(el.style.borderRadius).toBe('8px');
  });

  it('applies custom width, height, and radius props', () => {
    const { container } = render(<Skeleton width="50px" height="2rem" radius="4px" />);
    const el = container.firstChild as HTMLElement;
    expect(el.style.width).toBe('50px');
    expect(el.style.height).toBe('2rem');
    expect(el.style.borderRadius).toBe('4px');
  });
});

// ─── useLastUpdated ───────────────────────────────────────────────────────

describe('useLastUpdated', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('returns empty relativeLabel and null lastUpdated initially', () => {
    const { result } = renderHook(() => useLastUpdated());
    expect(result.current.lastUpdated).toBeNull();
    expect(result.current.relativeLabel).toBe('');
  });

  it('returns "Updated just now" immediately after markUpdated', () => {
    const { result } = renderHook(() => useLastUpdated());

    act(() => result.current.markUpdated());

    expect(result.current.lastUpdated).toBeInstanceOf(Date);
    expect(result.current.relativeLabel).toBe('Updated just now');
  });

  it('returns seconds-ago label after 30 seconds', () => {
    const { result } = renderHook(() => useLastUpdated());

    act(() => result.current.markUpdated());
    act(() => jest.advanceTimersByTime(30_000));

    expect(result.current.relativeLabel).toBe('Updated 30s ago');
  });

  it('returns minutes-ago label after 2 minutes', () => {
    const { result } = renderHook(() => useLastUpdated());

    act(() => result.current.markUpdated());
    act(() => jest.advanceTimersByTime(120_000));

    expect(result.current.relativeLabel).toBe('Updated 2m ago');
  });

  it('returns hours-ago label after 2 hours', () => {
    const { result } = renderHook(() => useLastUpdated());

    act(() => result.current.markUpdated());
    act(() => jest.advanceTimersByTime(2 * 60 * 60 * 1000));

    expect(result.current.relativeLabel).toBe('Updated 2h ago');
  });
});
