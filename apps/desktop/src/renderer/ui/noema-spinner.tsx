import React from 'react';
import { Spinner, type SpinnerProps } from '@blueprintjs/core';

export function NoemaSpinner({ className = '', ...props }: SpinnerProps) {
  return (
    <Spinner
      {...props}
      className={`noema-spinner ${className}`.trim()}
      aria-hidden={props['aria-label'] ? undefined : true}
    />
  );
}
