import { useEffect, useMemo, useRef, useState } from "react";

export interface ServerSelectOption {
  value: number;
  label: string;
  disabled?: boolean;
}

export function ServerSelect(props: {
  label: string;
  value: number | null;
  options: ServerSelectOption[];
  onChange: (value: number) => void;
  disabled?: boolean;
  emptyText?: string;
}) {
  const { label, value, options, onChange, disabled = false, emptyText = "No servers" } = props;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const selected = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value]
  );
  const canOpen = !disabled && options.length > 0;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && rootRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.blur();
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  return (
    <div className="field">
      <label>{label}</label>
      <div className={`server-select ${open ? "is-open" : ""} ${!canOpen ? "is-disabled" : ""}`} ref={rootRef}>
        <button
          ref={buttonRef}
          type="button"
          className="server-select__trigger"
          onClick={() => {
            if (!canOpen) return;
            setOpen((prev) => !prev);
            if (open) {
              buttonRef.current?.blur();
            }
          }}
          disabled={!canOpen}
          aria-haspopup="listbox"
          aria-expanded={open}
          title={selected?.label ?? emptyText}
        >
          <span className="server-select__value">{selected?.label ?? emptyText}</span>
          <span className="server-select__chevron" aria-hidden>
            {open ? "▲" : "▼"}
          </span>
        </button>
        {open && (
          <div className="server-select__menu" role="listbox" aria-label={label}>
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`server-select__option ${
                  option.value === value ? "is-selected" : ""
                } ${option.disabled ? "is-disabled" : ""}`}
                onClick={() => {
                  if (option.disabled) return;
                  onChange(option.value);
                  setOpen(false);
                  buttonRef.current?.blur();
                }}
                disabled={option.disabled}
                role="option"
                aria-selected={option.value === value}
                title={option.label}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
