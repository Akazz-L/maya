import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccountMenu } from './AccountMenu';
import { clerk } from '../test/clerk';

describe('AccountMenu', () => {
  it('shows the first letter of the signed-in email', () => {
    render(<AccountMenu />);
    expect(screen.getByRole('button', { name: 'Account' })).toHaveTextContent('W');
  });

  it('lists the account, opens its profile, and logs out', async () => {
    render(<AccountMenu />);

    await userEvent.click(screen.getByRole('button', { name: 'Account' }));
    expect(screen.getByText('writer@example.com')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: /manage account/i }));
    expect(clerk.openUserProfile).toHaveBeenCalledOnce();

    await userEvent.click(screen.getByRole('button', { name: 'Account' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /log out/i }));
    expect(clerk.signOut).toHaveBeenCalledOnce();
  });
});
