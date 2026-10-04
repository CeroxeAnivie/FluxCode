import { useId } from 'react';

/** Original FluxCode mark: a continuous folded F, legible at navigation size. */
export function BrandMark({ className = '' }: { className?: string }) {
  const id = useId();
  return (
    <svg
      className={`brand-symbol ${className}`}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={id} x1="12" y1="54" x2="51" y2="9" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4668F2" />
          <stop offset=".55" stopColor="#5798FF" />
          <stop offset="1" stopColor="#83DDD8" />
        </linearGradient>
      </defs>
      <path
        d="M14 53V23C14 15.82 19.82 10 27 10H53L45 21H29C26.79 21 25 22.79 25 25V31H46L38 42H25V48L14 56V53Z"
        fill={`url(#${id})`}
      />
      <path d="M25 31H46L38 42H25V31Z" fill="white" fillOpacity=".14" />
      <path d="M25 31L14 39V53L25 45V31Z" fill="#334FC8" fillOpacity=".25" />
      <path
        d="M28 13H47"
        stroke="white"
        strokeOpacity=".5"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
