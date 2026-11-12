import React from 'react';
import { Overlay2 } from '@blueprintjs/core';

interface NoemaOverlayProps {
  children: React.ReactNode;
  isOpen: boolean;
  onClose: () => void;
  className?: string;
  backdropClassName?: string;
  canEscapeKeyClose?: boolean;
}

/** Blueprint overlay lifecycle/backdrop with Noema's existing dialog content. */
export function NoemaOverlay({
  children,
  isOpen,
  onClose,
  className = '',
  backdropClassName = '',
  canEscapeKeyClose = false,
}: NoemaOverlayProps) {
  return (
    <Overlay2
      isOpen={isOpen}
      className={`noema-overlay ${className}`.trim()}
      backdropClassName={`dialog-backdrop ${backdropClassName}`.trim()}
      canOutsideClickClose
      canEscapeKeyClose={canEscapeKeyClose}
      autoFocus={false}
      enforceFocus={false}
      shouldReturnFocusOnClose={false}
      usePortal={false}
      transitionDuration={180}
      onClose={onClose}
    >
      <div className="noema-overlay-content">{children}</div>
    </Overlay2>
  );
}
