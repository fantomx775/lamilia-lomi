const BOOLEAN_FLAGS = new Set(["--apply", "--rollback", "--reconcile-public"]);
const VALUE_FLAGS = new Set([
  "--product-id",
  "--asset-id",
  "--confirm-project",
  "--confirm-r2-target",
  "--report-file",
]);

export function parseBackfillArgs(argv) {
  const args = new Set();
  const values = new Map();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${token}`);
    }

    const separator = token.indexOf("=");
    const flag = separator === -1 ? token : token.slice(0, separator);
    if (!BOOLEAN_FLAGS.has(flag) && !VALUE_FLAGS.has(flag)) {
      throw new Error(`Unknown option: ${flag}`);
    }
    args.add(flag);

    if (BOOLEAN_FLAGS.has(flag)) {
      if (separator !== -1) throw new Error(`${flag} does not accept a value.`);
      continue;
    }

    if (separator !== -1) {
      values.set(flag, token.slice(separator + 1));
    } else if (argv[index + 1] && !argv[index + 1].startsWith("--")) {
      values.set(flag, argv[index + 1]);
      index += 1;
    } else {
      throw new Error(`${flag} requires a value.`);
    }
  }

  return { args, values };
}

export function parseReconcileProductId(args, values) {
  if (!args.has("--product-id")) return undefined;

  const value = values.get("--product-id")?.trim();
  if (!value || !isUuid(value)) {
    throw new Error("--product-id requires a product UUID.");
  }

  return value.toLowerCase();
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
