import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { PwaInstallModal } from '../PwaInstallModal';
import { PwaProvider, usePwa } from '../../../context/PwaContext';

// Helper component to trigger open modal
const OpenModalHelper: React.FC = () => {
  const { openInstallModal } = usePwa();
  React.useEffect(() => {
    openInstallModal();
  }, [openInstallModal]);
  return <PwaInstallModal />;
};

describe('PwaInstallModal', () => {
  it('renders clean modal with Simplify, tagline Made business simple and Install App button', () => {
    render(
      <PwaProvider>
        <OpenModalHelper />
      </PwaProvider>
    );

    // Title
    expect(screen.getByText('Install Simplify App')).toBeDefined();

    // App Branding
    expect(screen.getByText('Simplify')).toBeDefined();
    expect(screen.getByText('Made business simple')).toBeDefined();

    // Primary Action Button
    expect(screen.getByRole('button', { name: /install app/i })).toBeDefined();

    // Verify uppercase SIMPLIFY is NOT present in any heading or paragraph
    const uppercaseElements = screen.queryAllByText(/SIMPLIFY/);
    expect(uppercaseElements.length).toBe(0);
  });
});
