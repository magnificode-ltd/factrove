import { docsUrl } from "@/docs";

export const CLI_REFERENCE_PATH = "/cli-reference/overview";

export const NPM_INSTALL_COMMAND = "npm i -g factrove";
export const NPX_COMMAND = "npx factrove";
export const UPLOAD_COMMAND = "factrove upload plan.html";

export type GettingStartedCopy = {
  apiOrigin: string;
  installCommand: string;
  npxCommand: string;
  configureCommand: string;
  uploadCommand: string;
  orgUploadCommand: string;
  agentPrompt: string;
  docsUrl: string;
};

export function gettingStartedCopy(input: { apiOrigin: string }): GettingStartedCopy {
  const configureCommand = `factrove configure --api-url ${shellWord(input.apiOrigin)}`;
  const uploadCommand = UPLOAD_COMMAND;
  const orgUploadCommand = `${uploadCommand} --access org_shared`;
  return {
    apiOrigin: input.apiOrigin,
    installCommand: NPM_INSTALL_COMMAND,
    npxCommand: NPX_COMMAND,
    configureCommand,
    uploadCommand,
    orgUploadCommand,
    agentPrompt: agentPrompt({ configureCommand, uploadCommand, apiOrigin: input.apiOrigin }),
    docsUrl: docsUrl(CLI_REFERENCE_PATH),
  };
}

function shellWord(value: string): string {
  if (/^[A-Za-z0-9._~:/-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function agentPrompt(input: { configureCommand: string; uploadCommand: string; apiOrigin: string }): string {
  return [
    "Set up the Factrove CLI and upload a first HTML artifact for me.",
    "",
    "Install the CLI from npm. The package name is factrove. It installs two commands, factrove and ftrv. They are the same program.",
    NPM_INSTALL_COMMAND,
    "",
    "You can skip the global install and put npx in front of each command, for example npx factrove configure.",
    "",
    "Ask me for an API key. I create it in the Factrove web app at /account/api-keys. The secret is shown once. Do not invent a key. Do not pass the key with --api-key, so it stays out of shell history.",
    "",
    `The API origin for this app is ${input.apiOrigin}. Save the key for that origin with:`,
    input.configureCommand,
    "On a terminal, the command prompts for the key. When stdin is not a terminal, pipe the key on the first line and keep --api-url:",
    `printf '%s\\n' "$FACTROVE_API_KEY" | ${input.configureCommand}`,
    "",
    "Upload one .html or .htm file. Replace plan.html with the file I name:",
    input.uploadCommand,
    "Plain success prints only the artifact id. Add --json to print one JSON line. That line includes viewerUrl.",
    "",
    "Then tell me to refresh My artifacts, or open /artifacts/{id} using the printed id. viewerUrl is that same page.",
  ].join("\n");
}
