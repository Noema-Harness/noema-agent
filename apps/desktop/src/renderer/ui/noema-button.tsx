import React from 'react';
import { Button as BlueprintButton, type ButtonProps } from '@blueprintjs/core';

type NoemaButtonProps = ButtonProps & {
  /** Keep an unavailable mode selector discoverable by keyboard and screen readers. */
  focusableWhenDisabled?: boolean;
};

/**
 * Shared native-button contract for Noema screens, backed by Blueprint's
 * keyboard-aware, stateful button primitive while retaining local class hooks.
 */
export function NoemaButton({
  className,
  disabled = false,
  focusableWhenDisabled = false,
  onClick,
  ...props
}: NoemaButtonProps) {
  const buttonRef = React.useRef<HTMLButtonElement>(null);

  React.useLayoutEffect(() => {
    if (disabled && focusableWhenDisabled && buttonRef.current) {
      buttonRef.current.tabIndex = 0;
    }
  }, [disabled, focusableWhenDisabled]);

  if (disabled && focusableWhenDisabled) {
    return (
      <BlueprintButton
        {...props}
        disabled
        ref={buttonRef}
        variant="minimal"
        className={['noema-button', 'bp6-disabled', className]
          .filter(Boolean)
          .join(' ')}
      />
    );
  }

  return (
    <BlueprintButton
      {...props}
      disabled={disabled}
      ref={buttonRef}
      onClick={onClick}
      variant={props.variant ?? 'minimal'}
      className={['noema-button', className].filter(Boolean).join(' ')}
    />
  );
}
