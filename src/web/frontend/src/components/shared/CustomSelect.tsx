import { useState, useRef, useEffect } from 'react';

interface CustomSelectProps {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export default function CustomSelect({ value, options, onChange, placeholder, className }: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const [dropStyle, setDropStyle] = useState<React.CSSProperties>({});
  const ref = useRef<HTMLDivElement>(null);
  const active = options.find(o => o.value === value);

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    // Calculate position before opening
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const dropdownHeight = Math.min(200, options.length * 34 + 4);

    if (spaceBelow < dropdownHeight && rect.top > spaceBelow) {
      setDropStyle({
        position: 'fixed',
        bottom: window.innerHeight - rect.top + 2,
        left: rect.left,
        width: rect.width,
        zIndex: 9999,
        maxHeight: Math.min(200, rect.top - 8),
      });
    } else {
      setDropStyle({
        position: 'fixed',
        top: rect.bottom + 2,
        left: rect.left,
        width: rect.width,
        zIndex: 9999,
        maxHeight: Math.min(200, spaceBelow - 8),
      });
    }
    setOpen(true);
  }

  function select(val: string) {
    onChange(val);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    function close() { setOpen(false); }
    document.addEventListener('mousedown', close);
    return () => {
      document.removeEventListener('mousedown', close);
    };
  }, [open]);

  return (
    <div ref={ref} className={`custom-select${open ? ' custom-select--open' : ''} ${className || ''}`}>
      <button type="button" className="custom-select-trigger" onClick={toggle}>
        <span className={`custom-select-value${!active ? ' custom-select-value--placeholder' : ''}`}>
          {active?.label || placeholder || ''}
        </span>
        <svg className="custom-select-arrow" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 4l3 3 3-3" /></svg>
      </button>
      {open && (
        <div className={`custom-select-dropdown${className ? ` ${className}-dropdown` : ''}`} style={dropStyle} onMouseDown={e => e.stopPropagation()}>
          {options.map(opt => (
            <div
              key={opt.value}
              className={`custom-select-option${opt.value === value ? ' active' : ''}`}
              onClick={() => select(opt.value)}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
