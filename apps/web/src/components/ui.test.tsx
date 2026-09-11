import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button, Chip, Field, PasswordInput, TextInput } from './ui.tsx';
import { StepRail } from './StepRail.tsx';

describe('Button', () => {
  it('renders children and handles clicks', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn).toHaveAttribute('type', 'button');
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is disabled and busy while loading', () => {
    render(<Button loading>Save</Button>);
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
  });

  it('applies the variant class', () => {
    render(<Button variant="primary">Go</Button>);
    expect(screen.getByRole('button', { name: 'Go' })).toHaveClass('btn', 'btn--primary');
  });
});

describe('Chip', () => {
  it('applies tone classes', () => {
    render(<Chip tone="green">Ready</Chip>);
    expect(screen.getByText('Ready')).toHaveClass('chip', 'chip--green');
  });
});

describe('Field', () => {
  it('wires label, hint and error to the control', () => {
    render(
      <Field label="Password" hint="At least 8 chars" error="Required">
        {({ id, describedBy, invalid }) => <TextInput id={id} aria-describedby={describedBy} aria-invalid={invalid || undefined} />}
      </Field>,
    );
    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const described = input.getAttribute('aria-describedby') ?? '';
    expect(described.split(' ')).toHaveLength(2);
    expect(screen.getByRole('alert')).toHaveTextContent('Required');
  });
});

describe('PasswordInput', () => {
  it('toggles visibility', () => {
    render(<PasswordInput aria-label="Secret" defaultValue="hunter22" />);
    const input = screen.getByLabelText('Secret');
    expect(input).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: 'Show value' }));
    expect(input).toHaveAttribute('type', 'text');
    fireEvent.click(screen.getByRole('button', { name: 'Hide value' }));
    expect(input).toHaveAttribute('type', 'password');
  });
});

describe('StepRail', () => {
  it('marks the current step', () => {
    render(<StepRail current={0} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveAttribute('aria-current', 'step');
    expect(items[0]).toHaveClass('step--on');
    expect(items[1]).not.toHaveAttribute('aria-current');
    expect(screen.getByText('Size & style')).toBeInTheDocument();
  });
});
