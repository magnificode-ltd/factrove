import type { ReactNode } from "react";
import { CliTerminal } from "@/components/cli-terminal";
import { CopyButton } from "@/components/copy-button";
import { Card, CardContent } from "@/components/ui/card";
import type { GettingStartedCopy } from "@/library/getting-started";

const textLink =
  "font-semibold text-peri-d underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-peri-d";

export function GettingStarted({ copy }: { copy: GettingStartedCopy }) {
  return (
    <Card role="status" className="mt-10 w-full max-w-3xl bg-white">
      <CardContent className="flex flex-col items-start gap-5">
        <CliTerminal command={copy.uploadCommand} className="max-w-xl" />
        <div>
          <h2 className="text-lg font-extrabold tracking-tight">Upload your first artifact</h2>
          <p className="mt-2 text-lg leading-relaxed">
            No artifacts yet. These steps install the CLI, send an HTML file, and open it in this library.
          </p>
        </div>
        <ol className="m-0 flex w-full list-decimal flex-col gap-6 pl-5 marker:font-semibold marker:text-peri-d">
          <li>
            <h3 className="text-base font-semibold">Install the CLI</h3>
            <p className="mt-1 text-base leading-relaxed">
              Install the <Code>factrove</Code> package. It also installs <Code>ftrv</Code>, which runs the same
              commands. You need{" "}
              <a href="https://nodejs.org/en/download" className={textLink} target="_blank" rel="noreferrer">
                Node.js
              </a>{" "}
              24.7 or newer, below 25.
            </p>
            <CommandRow value={copy.installCommand} label="Copy install" />
            <p className="mt-3 text-base leading-relaxed">
              Or skip the global install and put <Code>npx</Code> in front of each command.
            </p>
            <CommandRow value={copy.npxCommand} label="Copy npx" />
          </li>
          <li>
            <h3 className="text-base font-semibold">Configure an API key</h3>
            <p className="mt-1 text-base leading-relaxed">
              Create a key on the{" "}
              <a href="/account/api-keys" className={textLink}>
                API keys
              </a>{" "}
              page. The secret is shown once. <Code>factrove configure</Code> prompts for that key, so it stays out
              of shell history. <Code>--api-url</Code> is this app&apos;s API origin.
            </p>
            <CommandRow value={copy.configureCommand} label="Copy configure" />
          </li>
          <li>
            <h3 className="text-base font-semibold">Upload an HTML file</h3>
            <p className="mt-1 text-base leading-relaxed">
              <Code>factrove upload</Code> sends one <Code>.html</Code> or <Code>.htm</Code> file. Replace{" "}
              <Code>plan.html</Code> with your file.
            </p>
            <CommandRow value={copy.uploadCommand} label="Copy upload" />
          </li>
          <li>
            <h3 className="text-base font-semibold">View it</h3>
            <p className="mt-1 text-base leading-relaxed">
              Refresh this page. The command prints the artifact id. Open <Code>/artifacts/</Code> plus that id, or
              add <Code>--json</Code> and open <Code>viewerUrl</Code> from that line.
            </p>
          </li>
        </ol>
        <p className="text-base leading-relaxed">
          <a href={copy.docsUrl} className={textLink} target="_blank" rel="noreferrer">
            CLI reference
          </a>{" "}
          lists every command and flag.
        </p>
        <div className="w-full border-t border-border pt-5">
          <h2 className="text-base font-semibold">Have your agent set it up</h2>
          <p className="mt-1 text-base leading-relaxed">
            Paste this into Claude Code, Cursor, or another coding agent. It installs the CLI, configures your API
            key, and uploads a first artifact.
          </p>
          <pre className="mt-3 overflow-auto rounded-lg bg-lilac px-3 py-2 font-mono text-sm whitespace-pre-wrap text-ink">
            {copy.agentPrompt}
          </pre>
          <div className="mt-3">
            <CopyButton label="Copy prompt" copiedLabel="Copied" message="Prompt copied" value={copy.agentPrompt} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function OrganizationEmpty({
  organizationName,
  copy,
}: {
  organizationName: string;
  copy: GettingStartedCopy;
}) {
  return (
    <Card role="status" className="mt-10 w-full max-w-2xl bg-white">
      <CardContent className="flex flex-col items-start gap-4">
        <p className="text-lg leading-relaxed">No organization-shared artifacts for {organizationName}.</p>
        <p className="text-base leading-relaxed">
          After the CLI is configured, upload with <Code>--access org_shared</Code>. That needs a current
          organization membership. Signup does not create one. Name it in the web app after you sign in. Install and configure are in the{" "}
          <a href={copy.docsUrl} className={textLink} target="_blank" rel="noreferrer">CLI reference</a>.
        </p>
        <CommandRow value={copy.orgUploadCommand} label="Copy upload" />
      </CardContent>
    </Card>
  );
}

function CommandRow({ value, label }: { value: string; label: string }) {
  return (
    <div className="mt-3 flex w-full flex-wrap items-center gap-3">
      <code className="max-w-full rounded-lg bg-lilac px-3 py-2 font-mono text-sm break-words whitespace-pre-wrap text-ink">
        {value}
      </code>
      <CopyButton label={label} copiedLabel="Copied" message="Command copied" value={value} />
    </div>
  );
}

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-lilac px-1.5 py-0.5 font-mono text-[0.9em] text-ink">{children}</code>;
}
