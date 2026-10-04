import brandIcon from '../../assets/icon.svg';

/** Shared source with the packaged Windows icon and browser favicon. */
export function BrandMark({ className = '' }: { className?: string }) {
  return (
    <img
      className={`brand-symbol ${className}`}
      src={brandIcon}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}
