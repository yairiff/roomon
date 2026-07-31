export default function GmailIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M3.5 18.5V6.2c0-1.2 1.4-1.9 2.3-1.2L12 9.7 18.2 5c.9-.7 2.3 0 2.3 1.2v12.3M3.5 7.2 12 13.4l8.5-6.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
