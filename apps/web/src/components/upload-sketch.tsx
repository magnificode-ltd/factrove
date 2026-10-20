export function UploadSketch() {
  return (
    <div className="relative h-24 w-28" aria-hidden="true">
      <div className="absolute inset-x-2 bottom-0 h-12 rounded-2xl bg-[#ECEDFF]" />
      <svg viewBox="0 0 72 64" className="ft-drop absolute inset-x-3 top-0 h-16 w-auto" fill="none">
        <path
          d="M10 14h28c1.2 0 2.2.5 3 1.3l10 10c.8.8 1.2 1.8 1.2 3V50a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4V18a4 4 0 0 1 4-4Z"
          fill="#ffffff"
          stroke="#1B2037"
          strokeWidth="1.6"
        />
        <path d="M38 14.5V26a2 2 0 0 0 2 2h11" stroke="#858BEE" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M16 38h24M16 44h16" stroke="#858BEE" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </div>
  );
}
