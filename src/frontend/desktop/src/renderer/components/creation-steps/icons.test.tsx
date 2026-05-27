import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AlertIcon, BellIcon, CheckIcon, CloseIcon } from './icons';

describe('creation step icons', () => {
  it('exports notification icons with pinned paths', () => {
    const { container } = render(
      <>
        <BellIcon />
        <CheckIcon />
        <AlertIcon />
        <CloseIcon />
      </>,
    );

    const paths = [...container.querySelectorAll('path')].map((path) => path.getAttribute('d'));
    expect(paths).toContain('M5 6.5a3 3 0 0 1 6 0v2.2l1.3 2.1H3.7L5 8.7V6.5z');
    expect(paths).toContain('M3.5 8.4l2.8 2.8 6.2-6.4');
    expect(paths).toContain('M8 2.4l6 10.4H2L8 2.4z');
    expect(paths).toContain('M4 4l8 8M12 4l-8 8');
  });
});
