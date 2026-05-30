import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from '../components/common/ErrorBoundary';

function Crash(): JSX.Element {
  throw new Error('boom');
}

describe('ErrorBoundary', () => {
  it('renders children when no error is thrown', () => {
    render(
      <ErrorBoundary>
        <div>Healthy content</div>
      </ErrorBoundary>,
    );

    expect(screen.getByText('Healthy content')).toBeInTheDocument();
  });

  it('renders provided fallback title when a child throws', () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <ErrorBoundary fallbackTitle="Application unavailable">
        <Crash />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Application unavailable')).toBeInTheDocument();
    consoleErrorSpy.mockRestore();
  });

  it('renders the default fallback title when no custom title is provided', () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <ErrorBoundary>
        <Crash />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    consoleErrorSpy.mockRestore();
  });
});
