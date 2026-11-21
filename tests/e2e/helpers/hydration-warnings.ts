const hydrationMismatchPrefix =
  "A tree hydrated but some attributes of the server rendered HTML didn't match the client properties";

/** Accept only React's exact one-property caret-color style mismatch. */
export function isKnownCaretOnlyHydrationWarning(message: string) {
  if (!message.startsWith(hydrationMismatchPrefix)) return false;

  const changedAttributes = message
    .split(/\r?\n/)
    .filter((line) => /^\s*[+-]\s/.test(line));
  if (changedAttributes.length !== 2) return false;

  const isCaretColorStyle = (line: string) =>
    /^\s*[+-]\s*style=\{\{\s*caretColor:\s*(?:undefined|null|"[^"]*"|'[^']*')\s*\}\}\s*$/.test(line) ||
    /^\s*[+-]\s*caret-color:\s*[^;\s]+;?\s*$/.test(line);

  return (
    changedAttributes.some((line) => line.trimStart().startsWith("+ ")) &&
    changedAttributes.some((line) => line.trimStart().startsWith("- ")) &&
    changedAttributes.every(isCaretColorStyle)
  );
}
