import { describe, expect, it, vi } from "vitest";

import {
  assertR2TargetConfirmation,
  cleanupFailedPublicBackfill,
  finalizePublicMediaBackfill,
  reconcilePublicProductImages,
  rollbackPublicMediaAsset,
  verifyAlreadyPublicBackfill,
} from "./media-r2-backfill-lifecycle.mjs";

describe("cleanupFailedPublicBackfill", () => {
  it("preserves an active revocation owner and removes the failed late copy", async () => {
    const events = [];
    const setPrivateProvider = vi.fn();

    await expect(cleanupFailedPublicBackfill({
      readCurrentAsset: vi.fn().mockResolvedValue({ storageProvider: "r2_public_revoking" }),
      hasOtherEligibleReference: vi.fn().mockResolvedValue(false),
      beginPublicRevocation: vi.fn(),
      deletePublicObject: vi.fn(async () => events.push("deleted")),
      setPrivateProvider,
    })).resolves.toBeUndefined();

    expect(events).toEqual(["deleted"]);
    expect(setPrivateProvider).not.toHaveBeenCalled();
  });

  it("acquires a fence before cleanup for other provider states", async () => {
    const events = [];

    await expect(cleanupFailedPublicBackfill({
      readCurrentAsset: vi.fn().mockResolvedValue({ storageProvider: "r2_public_pending" }),
      hasOtherEligibleReference: vi.fn().mockResolvedValue(false),
      beginPublicRevocation: vi.fn(async () => { events.push("fenced"); return true; }),
      deletePublicObject: vi.fn(async () => events.push("deleted")),
      setPrivateProvider: vi.fn(async () => events.push("private")),
    })).resolves.toBeUndefined();

    expect(events).toEqual(["fenced", "deleted", "private"]);
  });

  it("keeps the fence and reports unconfirmed deletion when cleanup fails", async () => {
    const current = { storageProvider: "r2_public_revoking" };
    const setPrivateProvider = vi.fn();

    await expect(cleanupFailedPublicBackfill({
      readCurrentAsset: vi.fn().mockResolvedValue(current),
      hasOtherEligibleReference: vi.fn().mockResolvedValue(false),
      beginPublicRevocation: vi.fn(),
      deletePublicObject: vi.fn().mockRejectedValue(new Error("R2 delete failed")),
      setPrivateProvider,
    })).rejects.toThrow(/deletion is unconfirmed.*public URL may remain reachable.*provider observed after cleanup: r2_public_revoking/i);

    expect(setPrivateProvider).not.toHaveBeenCalled();
  });

  it("does not delete a key referenced by another eligible public asset", async () => {
    const deletePublicObject = vi.fn();
    const setPrivateProvider = vi.fn();

    await expect(cleanupFailedPublicBackfill({
      readCurrentAsset: vi.fn().mockResolvedValue({ storageProvider: "r2_public_pending" }),
      hasOtherEligibleReference: vi.fn().mockResolvedValue(true),
      beginPublicRevocation: vi.fn(),
      deletePublicObject,
      setPrivateProvider,
    })).rejects.toThrow(/another eligible asset uses this key.*public URL may remain reachable/i);

    expect(deletePublicObject).not.toHaveBeenCalled();
    expect(setPrivateProvider).not.toHaveBeenCalled();
  });
});

describe("assertR2TargetConfirmation", () => {
  it("requires the exact account and private and public buckets", () => {
    expect(() => assertR2TargetConfirmation({
      confirmedTarget: "account-123/private-media/public-media",
      accountId: "account-123",
      privateBucket: "private-media",
      publicBucket: "public-media",
    })).not.toThrow();

    expect(() => assertR2TargetConfirmation({
      confirmedTarget: "account-123/private-media/other-bucket",
      accountId: "account-123",
      privateBucket: "private-media",
      publicBucket: "public-media",
    })).toThrow("--confirm-r2-target account-123/private-media/public-media");
  });
});

describe("finalizePublicMediaBackfill", () => {
  it("rechecks publication eligibility after the provider RPC reports success", async () => {
    const events = [];
    const readCurrentAsset = vi.fn()
      .mockResolvedValueOnce({
        storageProvider: "r2_public",
        productStatus: "archived",
        isActive: true,
        isPublic: true,
      })
      .mockResolvedValueOnce({
        storageProvider: "r2_private",
        productStatus: "archived",
        isActive: true,
        isPublic: true,
      });

    await expect(finalizePublicMediaBackfill({
      setPublicProvider: vi.fn().mockResolvedValue(undefined),
      readCurrentAsset,
      beginPublicRevocation: vi.fn(async () => { events.push("fenced"); return true; }),
      deletePublicObject: vi.fn(async () => events.push("deleted")),
      setPrivateProvider: vi.fn(async () => events.push("private")),
    })).rejects.toThrow("provider update returned without a currently eligible public R2 asset");

    expect(events).toEqual(["fenced", "deleted", "private"]);
    expect(readCurrentAsset).toHaveBeenCalledTimes(2);
  });

  it("removes the public copy and returns the provider to private after an archive race", async () => {
    const promotionError = new Error("Product is not published");
    const setPublicProvider = vi.fn().mockRejectedValue(promotionError);
    const readCurrentAsset = vi.fn().mockResolvedValue({
      storageProvider: "r2_public_pending",
      productStatus: "archived",
      isActive: true,
      isPublic: true,
    });
    const deletePublicObject = vi.fn().mockResolvedValue(undefined);
    const setPrivateProvider = vi.fn().mockResolvedValue(undefined);

    await expect(finalizePublicMediaBackfill({
      setPublicProvider,
      readCurrentAsset,
      beginPublicRevocation: vi.fn().mockResolvedValue(true),
      deletePublicObject,
      setPrivateProvider,
    })).rejects.toBe(promotionError);

    expect(deletePublicObject).toHaveBeenCalledOnce();
    expect(setPrivateProvider).toHaveBeenCalledOnce();
  });

  it("retains the shared public object when another eligible asset uses the same key", async () => {
    const deletePublicObject = vi.fn();
    const setPrivateProvider = vi.fn().mockResolvedValue(undefined);

    await expect(finalizePublicMediaBackfill({
      setPublicProvider: vi.fn().mockRejectedValue(new Error("Product is archived")),
      readCurrentAsset: vi.fn().mockResolvedValue({
        storageProvider: "r2_public_pending",
        productStatus: "archived",
        isActive: true,
        isPublic: true,
      }),
      beginPublicRevocation: vi.fn().mockResolvedValue(true),
      deletePublicObject,
      setPrivateProvider,
      hasOtherEligibleReference: vi.fn().mockResolvedValue(true),
    })).rejects.toThrow("retained because another eligible asset still uses this key");

    expect(deletePublicObject).not.toHaveBeenCalled();
    expect(setPrivateProvider).toHaveBeenCalledOnce();
  });

  it("retains a late copy for another eligible asset while an existing revoker owns the fence", async () => {
    const deletePublicObject = vi.fn();

    await expect(finalizePublicMediaBackfill({
      setPublicProvider: vi.fn().mockRejectedValue(new Error("Product is archived")),
      readCurrentAsset: vi.fn().mockResolvedValue({
        storageProvider: "r2_public_revoking",
        productStatus: "archived",
        isActive: true,
        isPublic: true,
      }),
      beginPublicRevocation: vi.fn(),
      deletePublicObject,
      setPrivateProvider: vi.fn(),
      hasOtherEligibleReference: vi.fn().mockResolvedValue(true),
    })).rejects.toThrow("another eligible asset still uses this key");

    expect(deletePublicObject).not.toHaveBeenCalled();
  });

  it("removes an orphaned public copy when the asset row was deleted", async () => {
    const promotionError = new Error("Asset row no longer exists");
    const deletePublicObject = vi.fn().mockResolvedValue(undefined);
    const setPrivateProvider = vi.fn();

    await expect(finalizePublicMediaBackfill({
      setPublicProvider: vi.fn().mockRejectedValue(promotionError),
      readCurrentAsset: vi.fn().mockResolvedValue(null),
      beginPublicRevocation: vi.fn(),
      deletePublicObject,
      setPrivateProvider,
    })).rejects.toBe(promotionError);

    expect(deletePublicObject).toHaveBeenCalledOnce();
    expect(setPrivateProvider).not.toHaveBeenCalled();
  });

  it("retains the object when the database already committed the public provider", async () => {
    const deletePublicObject = vi.fn();
    const setPrivateProvider = vi.fn();

    await expect(finalizePublicMediaBackfill({
      setPublicProvider: vi.fn().mockRejectedValue(new Error("Response was lost")),
      readCurrentAsset: vi.fn().mockResolvedValue({
        storageProvider: "r2_public",
        productStatus: "published",
        isActive: true,
        isPublic: true,
      }),
      beginPublicRevocation: vi.fn(),
      deletePublicObject,
      setPrivateProvider,
    })).resolves.toBeUndefined();

    expect(deletePublicObject).not.toHaveBeenCalled();
    expect(setPrivateProvider).not.toHaveBeenCalled();
  });

  it("retains the object for a still-published asset when the provider update needs a retry", async () => {
    const promotionError = new Error("Provider update was rejected");
    const deletePublicObject = vi.fn();
    const setPrivateProvider = vi.fn();

    await expect(finalizePublicMediaBackfill({
      setPublicProvider: vi.fn().mockRejectedValue(promotionError),
      readCurrentAsset: vi.fn().mockResolvedValue({
        storageProvider: "r2_public_pending",
        productStatus: "published",
        isActive: true,
        isPublic: true,
      }),
      beginPublicRevocation: vi.fn(),
      deletePublicObject,
      setPrivateProvider,
    })).rejects.toBe(promotionError);

    expect(deletePublicObject).not.toHaveBeenCalled();
    expect(setPrivateProvider).not.toHaveBeenCalled();
  });

  it("leaves the row pending when public-object cleanup fails", async () => {
    const cleanupError = new Error("R2 delete failed");
    const setPrivateProvider = vi.fn();

    await expect(finalizePublicMediaBackfill({
      setPublicProvider: vi.fn().mockRejectedValue(new Error("Product is archived")),
      readCurrentAsset: vi.fn().mockResolvedValue({
        storageProvider: "r2_public_pending",
        productStatus: "archived",
        isActive: true,
        isPublic: true,
      }),
      beginPublicRevocation: vi.fn().mockResolvedValue(true),
      deletePublicObject: vi.fn().mockRejectedValue(cleanupError),
      setPrivateProvider,
    })).rejects.toThrow("provider remains r2_public_revoking");

    expect(setPrivateProvider).not.toHaveBeenCalled();
  });

  it("removes a public copy that finishes writing after an active revocation already deleted it", async () => {
    const events = [];
    const publicObject = { exists: true };
    events.push("revoker deleted the previous public copy");
    publicObject.exists = false;

    // A CopyObject request that started before the revocation fence can finish
    // after the revoker's DeleteObject request has already returned.
    events.push("backfill copy completed late");
    publicObject.exists = true;
    const deletePublicObject = vi.fn(async () => {
      events.push("backfill removed the late public copy");
      publicObject.exists = false;
    });
    const promotionError = new Error("Product is archived");
    const setPrivateProvider = vi.fn();

    await expect(finalizePublicMediaBackfill({
      setPublicProvider: vi.fn().mockRejectedValue(promotionError),
      readCurrentAsset: vi.fn().mockResolvedValue({
        storageProvider: "r2_public_revoking",
        productStatus: "archived",
        isActive: true,
        isPublic: true,
      }),
      beginPublicRevocation: vi.fn().mockResolvedValue(false),
      deletePublicObject,
      setPrivateProvider,
    })).rejects.toBe(promotionError);

    expect(events).toEqual([
      "revoker deleted the previous public copy",
      "backfill copy completed late",
      "backfill removed the late public copy",
    ]);
    expect(publicObject.exists).toBe(false);
    expect(deletePublicObject).toHaveBeenCalledOnce();
    expect(setPrivateProvider).not.toHaveBeenCalled();
  });

  it("keeps an active revocation retryable when deleting a late copy fails", async () => {
    const setPrivateProvider = vi.fn();

    await expect(finalizePublicMediaBackfill({
      setPublicProvider: vi.fn().mockRejectedValue(new Error("Product is archived")),
      readCurrentAsset: vi.fn().mockResolvedValue({
        storageProvider: "r2_public_revoking",
        productStatus: "archived",
        isActive: true,
        isPublic: true,
      }),
      beginPublicRevocation: vi.fn().mockResolvedValue(false),
      deletePublicObject: vi.fn().mockRejectedValue(new Error("R2 delete failed")),
      setPrivateProvider,
    })).rejects.toThrow("provider remains r2_public_revoking for retry");

    expect(setPrivateProvider).not.toHaveBeenCalled();
  });

  it("restores public delivery if the product becomes eligible during cleanup", async () => {
    const promotionError = new Error("Product is archived");
    const setPublicProvider = vi.fn()
      .mockRejectedValueOnce(promotionError)
      .mockResolvedValueOnce(undefined);
    const readCurrentAsset = vi.fn()
      .mockResolvedValueOnce({
        storageProvider: "r2_public_pending",
        productStatus: "archived",
        isActive: true,
        isPublic: true,
      })
      .mockResolvedValueOnce({
        storageProvider: "r2_private",
        productStatus: "published",
        isActive: true,
        isPublic: true,
      })
      .mockResolvedValueOnce({
        storageProvider: "r2_public",
        productStatus: "published",
        isActive: true,
        isPublic: true,
      });
    const beginPublicRevocation = vi.fn().mockResolvedValue(true);
    const deletePublicObject = vi.fn().mockResolvedValue(undefined);
    const setPrivateProvider = vi.fn().mockResolvedValue(undefined);
    const setPendingProvider = vi.fn().mockResolvedValue(undefined);
    const restorePublicObject = vi.fn().mockResolvedValue(undefined);

    await expect(finalizePublicMediaBackfill({
      setPublicProvider,
      readCurrentAsset,
      beginPublicRevocation,
      deletePublicObject,
      setPrivateProvider,
      setPendingProvider,
      restorePublicObject,
    })).resolves.toBeUndefined();

    expect(beginPublicRevocation).toHaveBeenCalledOnce();
    expect(deletePublicObject).toHaveBeenCalledOnce();
    expect(setPrivateProvider).toHaveBeenCalledOnce();
    expect(setPendingProvider).toHaveBeenCalledOnce();
    expect(restorePublicObject).toHaveBeenCalledOnce();
    expect(setPublicProvider).toHaveBeenCalledTimes(2);
  });

  it("removes a restore copy that finishes after a second revocation deletes it", async () => {
    const publicObject = { exists: true };
    const events = [];
    const setPublicProvider = vi.fn()
      .mockRejectedValueOnce(new Error("Product is archived"))
      .mockRejectedValueOnce(new Error("Product was archived again"));
    const readCurrentAsset = vi.fn()
      .mockResolvedValueOnce({
        storageProvider: "r2_public_pending",
        productStatus: "archived",
        isActive: true,
        isPublic: true,
      })
      .mockResolvedValueOnce({
        storageProvider: "r2_private",
        productStatus: "published",
        isActive: true,
        isPublic: true,
      })
      .mockResolvedValueOnce({
        storageProvider: "r2_public_revoking",
        productStatus: "archived",
        isActive: true,
        isPublic: true,
      });
    const deletePublicObject = vi.fn(async () => {
      events.push(publicObject.exists ? "deleted current public copy" : "deleted absent public copy");
      publicObject.exists = false;
    });

    await expect(finalizePublicMediaBackfill({
      setPublicProvider,
      readCurrentAsset,
      beginPublicRevocation: vi.fn().mockResolvedValue(true),
      deletePublicObject,
      setPrivateProvider: vi.fn(async () => events.push("returned provider to private")),
      setPendingProvider: vi.fn(async () => events.push("set pending for restored eligibility")),
      restorePublicObject: vi.fn(async () => {
        events.push("second revoker deleted the restore object");
        publicObject.exists = false;
        events.push("restore copy completed late");
        publicObject.exists = true;
      }),
    })).rejects.toThrow("late copy was removed");

    expect(events).toEqual([
      "deleted current public copy",
      "returned provider to private",
      "set pending for restored eligibility",
      "second revoker deleted the restore object",
      "restore copy completed late",
      "deleted current public copy",
    ]);
    expect(publicObject.exists).toBe(false);
    expect(deletePublicObject).toHaveBeenCalledTimes(2);
    expect(readCurrentAsset).toHaveBeenCalledTimes(3);
  });

  it("retains the verified object when the provider outcome cannot be read", async () => {
    const deletePublicObject = vi.fn();
    const promotionError = new Error("Response was lost");

    await expect(finalizePublicMediaBackfill({
      setPublicProvider: vi.fn().mockRejectedValue(promotionError),
      readCurrentAsset: vi.fn().mockRejectedValue(new Error("Database is unavailable")),
      beginPublicRevocation: vi.fn(),
      deletePublicObject,
      setPrivateProvider: vi.fn(),
    })).rejects.toThrow("verified public copy was retained; inspect the provider state");

    expect(deletePublicObject).not.toHaveBeenCalled();
  });
});

describe("verifyAlreadyPublicBackfill", () => {
  it("verifies an already-public asset without requesting another provider transition", async () => {
    const verifyPublicCopy = vi.fn().mockResolvedValue(undefined);

    await expect(verifyAlreadyPublicBackfill({
      storageProvider: "r2_public",
      verifyPublicCopy,
    })).resolves.toBe(true);

    expect(verifyPublicCopy).toHaveBeenCalledOnce();
  });

  it("leaves other provider states on the normal promotion path", async () => {
    const verifyPublicCopy = vi.fn();

    await expect(verifyAlreadyPublicBackfill({
      storageProvider: "r2_private",
      verifyPublicCopy,
    })).resolves.toBe(false);

    expect(verifyPublicCopy).not.toHaveBeenCalled();
  });
});

describe("rollbackPublicMediaAsset", () => {
  it("fences a public row, deletes the public copy, then moves through private to Supabase", async () => {
    const events = [];

    await rollbackPublicMediaAsset({
      storageProvider: "r2_public",
      beginPublicRevocation: vi.fn(async () => { events.push("revoking"); return true; }),
      deletePublicObject: vi.fn(async () => { events.push("deleted"); }),
      setPrivateProvider: vi.fn(async () => { events.push("private"); }),
      setSupabaseProvider: vi.fn(async () => { events.push("supabase"); }),
    });

    expect(events).toEqual(["revoking", "deleted", "private", "supabase"]);
  });

  it("keeps a public object used by another eligible R2 asset during rollback", async () => {
    const events = [];

    await expect(rollbackPublicMediaAsset({
      storageProvider: "r2_public",
      hasOtherEligibleReference: vi.fn().mockResolvedValue(true),
      beginPublicRevocation: vi.fn(async () => { events.push("revoking"); return true; }),
      deletePublicObject: vi.fn(async () => { events.push("deleted"); }),
      setPrivateProvider: vi.fn(async () => { events.push("private"); }),
      setSupabaseProvider: vi.fn(async () => { events.push("supabase"); }),
    })).resolves.toEqual({ publicObjectDeleted: false });

    expect(events).toEqual(["revoking", "private", "supabase"]);
  });

  it("does not change the public object when revocation is already unfinished", async () => {
    const deletePublicObject = vi.fn();

    await expect(rollbackPublicMediaAsset({
      storageProvider: "r2_public_revoking",
      beginPublicRevocation: vi.fn(),
      deletePublicObject,
      setPrivateProvider: vi.fn(),
      setSupabaseProvider: vi.fn(),
    })).rejects.toThrow("unfinished R2 public revocation");

    expect(deletePublicObject).not.toHaveBeenCalled();
  });
});

describe("reconcilePublicProductImages", () => {
  const eligiblePath = "products/11111111-1111-4111-8111-111111111111/cover/active.jpg";
  const archivedPath = "products/11111111-1111-4111-8111-111111111111/cover/archived.jpg";
  const deletedPath = "products/22222222-2222-4222-8222-222222222222/gallery/deleted.webp";

  it("reports stale image objects during the dry run without deleting them", async () => {
    const deletePublicObject = vi.fn();
    const listPublicKeys = async function* () {
      yield [eligiblePath, archivedPath];
      yield [deletedPath, "products/11111111-1111-4111-8111-111111111111/premium_download/private.pdf"];
    };

    await expect(reconcilePublicProductImages({
      listPublicKeys,
      eligiblePublicPaths: new Set([eligiblePath]),
      deletePublicObject,
      apply: false,
    })).resolves.toEqual({
      scannedObjects: 3,
      stalePaths: [archivedPath, deletedPath],
      retainedPaths: [],
      publicPaths: [eligiblePath, archivedPath, deletedPath],
    });

    expect(deletePublicObject).not.toHaveBeenCalled();
  });

  it("deletes stale image objects only when apply mode is enabled", async () => {
    const deletePublicObject = vi.fn().mockResolvedValue(undefined);
    const listPublicKeys = async function* () {
      yield [eligiblePath, archivedPath, deletedPath];
    };

    await expect(reconcilePublicProductImages({
      listPublicKeys,
      eligiblePublicPaths: new Set([eligiblePath]),
      deletePublicObject,
      apply: true,
    })).resolves.toEqual({
      scannedObjects: 3,
      stalePaths: [archivedPath, deletedPath],
      retainedPaths: [],
      publicPaths: [eligiblePath, archivedPath, deletedPath],
    });

    expect(deletePublicObject.mock.calls).toEqual([[archivedPath], [deletedPath]]);
  });

  it("rechecks stale paths before apply and retains one that became eligible", async () => {
    const deletePublicObject = vi.fn().mockResolvedValue(undefined);
    const preparePublicObjectDeletion = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const listPublicKeys = async function* () {
      yield [eligiblePath, archivedPath, deletedPath];
    };

    await expect(reconcilePublicProductImages({
      listPublicKeys,
      eligiblePublicPaths: new Set([eligiblePath]),
      preparePublicObjectDeletion,
      deletePublicObject,
      apply: true,
    })).resolves.toEqual({
      scannedObjects: 3,
      stalePaths: [deletedPath],
      retainedPaths: [archivedPath],
      publicPaths: [eligiblePath, archivedPath, deletedPath],
    });

    expect(preparePublicObjectDeletion.mock.calls).toEqual([[eligiblePath], [archivedPath], [deletedPath]]);
    expect(deletePublicObject.mock.calls).toEqual([[deletedPath]]);
  });
});
