import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Input } from '../Input';

describe('Input Component - Password Eye Toggle', () => {
  it('renders standard password input with hidden text and show-password toggle button', () => {
    render(<Input label="Password" type="password" placeholder="Enter password" />);

    const input = screen.getByPlaceholderText('Enter password') as HTMLInputElement;
    expect(input.type).toBe('password');

    const toggleBtn = screen.getByRole('button', { name: /show password/i });
    expect(toggleBtn).toBeDefined();

    // Click toggle to reveal password
    fireEvent.click(toggleBtn);
    expect(input.type).toBe('text');
    expect(screen.getByRole('button', { name: /hide password/i })).toBeDefined();

    // Click toggle again to hide password
    fireEvent.click(screen.getByRole('button', { name: /hide password/i }));
    expect(input.type).toBe('password');
    expect(screen.getByRole('button', { name: /show password/i })).toBeDefined();
  });

  it('does not render password eye toggle for text inputs', () => {
    render(<Input label="Name" type="text" placeholder="Your Name" />);

    expect(screen.queryByRole('button', { name: /password/i })).toBeNull();
  });

  it('respects disablePasswordToggle prop on password inputs', () => {
    render(<Input label="Password" type="password" disablePasswordToggle placeholder="Secret" />);

    expect(screen.queryByRole('button', { name: /password/i })).toBeNull();
  });
});
