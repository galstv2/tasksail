import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import AuthorityBoundarySection from './AuthorityBoundarySection';

afterEach(() => {
  cleanup();
});

describe('AuthorityBoundarySection', () => {
  it('renders section title', () => {
    render(<AuthorityBoundarySection message="" policyBoundary="" />);
    expect(screen.getByText('Permissions')).toBeInTheDocument();
  });

  it('renders message when provided', () => {
    render(<AuthorityBoundarySection message="Agents may read files" policyBoundary="" />);
    expect(screen.getByText('Agents may read files')).toBeInTheDocument();
  });

  it('renders policy boundary when provided', () => {
    render(<AuthorityBoundarySection message="" policyBoundary="No git push allowed" />);
    expect(screen.getByText('No git push allowed')).toBeInTheDocument();
  });

  it('renders both message and policy boundary', () => {
    render(
      <AuthorityBoundarySection
        message="Agents may read files"
        policyBoundary="No git push allowed"
      />,
    );
    expect(screen.getByText('Agents may read files')).toBeInTheDocument();
    expect(screen.getByText('No git push allowed')).toBeInTheDocument();
  });
});
