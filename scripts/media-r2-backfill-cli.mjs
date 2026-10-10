export function parseBackfillArgs(argv) {
  const args = new Set(argv);
  const values = new Map();

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index].startsWith("--") && argv[index + 1] && !argv[index + 1].startsWith("--")) {
      values.set(argv[index], argv[index + 1]);
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
