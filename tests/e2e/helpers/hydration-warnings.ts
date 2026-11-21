const hydrationMismatchPrefix =
  "A tree hydrated but some attributes of the server rendered HTML didn't match the client properties";

/** Accept only React's exact one-property caret-color style mismatch. */
export function isKnownCaretOnlyHydrationWarning(message: string) {
  if (!message.startsWith(hydrationMismatchPrefix)) return false;

  const normalized = message.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
  const lines = normalized.split(/\r?\n/);
  const diffStart = lines.findIndex((line) => line.trim() === "...");
  if (diffStart < 0) return false;

  const changedAttributes = lines
    .slice(diffStart + 1)
    .filter((line) => /^\s*[+-]\s/.test(line))
    .map((line) => line.trim().replace(/^([+-])\s+/, "$1 "));
  return (
    changedAttributes.length === 1 &&
    changedAttributes[0] === '- style={{caret-color:"transparent"}}'
  );
}
