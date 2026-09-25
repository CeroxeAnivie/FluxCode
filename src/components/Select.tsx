import { Children, isValidElement, useId, type ReactNode } from 'react';
import * as Primitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';

type OptionProps = { value?: string | number; disabled?: boolean; children: ReactNode };
type Props = {
  value: string | number;
  onValueChange: (value: string) => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  required?: boolean;
  title?: string;
  'aria-label'?: string;
};

/** Radix owns keyboard navigation, typeahead and focus restoration.
 * Content stays in the dialog's top layer instead of portalling behind it. */
export function Select({ children, value, onValueChange, className = '', ...props }: Props) {
  const id = useId();
  const emptyValue = `empty-${id}`;
  const options = Children.toArray(children).filter(isValidElement<OptionProps>);
  const placeholder = options.find((option) => option.props.value === '')?.props.children;
  return (
    <Primitive.Root
      value={String(value)}
      onValueChange={(next) => onValueChange(next === emptyValue ? '' : next)}
      disabled={props.disabled}
      required={props.required}
    >
      <Primitive.Trigger
        className={`select-trigger ${className}`}
        aria-label={props['aria-label']}
        title={props.title}
        data-value={value}
      >
        <Primitive.Value placeholder={placeholder} />
        <Primitive.Icon className="select-chevron">
          <ChevronDown size={14} />
        </Primitive.Icon>
      </Primitive.Trigger>
      <Primitive.Content
        className="select-content"
        position="popper"
        sideOffset={6}
        collisionPadding={12}
      >
        <Primitive.ScrollUpButton className="select-scroll">
          <ChevronUp size={14} />
        </Primitive.ScrollUpButton>
        <Primitive.Viewport className="select-viewport">
          {options.map((option) => {
            const optionValue = String(option.props.value ?? option.props.children);
            return (
              <Primitive.Item
                className="select-item"
                data-value={optionValue}
                key={`${optionValue}:${Children.toArray(option.props.children).join('')}`}
                value={optionValue || emptyValue}
                disabled={option.props.disabled}
              >
                <Primitive.ItemText>{option.props.children}</Primitive.ItemText>
                <Primitive.ItemIndicator className="select-check">
                  <Check size={15} />
                </Primitive.ItemIndicator>
              </Primitive.Item>
            );
          })}
        </Primitive.Viewport>
        <Primitive.ScrollDownButton className="select-scroll">
          <ChevronDown size={14} />
        </Primitive.ScrollDownButton>
      </Primitive.Content>
    </Primitive.Root>
  );
}
