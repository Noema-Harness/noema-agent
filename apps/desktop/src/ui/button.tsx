import React from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: 'small' | 'medium';
};

export type IconButtonProps = ButtonProps & { label: string };

/** Shared action control. Feature-specific meaning stays with its caller. */
export function Button({
  variant = 'secondary',
  size = 'medium',
  className = '',
  type = 'button',
  ...props
}: ButtonProps) {
  const classes = [
    'noema-button',
    `noema-button--${variant}`,
    `noema-button--${size}`,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return <button {...props} className={classes} type={type} />;
}

/** Icon-only action with a required accessible name. */
export function IconButton({
  label,
  variant = 'quiet',
  size = 'small',
  className = '',
  ...props
}: IconButtonProps) {
  return (
    <Button
      {...props}
      aria-label={label}
      variant={variant}
      size={size}
      className={['noema-button--icon', className].filter(Boolean).join(' ')}
    />
  );
}
