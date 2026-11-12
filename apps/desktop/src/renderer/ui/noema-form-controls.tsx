import React from 'react';
import {
  InputGroup,
  Checkbox,
  HTMLSelect,
  TextArea,
  type HTMLSelectProps,
  type InputGroupProps,
  type CheckboxProps,
  type TextAreaProps,
} from '@blueprintjs/core';

function classes(...values: Array<string | undefined>) {
  return values.filter(Boolean).join(' ');
}

/** Styled input backed by Blueprint's native-input wrapper and focus states. */
export function NoemaInput({
  className,
  inputClassName,
  ...props
}: InputGroupProps) {
  return (
    <InputGroup
      {...props}
      className="noema-input-group"
      inputClassName={classes('noema-input', className, inputClassName)}
    />
  );
}

/** Textarea primitive with a stable native textarea ref and Blueprint states. */
export function NoemaTextArea({ className, ...props }: TextAreaProps) {
  return (
    <TextArea
      {...props}
      className={classes('noema-textarea', className)}
      inputRef={props.inputRef}
    />
  );
}

/** Blueprint checkbox control that fits inside Noema's existing labelled rows. */
export function NoemaCheckbox({ className, ...props }: CheckboxProps) {
  return (
    <Checkbox
      {...props}
      tagName="span"
      className={classes('noema-checkbox', className)}
    />
  );
}

/** Native single-select with Blueprint's desktop affordance and keyboard styles. */
export function NoemaSelect({ className, ...props }: HTMLSelectProps) {
  return (
    <HTMLSelect
      {...props}
      className={classes('noema-select', className)}
      iconName="caret-down"
      minimal
    />
  );
}
