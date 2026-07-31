export default function GmailIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <path fill="#4285F4" d="M3.5 6.7v10.8c0 .8.7 1.5 1.5 1.5h2.2V9.6L3.5 6.7Z" />
      <path fill="#34A853" d="M16.8 9.6V19H19c.8 0 1.5-.7 1.5-1.5V6.7l-3.7 2.9Z" />
      <path fill="#FBBC04" d="M3.5 6.7 7.2 9.6 12 13.2V8.8L5.8 4.2a1.45 1.45 0 0 0-2.3 1.2v1.3Z" />
      <path fill="#EA4335" d="M12 8.8v4.4l4.8-3.6 3.7-2.9V5.4a1.45 1.45 0 0 0-2.3-1.2L12 8.8Z" />
    </svg>
  );
}
