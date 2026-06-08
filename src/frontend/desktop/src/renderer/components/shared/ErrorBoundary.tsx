import { Component, type ErrorInfo, type ReactNode } from 'react';

import { createLogger } from '../../log/logger';

const logger = createLogger('src/renderer/components/ErrorBoundary');

type ErrorBoundaryProps = {
  children: ReactNode;
  fallback?: ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
};

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logger.error('react.error.boundary', error, {
      componentStack: info.componentStack ?? undefined,
    });
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div role="alert" className="error-boundary-fallback">
          <p>Something went wrong. Reload the application to continue.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
