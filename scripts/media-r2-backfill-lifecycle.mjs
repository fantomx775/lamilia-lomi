export async function finalizePublicMediaBackfill({
  setPublicProvider,
  readCurrentAsset,
  beginPublicRevocation,
  deletePublicObject,
  setPrivateProvider,
  setPendingProvider,
  restorePublicObject,
  hasOtherEligibleReference = async () => false,
}) {
  let promotionError;
  try {
    await setPublicProvider();
  } catch (error) {
    promotionError = error;
  }

  let current;
  try {
    current = await readCurrentAsset();
  } catch (readError) {
    throw new Error(
      "Could not confirm the final media provider after public promotion. The verified public copy was retained; inspect the provider state before retrying.",
      { cause: promotionError ?? readError },
    );
  }

  const isEligibleForPublicDelivery = Boolean(
    current?.productStatus === "published" &&
    current.isActive === true &&
    current.isPublic === true,
  );

  if (isEligibleForPublicDelivery && current.storageProvider === "r2_public") {
    return;
  }
  promotionError ??= new Error("The provider update returned without a currently eligible public R2 asset.");

  if (current?.storageProvider === "r2_public_revoking") {
    if (await hasSharedEligibleReference(hasOtherEligibleReference, readCurrentAsset, current)) {
      throw new Error(
        "A late public R2 copy was retained because another eligible asset still uses this key; the active revocation owner must reconcile it.",
        { cause: promotionError },
      );
    }
    try {
      // The active revoker may have deleted the object before an in-flight
      // copy completed. The revocation fence prevents a new promotion, so
      // remove the late copy while leaving the state transition to its owner.
      await deletePublicObject();
    } catch (cleanupError) {
      throw new Error(
        "A late public R2 copy could not be removed while revocation is in progress. The provider remains r2_public_revoking for retry.",
        { cause: cleanupError },
      );
    }
    throw promotionError;
  }

  if (isEligibleForPublicDelivery) {
    // The object is valid public media, but the state change needs a retry.
    // Retain the verified copy rather than risk deleting it after a timeout.
    throw promotionError;
  }

  if (current) {
    const revocationStarted = await beginPublicRevocation();
    if (!revocationStarted) {
      throw new Error(
        "The asset changed while public promotion was being finalized. The verified public copy was retained for the active reconciliation to inspect.",
        { cause: promotionError },
      );
    }
  }

  if (await hasSharedEligibleReference(hasOtherEligibleReference, readCurrentAsset, current)) {
    if (current) {
      try {
        await setPrivateProvider();
      } catch (cleanupError) {
        throw new Error(
          "The shared public R2 object was retained for another eligible asset, but the current row could not be returned to private.",
          { cause: cleanupError },
        );
      }
    }
    throw new Error(
      "The public R2 object was retained because another eligible asset still uses this key; the current row remains private.",
      { cause: promotionError },
    );
  }

  try {
    await deletePublicObject();
  } catch (cleanupError) {
    throw new Error(
      "The product is no longer eligible for public media, but its public R2 copy could not be removed. The provider remains r2_public_revoking for retry.",
      { cause: cleanupError },
    );
  }

  if (
    current &&
    (current.storageProvider === "r2_public" || current.storageProvider === "r2_public_pending" || current.storageProvider === "r2_public_revoking")
  ) {
    try {
      await setPrivateProvider();
    } catch (cleanupError) {
      throw new Error(
        "The public R2 copy was removed, but the provider reset could not be confirmed. Inspect provider state before retrying.",
        { cause: cleanupError },
      );
    }
  }

  if (current) {
    let latest;
    try {
      latest = await readCurrentAsset();
    } catch (readError) {
      throw new Error(
        "The public copy was removed and the provider returned to private, but current publication eligibility could not be checked.",
        { cause: readError },
      );
    }
    const isEligibleAgain = Boolean(
      latest?.productStatus === "published" &&
      latest.isActive === true &&
      latest.isPublic === true,
    );
    if (isEligibleAgain && latest.storageProvider === "r2_private") {
      let publicCopyVerified = false;
      try {
        await setPendingProvider();
        await restorePublicObject();
        publicCopyVerified = true;
        await setPublicProvider();
        const restored = await readCurrentAsset();
        if (
          restored?.storageProvider === "r2_public" &&
          restored.productStatus === "published" &&
          restored.isActive === true &&
          restored.isPublic === true
        ) {
          return;
        }
        throw new Error("The restored public provider is no longer eligible after its database update.");
      } catch (restoreError) {
        await cleanupFailedPublicRestore({
          restoreError,
          publicCopyVerified,
          readCurrentAsset,
          beginPublicRevocation,
          deletePublicObject,
          setPrivateProvider,
          hasOtherEligibleReference,
        });
      }
    }
  }

  throw promotionError;
}

export async function cleanupFailedPublicBackfill({
  readCurrentAsset,
  hasOtherEligibleReference,
  beginPublicRevocation,
  deletePublicObject,
  setPrivateProvider,
}) {
  let current;
  try {
    current = await readCurrentAsset();
  } catch (readError) {
    throw await cleanupFailure(
      "Could not read the asset before public-object cleanup. Deletion was not attempted; the public URL may remain reachable.",
      readError,
      readCurrentAsset,
    );
  }

  if (await hasSharedEligibleReference(hasOtherEligibleReference, readCurrentAsset, current)) {
    throw new Error(
      `Public-object deletion was skipped because another eligible asset uses this key; its public URL may remain reachable. Provider observed after cleanup: ${providerLabel(current)}.`,
    );
  }

  if (current?.storageProvider === "r2_public_revoking") {
    await deleteLatePublicObject({ deletePublicObject, readCurrentAsset, fenceOwner: "active revoker" });
    return;
  }

  if (!current) {
    await deleteLatePublicObject({ deletePublicObject, readCurrentAsset, fenceOwner: "no matching row" });
    return;
  }

  let ownsRevocationFence = false;
  try {
    ownsRevocationFence = await beginPublicRevocation();
  } catch (fenceError) {
    throw await cleanupFailure(
      "Could not acquire the public revocation fence. Deletion was not attempted; the public URL may remain reachable.",
      fenceError,
      readCurrentAsset,
    );
  }

  if (!ownsRevocationFence) {
    try {
      current = await readCurrentAsset();
    } catch (readError) {
      throw await cleanupFailure(
        "Revocation-fence acquisition was inconclusive. Deletion was not attempted; the public URL may remain reachable.",
        readError,
        readCurrentAsset,
      );
    }
    if (await hasSharedEligibleReference(hasOtherEligibleReference, readCurrentAsset, current)) {
      throw new Error(
        `Public-object deletion was skipped because another eligible asset uses this key; its public URL may remain reachable. Provider observed after cleanup: ${providerLabel(current)}.`,
      );
    }
    if (current?.storageProvider === "r2_public_revoking") {
      await deleteLatePublicObject({ deletePublicObject, readCurrentAsset, fenceOwner: "active revoker" });
      return;
    }
    if (!current) {
      await deleteLatePublicObject({ deletePublicObject, readCurrentAsset, fenceOwner: "no matching row" });
      return;
    }
    throw await cleanupFailure(
      "Could not confirm ownership of a public revocation fence. Deletion was not attempted; the public URL may remain reachable.",
      undefined,
      readCurrentAsset,
    );
  }

  if (await hasSharedEligibleReference(hasOtherEligibleReference, readCurrentAsset, current)) {
    try {
      await setPrivateProvider();
    } catch (providerError) {
      throw await cleanupFailure(
        "A same-key eligible asset was found, so its public object was retained. The current row could not be returned to private.",
        providerError,
        readCurrentAsset,
      );
    }
    throw new Error(
      `Public-object deletion was skipped because another eligible asset uses this key. The current row was returned to private; the shared public URL remains reachable for the eligible reference. Provider observed after cleanup: ${await observedProvider(readCurrentAsset)}.`,
    );
  }

  try {
    await deletePublicObject();
  } catch (deleteError) {
    throw await cleanupFailure(
      "Public-object deletion is unconfirmed; its public URL may remain reachable. The revocation fence is preserved for retry.",
      deleteError,
      readCurrentAsset,
    );
  }

  try {
    await setPrivateProvider();
  } catch (providerError) {
    throw await cleanupFailure(
      "Public-object deletion was confirmed, but the provider transition failed. The revocation fence is preserved for retry.",
      providerError,
      readCurrentAsset,
    );
  }
}

async function hasSharedEligibleReference(hasOtherEligibleReference, readCurrentAsset, current) {
  try {
    return await hasOtherEligibleReference();
  } catch (referenceError) {
    throw await cleanupFailure(
      "Could not confirm whether another eligible asset uses this key. Public-object deletion was not attempted; its public URL may remain reachable.",
      referenceError,
      readCurrentAsset,
      current,
    );
  }
}

async function deleteLatePublicObject({ deletePublicObject, readCurrentAsset, fenceOwner }) {
  try {
    await deletePublicObject();
  } catch (deleteError) {
    throw await cleanupFailure(
      `Public-object deletion is unconfirmed; its public URL may remain reachable. The ${fenceOwner} provider state is preserved for retry.`,
      deleteError,
      readCurrentAsset,
    );
  }
}

async function cleanupFailure(message, cause, readCurrentAsset, fallbackCurrent) {
  const currentProvider = await observedProvider(readCurrentAsset, fallbackCurrent);
  return new Error(`${message} Provider observed after cleanup: ${currentProvider}.`, cause ? { cause } : undefined);
}

async function observedProvider(readCurrentAsset, fallbackCurrent) {
  try {
    const current = await readCurrentAsset();
    return providerLabel(current);
  } catch {
    return providerLabel(fallbackCurrent) === "row_missing" ? "unknown" : providerLabel(fallbackCurrent);
  }
}

function providerLabel(current) {
  return current?.storageProvider ?? (current === null ? "row_missing" : "unknown");
}

async function cleanupFailedPublicRestore({
  restoreError,
  publicCopyVerified,
  readCurrentAsset,
  beginPublicRevocation,
  deletePublicObject,
  setPrivateProvider,
  hasOtherEligibleReference = async () => false,
}) {
  let current;
  try {
    current = await readCurrentAsset();
  } catch (readError) {
    throw new Error(
      "Public restore failed and current eligibility could not be confirmed. The object was retained for reconciliation.",
      { cause: readError },
    );
  }

  const isEligibleForPublicDelivery = Boolean(
    current?.storageProvider !== "r2_public_revoking" &&
    current?.productStatus === "published" &&
    current.isActive === true &&
    current.isPublic === true,
  );
  if (
    isEligibleForPublicDelivery &&
    (publicCopyVerified || current?.storageProvider === "r2_public")
  ) {
    throw new Error(
      "Public restore failed while the asset remains eligible. The public copy was retained for retry.",
      { cause: restoreError },
    );
  }

  let ownsRevocationFence = false;
  if (current && current.storageProvider !== "r2_public_revoking") {
    try {
      ownsRevocationFence = await beginPublicRevocation();
    } catch (fenceError) {
      throw new Error(
        "Public restore failed and the cleanup revocation fence could not be confirmed. The object was retained for reconciliation.",
        { cause: fenceError },
      );
    }

    if (!ownsRevocationFence) {
      try {
        current = await readCurrentAsset();
      } catch (readError) {
        throw new Error(
          "Public restore failed and the cleanup fence raced with another update. The object was retained for reconciliation.",
          { cause: readError },
        );
      }
      const latestIsEligible = Boolean(
        current?.storageProvider !== "r2_public_revoking" &&
        current?.productStatus === "published" &&
        current.isActive === true &&
        current.isPublic === true,
      );
      if (
        latestIsEligible &&
        (publicCopyVerified || current?.storageProvider === "r2_public")
      ) {
        throw new Error(
          "Public restore failed while the asset remains eligible. The public copy was retained for retry.",
          { cause: restoreError },
        );
      }
      if (current?.storageProvider !== "r2_public_revoking" && current != null) {
        throw new Error(
          "Public restore failed and cleanup could not acquire the revocation fence. The object was retained for reconciliation.",
          { cause: restoreError },
        );
      }
    }
  }

  if (await hasSharedEligibleReference(hasOtherEligibleReference, readCurrentAsset, current)) {
    if (ownsRevocationFence) {
      try {
        await setPrivateProvider();
      } catch (providerError) {
        throw new Error(
          "A shared public R2 object was retained for another eligible asset, but the current row remains fenced for retry.",
          { cause: providerError },
        );
      }
    }
    throw new Error(
      "The public R2 object was retained for another eligible asset after public restore failed.",
      { cause: restoreError },
    );
  }

  try {
    await deletePublicObject();
  } catch (cleanupError) {
    throw new Error(
      "Public restore failed and its late copy could not be removed. The provider remains fenced for retry.",
      { cause: cleanupError },
    );
  }

  if (ownsRevocationFence) {
    try {
      await setPrivateProvider();
    } catch (providerError) {
      throw new Error(
        "The late public copy was removed, but the provider remains r2_public_revoking for retry.",
        { cause: providerError },
      );
    }
  }

  throw new Error(
    "Public restore failed and its late copy was removed. The private-serving provider state can be retried.",
    { cause: restoreError },
  );
}

export async function reconcilePublicProductImages({
  listPublicKeys,
  eligiblePublicPaths,
  preparePublicObjectDeletion,
  deletePublicObject,
  apply,
}) {
  const stalePaths = [];
  const retainedPaths = [];
  const publicPaths = new Set();
  let scannedObjects = 0;

  for await (const page of listPublicKeys()) {
    for (const key of page) {
      if (!isPublicProductImagePath(key)) continue;
      scannedObjects += 1;
      publicPaths.add(key);
      const initiallyEligible = eligiblePublicPaths.has(key);

      if (apply && preparePublicObjectDeletion) {
        if (!(await preparePublicObjectDeletion(key))) {
          if (!initiallyEligible) retainedPaths.push(key);
          continue;
        }
      } else if (initiallyEligible) {
        continue;
      }

      stalePaths.push(key);
      if (apply) await deletePublicObject(key);
    }
  }

  return { scannedObjects, stalePaths, retainedPaths, publicPaths: [...publicPaths] };
}

export async function verifyAlreadyPublicBackfill({ storageProvider, verifyPublicCopy }) {
  if (storageProvider !== "r2_public") return false;
  await verifyPublicCopy();
  return true;
}

export async function rollbackPublicMediaAsset({
  storageProvider,
  hasOtherEligibleReference = async () => false,
  beginPublicRevocation,
  deletePublicObject,
  setPrivateProvider,
  setSupabaseProvider,
}) {
  if (storageProvider === "r2_public_revoking") {
    throw new Error("The asset already has an unfinished R2 public revocation. Reconcile public media before retrying rollback.");
  }

  if (storageProvider !== "supabase") {
    const revocationStarted = await beginPublicRevocation();
    if (!revocationStarted) {
      throw new Error("Could not acquire the R2 public revocation fence. No public object was changed; reconcile public media before retrying rollback.");
    }
  }

  const sharedPublicReference = await hasOtherEligibleReference();
  if (!sharedPublicReference) await deletePublicObject();
  if (storageProvider !== "supabase") await setPrivateProvider();
  await setSupabaseProvider();
  return { publicObjectDeleted: !sharedPublicReference };
}

export function assertR2TargetConfirmation({ confirmedTarget, accountId, privateBucket, publicBucket }) {
  const expectedTarget = `${accountId}/${privateBucket}/${publicBucket}`;
  if (confirmedTarget !== expectedTarget) {
    throw new Error(`Write mode requires --confirm-r2-target ${expectedTarget} for R2 account ${accountId}, private bucket ${privateBucket}, public bucket ${publicBucket}. No credentials or objects were changed.`);
  }
}

function isPublicProductImagePath(value) {
  if (typeof value !== "string") return false;

  const parts = value.split("/");
  return (
    parts.length === 4 &&
    parts[0] === "products" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parts[1]) &&
    (parts[2] === "cover" || parts[2] === "gallery") &&
    parts.every((part) => part.length > 0 && part !== "." && part !== "..")
  );
}
