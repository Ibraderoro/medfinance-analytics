import { Component, ReactNode } from 'react';
import { EmptyState } from './EmptyState';

export class ErrorBoundary extends Component<{ children: ReactNode; fallbackTitle?: string }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return <EmptyState title={this.props.fallbackTitle ?? 'Something went wrong'} description="Please refresh the page or try again in a few moments." />;
    }

    return this.props.children;
  }
}
