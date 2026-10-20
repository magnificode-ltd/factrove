const command = "factrove upload plan.html";

export function CliTerminal() {
  return (
    <div className="ft-term w-full max-w-md" aria-hidden="true">
      <div className="flex items-center gap-1.5 px-3.5 py-2.5">
        <span className="size-2.5 rounded-full bg-[#ff8f8f]" />
        <span className="size-2.5 rounded-full bg-[#ffd27a]" />
        <span className="size-2.5 rounded-full bg-[#8ee0b2]" />
        <span className="ml-2 font-mono text-[11px] tracking-wide text-white/45">zsh</span>
      </div>
      <p className="px-4 pt-1 pb-4 font-mono text-sm leading-none">
        <span className="text-peri">$ </span>
        <span className="ft-type">{command}</span>
      </p>
    </div>
  );
}

export const uploadCommand = command;
