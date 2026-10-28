import React, { useId } from 'react';

export type TextFieldProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'id' | 'aria-invalid'
> & {
  id?: string;
  label: string;
  hint?: string;
  error?: string;
};

/** Labeled input with an explicit description/error relationship. */
export function TextField({
  id,
  label,
  hint,
  error,
  className = '',
  ...inputProps
}: TextFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const descriptionId = `${inputId}-description`;
  const describedBy =
    [hint ? descriptionId : '', error ? `${inputId}-error` : '']
      .filter(Boolean)
      .join(' ') || undefined;

  return (
    <div className="noema-field">
      <label className="noema-field__label" htmlFor={inputId}>
        {label}
      </label>
      <input
        {...inputProps}
        id={inputId}
        className={['noema-field__input', className].filter(Boolean).join(' ')}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />
      {hint && (
        <span className="noema-field__hint" id={descriptionId}>
          {hint}
        </span>
      )}
      {error && (
        <span
          className="noema-field__error"
          id={`${inputId}-error`}
          role="alert"
        >
          {error}
        </span>
      )}
    </div>
  );
}
