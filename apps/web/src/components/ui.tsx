import { useId, useState } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { Link } from 'react-router';
import { Icon } from './Icon.tsx';
import type { IconName } from './Icon.tsx';
import type { ChipTone } from '../lib/format.ts';

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/* ---------- Button ---------- */

type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger';

interface ButtonBaseProps {
  variant?: ButtonVariant | undefined;
  size?: 'default' | 'sm' | undefined;
  icon?: IconName | undefined;
  iconRight?: IconName | undefined;
  loading?: boolean | undefined;
  className?: string | undefined;
  children?: ReactNode;
}

type ButtonProps = ButtonBaseProps & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'>;

function buttonClass(p: ButtonBaseProps, iconOnly: boolean): string {
  return cx(
    'btn',
    p.variant && p.variant !== 'default' && `btn--${p.variant}`,
    p.size === 'sm' && 'btn--sm',
    iconOnly && 'btn--icon',
    p.className,
  );
}

export function Button({
  variant = 'default',
  size = 'default',
  icon,
  iconRight,
  loading = false,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  const iconOnly = !children && Boolean(icon);
  return (
    <button
      type={type}
      className={buttonClass({ variant, size, className }, iconOnly)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="btn__spinner" aria-hidden="true" /> : icon ? <Icon name={icon} /> : null}
      {children}
      {iconRight && !loading ? <Icon name={iconRight} /> : null}
    </button>
  );
}

interface LinkButtonProps extends ButtonBaseProps {
  to: string;
  'aria-label'?: string;
  title?: string;
}

export function LinkButton({ to, variant = 'default', size = 'default', icon, iconRight, className, children, ...rest }: LinkButtonProps) {
  const iconOnly = !children && Boolean(icon);
  return (
    <Link to={to} className={buttonClass({ variant, size, className }, iconOnly)} {...rest}>
      {icon ? <Icon name={icon} /> : null}
      {children}
      {iconRight ? <Icon name={iconRight} /> : null}
    </Link>
  );
}

/* ---------- Chip ---------- */

interface ChipProps {
  tone?: ChipTone | undefined;
  outline?: boolean | undefined;
  icon?: IconName | undefined;
  className?: string | undefined;
  children: ReactNode;
}

export function Chip({ tone = 'neutral', outline, icon, className, children }: ChipProps) {
  return (
    <span className={cx('chip', tone !== 'neutral' && `chip--${tone}`, outline && 'chip--outline', className)}>
      {icon ? <Icon name={icon} size={13} /> : null}
      {children}
    </span>
  );
}

/* ---------- Fields ---------- */

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string | undefined;
  /** Render prop receives the ids to wire up the control. */
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}

export function Field({ label, hint, error, className, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = cx(hint ? hintId : undefined, error ? errorId : undefined) || undefined;
  return (
    <div className={cx('field', className)}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint ? (
        <div className="field__hint" id={hintId}>
          {hint}
        </div>
      ) : null}
      {error ? (
        <div className="field__hint field__hint--error" id={errorId} role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}

type TextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> & {
  className?: string | undefined;
};

export function TextInput({ className, ...rest }: TextInputProps) {
  return <input className={cx('input', className)} {...rest} />;
}

export function PasswordInput({ className, ...rest }: TextInputProps) {
  const [show, setShow] = useState(false);
  return (
    <div className="input-wrap">
      <input className={cx('input', 'input--with-trailing', className)} type={show ? 'text' : 'password'} {...rest} />
      <button
        type="button"
        className="input-wrap__trailing"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? 'Hide value' : 'Show value'}
        aria-pressed={show}
        tabIndex={-1}
      >
        <Icon name={show ? 'eyeOff' : 'eye'} />
      </button>
    </div>
  );
}

type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'> & {
  className?: string | undefined;
};

export function Select({ className, children, ...rest }: SelectProps) {
  return (
    <select className={cx('input', className)} {...rest}>
      {children}
    </select>
  );
}

/* ---------- Checkbox visual (used with a hidden native input) ---------- */

export function CheckboxMark({ checked }: { checked: boolean }) {
  return (
    <span className={cx('checkbox', checked && 'checkbox--on')} aria-hidden="true">
      {checked ? <Icon name="check" size={13} strokeWidth={2.4} /> : null}
    </span>
  );
}

/* ---------- Note ---------- */

interface NoteProps {
  tone?: 'neutral' | 'error' | 'accent' | 'amber' | undefined;
  icon?: IconName | undefined;
  children: ReactNode;
  role?: 'alert' | 'status' | undefined;
}

export function Note({ tone = 'neutral', icon, children, role }: NoteProps) {
  const defaultIcon: IconName = tone === 'error' ? 'alert' : tone === 'amber' ? 'alert' : 'info';
  return (
    <div className={cx('note', tone !== 'neutral' && `note--${tone}`)} role={role}>
      <Icon name={icon ?? defaultIcon} />
      <div className="grow">{children}</div>
    </div>
  );
}

/* ---------- Status dot ---------- */

export function Dot({ tone }: { tone: 'green' | 'amber' | 'red' | 'neutral' }) {
  return <span className={cx('dot', tone !== 'neutral' && `dot--${tone}`)} aria-hidden="true" />;
}

/* ---------- Skeleton ---------- */

export function Skeleton({ width, height = 16, className }: { width?: number | string; height?: number | string; className?: string }) {
  return <span className={cx('skeleton', className)} style={{ display: 'block', width: width ?? '100%', height }} aria-hidden="true" />;
}
