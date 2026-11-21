/** A teardown timeout is a failure, never permission to skip fixture cleanup. */
export async function boundedOwnedRscTeardown<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Owned RSC teardown exceeded its five-second cleanup budget.")), 5000); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}
