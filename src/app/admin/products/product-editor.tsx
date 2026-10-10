"use client";

import { Archive, FileText, ImagePlus, LoaderCircle, MoveDown, MoveUp, Plus, RotateCcw, Save, Star, Trash2, Undo2, Video, X } from "lucide-react";
import { startTransition, useActionState, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";

import { registerProductEditorPopStateGuard } from "@/app/admin/admin-product-editor-history-guard";
import { AdminEditorHeader, AdminEditorSection } from "@/components/admin/admin-editor-foundation";
import { AdminDisclosure } from "@/components/admin/admin-disclosure";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClassName } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ADMIN_ERROR_CODES, getAdminErrorMessage, type AdminErrorCode, type AdminMutationResult } from "@/lib/admin-errors";
import { MAX_GALLERY_ASSETS, MEDIA_UPLOAD_SPECS, formatBytes, validateMediaFile } from "@/lib/media-upload";
import { getMediaErrorMessage, getMediaUploadErrorMessage, uploadMedia, type SignedMediaUploadTarget } from "@/lib/media-upload-client";
import { MAX_PREMIUM_CODE_LENGTH, validatePremiumCodeEntries } from "@/lib/premium-code";
import {
  PRODUCT_SHORT_DESCRIPTION_MAX_LENGTH,
  PRODUCT_TEXT_WARNING_THRESHOLD,
  PRODUCT_TITLE_MAX_LENGTH,
  validateProductTextLengths,
} from "@/lib/product-text";
import { emptyProductSaveFormState, type ProductSaveFormState } from "@/lib/product-save-form-state";
import type { AmazonLink, Category, Product, ProductAsset, Tag } from "@/lib/types";

type ProductContentDraft = {
  title: string;
  shortDescription: string;
  longDescription: string;
  seoTitle: string;
  seoDescription: string;
};

type AssetDraft = {
  clientId: string;
  id: string;
  kind: ProductAsset["kind"];
  bucket: string;
  path: string;
  storagePath?: string;
  storageProvider?: ProductAsset["storageProvider"];
  filename: string;
  contentType: string;
  sizeBytes?: number;
  title: string;
  sortOrder: number;
  removed: boolean;
  status: UploadStatus;
  error?: string;
  file?: File;
  uploaded?: boolean;
  upload?: SignedMediaUploadTarget;
  progress?: number;
};

function sortGalleryAssets(assets: AssetDraft[]) {
  return assets.slice().sort((left, right) => left.sortOrder - right.sortOrder);
}

type AmazonDraft = {
  clientId: string;
  id: string;
  market: AmazonLink["market"];
  url: string;
  isPrimary: boolean;
  removed: boolean;
};

const amazonMarketOptions: ReadonlyArray<{ value: AmazonLink["market"]; label: string }> = [
  { value: "amazon.com", label: "Amazon.com" },
  { value: "amazon.de", label: "Amazon.de" },
];

type PremiumDraft = {
  clientId: string;
  id: string;
  code: string;
  active: boolean;
  removed: boolean;
};

const productTypes = ["coloring-book", "picture-book", "audiobook"];

type UploadStatus = "queued" | "uploading" | "uploaded" | "failed";

type ProductEditorHistoryGuard = {
  owner: string;
  role: "base" | "guard";
  forwardHref?: string;
};

type ProductEditorNavigateEvent = Event & {
  navigationType?: string;
  destination?: { url?: string };
};

type ProductEditorNavigation = {
  addEventListener(type: "navigate", listener: (event: ProductEditorNavigateEvent) => void): void;
  removeEventListener(type: "navigate", listener: (event: ProductEditorNavigateEvent) => void): void;
};

type ProductEditorWindow = Window & { navigation?: ProductEditorNavigation };

type ProductSaveFormAction = (
  previousState: ProductSaveFormState,
  formData: FormData,
) => Promise<ProductSaveFormState>;

async function keepProductSaveFormState(state: ProductSaveFormState) {
  return state;
}

const productEditorHistoryGuardKey = "__lamiliaProductEditorHistoryGuard";

const statusLabels = {
  draft: "Szkic",
  published: "Opublikowany",
  archived: "Zarchiwizowany",
} as const;

export function ProductEditor({
  title,
  product,
  categories,
  tags,
  feedback,
  saveAction,
  saveFormAction,
  archiveAction,
  deleteAction,
}: {
  title: string;
  product?: Product;
  categories: Category[];
  tags: Tag[];
  feedback?: string;
  saveAction?: (formData: FormData) => Promise<AdminMutationResult>;
  saveFormAction?: ProductSaveFormAction;
  archiveAction?: (formData: FormData) => void | Promise<void>;
  deleteAction?: (formData: FormData) => void | Promise<void>;
}) {
  const router = useRouter();
  const formPermalink = product ? `/admin/products/${product.id}` : "/admin/products/new";
  const [nativeSaveState, nativeSaveFormAction] = useActionState(
    saveFormAction ?? keepProductSaveFormState,
    emptyProductSaveFormState,
    formPermalink,
  );
  const submittedValues = nativeSaveState.values;
  const [content, setContent] = useState<ProductContentDraft>(() => buildProductContent(product, submittedValues));
  const [assets, setAssets] = useState<AssetDraft[]>(() => buildAssets(product, submittedValues));
  const [draftProductId, setDraftProductId] = useState(() => submittedValue(submittedValues, "id", product?.id ?? createClientId()));
  const [productSlug, setProductSlug] = useState(() => submittedValue(submittedValues, "slug", product?.slug ?? ""));
  const [productStatus, setProductStatus] = useState<Product["status"]>(() => parseProductStatus(submittedValue(submittedValues, "status", product?.status ?? "draft")));
  const [createdProductHref, setCreatedProductHref] = useState<string | null>(null);
  const [showRouteFeedback, setShowRouteFeedback] = useState(Boolean(feedback));
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle");
  const [saveBarRoot, setSaveBarRoot] = useState<HTMLElement | null>(null);
  const [saveErrorCodes, setSaveErrorCodes] = useState<AdminErrorCode[]>(() => nativeSaveState.errors);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [mediaErrors, setMediaErrors] = useState<Partial<Record<ProductAsset["kind"], string>>>({});
  const [amazonLinks, setAmazonLinks] = useState<AmazonDraft[]>(() => buildAmazonLinks(product, submittedValues));
  const [premiumCodes, setPremiumCodes] = useState<PremiumDraft[]>(() => buildPremiumCodes(product, submittedValues));
  const [premiumErrors, setPremiumErrors] = useState<Partial<Record<string, AdminErrorCode>>>({});
  const formRef = useRef<HTMLFormElement>(null);
  const savedFormSignatureRef = useRef<string | null>(null);
  const isDirtyRef = useRef(false);
  const navigationApiAvailableRef = useRef(false);
  const currentEditorUrlRef = useRef<string | null>(null);
  const knownForwardHrefRef = useRef<string | null>(null);
  const historyRollbackRef = useRef(false);
  const pendingCreatedProductHrefRef = useRef<string | null>(null);
  const assetsRef = useRef(assets);
  const uploadVersionsRef = useRef(new Map<ProductAsset["kind"], number>());
  assetsRef.current = assets;
  const visibleAssets = assets.filter((asset) => !asset.removed && asset.status === "uploaded");
  const coverAsset = visibleAssets.find((asset) => asset.kind === "cover");
  const videoAsset = visibleAssets.find((asset) => asset.kind === "video");
  const hasActiveMediaUpload = assets.some((asset) => !asset.removed && (asset.status === "queued" || asset.status === "uploading"));
  const activeAmazonLinks = amazonLinks.filter((link) => !link.removed);
  const usedAmazonMarkets = new Set(activeAmazonLinks.map((link) => link.market));
  const canAddAmazonMarket = amazonMarketOptions.some(({ value }) => !usedAmazonMarkets.has(value));
  const productTextErrors = validateProductTextLengths(content.title, content.shortDescription);
  const titleOverLimit = productTextErrors.includes(ADMIN_ERROR_CODES.VALIDATION_PRODUCT_TITLE_TOO_LONG);
  const shortDescriptionOverLimit = productTextErrors.includes(ADMIN_ERROR_CODES.VALIDATION_PRODUCT_SHORT_DESCRIPTION_TOO_LONG);
  const titleError = titleOverLimit
    ? getAdminErrorMessage(ADMIN_ERROR_CODES.VALIDATION_PRODUCT_TITLE_TOO_LONG, "pl")
    : fieldErrors["product-title"]?.[0];
  const shortDescriptionError = shortDescriptionOverLimit
    ? getAdminErrorMessage(ADMIN_ERROR_CODES.VALIDATION_PRODUCT_SHORT_DESCRIPTION_TOO_LONG, "pl")
    : fieldErrors["product-short-description"]?.[0];
  const titleLimitWarning = getProductTextLimitWarning(content.title.length, PRODUCT_TITLE_MAX_LENGTH);
  const shortDescriptionLimitWarning = getProductTextLimitWarning(content.shortDescription.length, PRODUCT_SHORT_DESCRIPTION_MAX_LENGTH);

  const refreshDirtyState = useCallback(() => {
    const form = formRef.current;
    if (!form) return;

    const signature = formSignature(form);
    if (savedFormSignatureRef.current === null) {
      savedFormSignatureRef.current = signature;
      isDirtyRef.current = false;
      setIsDirty(false);
      return;
    }

    const nextIsDirty = signature !== savedFormSignatureRef.current;
    isDirtyRef.current = nextIsDirty;
    setIsDirty(nextIsDirty);

  }, []);

  const markDirty = useCallback(() => {
    if (!isDirtyRef.current) {
      const owner = window.location.href;
      const hasNavigationApi = Boolean((window as ProductEditorWindow).navigation);
      navigationApiAvailableRef.current = hasNavigationApi;
      currentEditorUrlRef.current = owner;
      let currentGuard = readProductEditorHistoryGuard(window.history.state);
      if (!hasNavigationApi && currentGuard?.owner !== owner) {
        currentGuard = { owner, role: "base" };
        window.history.replaceState(
          withProductEditorHistoryGuard(window.history.state, currentGuard),
          "",
          owner,
        );
        knownForwardHrefRef.current = null;
      }
      if (!hasNavigationApi && currentGuard?.role === "base" && !currentGuard.forwardHref) {
        window.history.pushState(
          withProductEditorHistoryGuard(window.history.state, { owner, role: "guard" }),
          "",
          owner,
        );
      } else if (!hasNavigationApi) {
        knownForwardHrefRef.current = currentGuard?.forwardHref ?? null;
      }
    }
    isDirtyRef.current = true;
    setIsDirty(true);
    setSaveStatus("idle");
    setShowRouteFeedback(false);
    setSaveErrorCodes([]);
    setFieldErrors({});
    setPremiumErrors({});
    scheduleAfterRender(refreshDirtyState);
  }, [refreshDirtyState]);

  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    currentEditorUrlRef.current = window.location.href;
    const navigationApi = (window as ProductEditorWindow).navigation;
    navigationApiAvailableRef.current = Boolean(navigationApi);
    let currentGuard = readProductEditorHistoryGuard(window.history.state);
    if (!navigationApi && currentGuard?.owner !== window.location.href) {
      currentGuard = { owner: window.location.href, role: "base" };
      window.history.replaceState(
        withProductEditorHistoryGuard(window.history.state, currentGuard),
        "",
        window.location.href,
      );
    }
    knownForwardHrefRef.current = !navigationApi && currentGuard?.owner === window.location.href
      ? currentGuard.forwardHref ?? null
      : null;
    savedFormSignatureRef.current = formSignature(form);
    isDirtyRef.current = false;
    setIsDirty(false);
    setSaveBarRoot(document.body);
  }, [refreshDirtyState]);

  useEffect(() => {
    if (!submittedValues) return;

    const formData = formDataFromProductSaveValues(submittedValues);
    const nextAssets = buildAssets(product, submittedValues);
    const nextAmazonLinks = buildAmazonLinks(product, submittedValues);
    const nextPremiumCodes = buildPremiumCodes(product, submittedValues);
    const errorMapping = mapProductSaveErrors(nativeSaveState.errors, formData, nextAmazonLinks, nextPremiumCodes);

    setContent(buildProductContent(product, submittedValues));
    setAssets(nextAssets);
    setDraftProductId(submittedValue(submittedValues, "id", product?.id ?? createClientId()));
    setProductSlug(submittedValue(submittedValues, "slug", product?.slug ?? ""));
    setProductStatus(parseProductStatus(submittedValue(submittedValues, "status", product?.status ?? "draft")));
    setAmazonLinks(nextAmazonLinks);
    setPremiumCodes(nextPremiumCodes);
    setSaveErrorCodes(nativeSaveState.errors);
    setFieldErrors(errorMapping.fieldErrors);
    setPremiumErrors(errorMapping.premiumErrors);
    setSaveStatus("error");
    savedFormSignatureRef.current = "";
    isDirtyRef.current = true;
    setIsDirty(true);
  }, [nativeSaveState, product, submittedValues]);

  useEffect(() => {
    if (createdProductHref) {
      currentEditorUrlRef.current = new URL(createdProductHref, window.location.href).href;
      router.replace(createdProductHref);
    }
  }, [createdProductHref, router]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };

    const confirmInternalNavigation = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!(event.target instanceof Element)) return;

      const link = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!link || link.target || link.hasAttribute("download")) return;

      const destination = new URL(link.href, window.location.href);
      if (destination.origin !== window.location.origin || destination.href === window.location.href) return;

      const rememberForwardDestination = () => {
        const owner = currentEditorUrlRef.current;
        const currentGuard = readProductEditorHistoryGuard(window.history.state);
        if (!navigationApiAvailableRef.current && owner === window.location.href && currentGuard?.owner === owner) {
          const nextGuard = { owner, role: currentGuard.role, forwardHref: destination.href } satisfies ProductEditorHistoryGuard;
          window.history.replaceState(withProductEditorHistoryGuard(window.history.state, nextGuard), "", owner);
          knownForwardHrefRef.current = destination.href;
        }
      };

      if (!isDirtyRef.current) {
        rememberForwardDestination();
        return;
      }

      if (window.confirm("Masz niezapisane zmiany. Opuścić edytor i je odrzucić?")) {
        isDirtyRef.current = false;
        setIsDirty(false);
        rememberForwardDestination();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };

    const confirmHistoryNavigation = (event: PopStateEvent) => {
      const owner = currentEditorUrlRef.current;
      if (!owner) return;

      const destinationGuard = readProductEditorHistoryGuard(event.state);
      const isSameEditorEntry = window.location.href === owner && destinationGuard?.owner === owner;

      if (historyRollbackRef.current) {
        historyRollbackRef.current = false;
        if (isSameEditorEntry) return;
      }

      if (pendingCreatedProductHrefRef.current && isSameEditorEntry && destinationGuard?.role === "base") {
        const createdProductHref = pendingCreatedProductHrefRef.current;
        pendingCreatedProductHrefRef.current = null;
        setCreatedProductHref(createdProductHref);
        return;
      }

      if (isSameEditorEntry && destinationGuard?.role === "guard") return;

      if (isSameEditorEntry && destinationGuard?.role === "base") {
        if (!isDirtyRef.current) return;

        if (window.confirm("Masz niezapisane zmiany. Opuścić edytor i je odrzucić?")) {
          isDirtyRef.current = false;
          setIsDirty(false);
          window.history.back();
          return;
        }

        event.stopImmediatePropagation();
        historyRollbackRef.current = true;
        window.history.forward();
        return;
      }

      if (!isDirtyRef.current || window.confirm("Masz niezapisane zmiany. Opuścić edytor i je odrzucić?")) {
        isDirtyRef.current = false;
        setIsDirty(false);
        return;
      }

      event.stopImmediatePropagation();
      const isKnownForwardTraversal = knownForwardHrefRef.current === window.location.href;
      historyRollbackRef.current = true;
      if (isKnownForwardTraversal) window.history.back();
      else window.history.forward();
    };

    const navigationApi = (window as ProductEditorWindow).navigation;
    const confirmHistoryApiNavigation = (event: ProductEditorNavigateEvent) => {
      if (event.navigationType !== "traverse" || !isDirtyRef.current) return;

      const destination = event.destination?.url;
      if (!destination || new URL(destination, window.location.href).href === window.location.href) return;

      if (!window.confirm("Masz niezapisane zmiany. Opuścić edytor i je odrzucić?")) event.preventDefault();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    let unregisterPopStateGuard: (() => void) | undefined;
    if (navigationApi) {
      navigationApi.addEventListener("navigate", confirmHistoryApiNavigation);
    } else {
      unregisterPopStateGuard = registerProductEditorPopStateGuard(confirmHistoryNavigation);
    }
    document.addEventListener("click", confirmInternalNavigation, true);
    return () => {
      unregisterPopStateGuard?.();
      window.removeEventListener("beforeunload", handleBeforeUnload);
      if (navigationApi) {
        navigationApi.removeEventListener("navigate", confirmHistoryApiNavigation);
      }
      document.removeEventListener("click", confirmInternalNavigation, true);
    };
  }, []);

  const updateContent = (field: keyof ProductContentDraft, value: string) => {
    markDirty();
    setContent((current) => ({ ...current, [field]: value }));

    const errorTarget = field === "title"
      ? "product-title"
      : field === "shortDescription"
        ? "product-short-description"
        : undefined;
    if (errorTarget) {
      const lengthError = field === "title"
        ? ADMIN_ERROR_CODES.VALIDATION_PRODUCT_TITLE_TOO_LONG
        : ADMIN_ERROR_CODES.VALIDATION_PRODUCT_SHORT_DESCRIPTION_TOO_LONG;
      setFieldErrors((current) => {
        if (!current[errorTarget]) return current;
        const next = { ...current };
        delete next[errorTarget];
        return next;
      });
      setSaveErrorCodes((current) => current.filter((code) => code !== lengthError));
    }
  };

  const updateAsset = <K extends keyof AssetDraft>(clientId: string, field: K, value: AssetDraft[K]) => {
    markDirty();
    setAssets((current) => current.map((asset) => {
      if (asset.clientId !== clientId) {
        return asset;
      }

      const next = { ...asset, [field]: value } as AssetDraft;

      return next;
    }));
  };

  const nextUploadVersion = (kind: ProductAsset["kind"]) => {
    const version = (uploadVersionsRef.current.get(kind) ?? 0) + 1;
    uploadVersionsRef.current.set(kind, version);
    return version;
  };

  const isCurrentUpload = (kind: ProductAsset["kind"], version: number) =>
    MEDIA_UPLOAD_SPECS[kind].multiple || uploadVersionsRef.current.get(kind) === version;

  const uploadFiles = async (kind: ProductAsset["kind"], selectedFiles: FileList | File[]) => {
    const selected = Array.from(selectedFiles);
    const spec = MEDIA_UPLOAD_SPECS[kind];
    const selectionErrors: string[] = [];
    const validatedContentTypes = new Map<File, string>();

    if (!spec.multiple && selected.length > 1) {
      selectionErrors.push("W tej sekcji można dodać tylko jeden plik.");
    }

    const validFiles = selected.filter((file) => {
      const validation = validateMediaFile(kind, file);
      if (!validation.ok) {
        selectionErrors.push(validation.error);
        return false;
      }
      validatedContentTypes.set(file, validation.contentType);
      return true;
    });

    if (!validFiles.length) {
      setMediaErrors((current) => ({ ...current, [kind]: selectionErrors.join(" ") || "Nie wybrano prawidłowego pliku." }));
      return;
    }

    const files = spec.multiple ? validFiles : validFiles.slice(0, 1);
    markDirty();
    const activeCount = assets.filter((asset) => !asset.removed && asset.kind === kind && asset.status !== "failed").length;

    if (kind === "gallery" && activeCount + files.length > MAX_GALLERY_ASSETS) {
      selectionErrors.push("Galeria może zawierać maksymalnie 20 obrazów. Usuń plik, aby dodać kolejny.");
    }

    if (!files.length || (kind === "gallery" && activeCount + files.length > MAX_GALLERY_ASSETS)) {
      setMediaErrors((current) => ({ ...current, [kind]: selectionErrors.join(" ") || "Nie wybrano prawidłowego pliku." }));
      return;
    }

    setMediaErrors((current) => ({ ...current, [kind]: selectionErrors.join(" ") || undefined }));
    const galleryOrderEnd = kind === "gallery"
      ? assets
        .filter((asset) => !asset.removed && asset.kind === "gallery")
        .reduce((max, asset) => Math.max(max, asset.sortOrder), 0)
      : activeCount;
    const newDrafts = files.map((file, index) => ({
      clientId: createClientId(),
      id: "",
      kind,
      bucket: spec.bucket,
      path: "",
      storagePath: undefined,
      storageProvider: "supabase" as const,
      filename: file.name,
      contentType: validatedContentTypes.get(file) ?? file.type,
      sizeBytes: file.size,
      title: file.name,
      sortOrder: galleryOrderEnd + index + 1,
      removed: false,
      status: "queued" as const,
      file,
      uploaded: false,
      progress: 0,
    }));

    if (!spec.multiple) {
      const version = nextUploadVersion(kind);
      setAssets((current) => [
        ...current.map((asset) => asset.kind === kind && !asset.removed && (asset.status === "queued" || asset.status === "uploading")
          ? { ...asset, removed: true }
          : asset),
        ...newDrafts,
      ]);
      await Promise.all(newDrafts.map((draft) => uploadAsset(draft, version)));
    } else {
      setAssets((current) => [...current, ...newDrafts]);
      await Promise.all(newDrafts.map((draft) => uploadAsset(draft)));
    }
  };

  const uploadAsset = async (draft: AssetDraft, version = uploadVersionsRef.current.get(draft.kind) ?? 0) => {
    const currentDraft = assetsRef.current.find((asset) => asset.clientId === draft.clientId) ?? draft;
    const file = currentDraft.file ?? draft.file;

    if (!file) {
      updateAsset(draft.clientId, "status", "failed");
      updateAsset(draft.clientId, "error", "Nie znaleziono pliku do ponowienia uploadu.");
      return;
    }

    updateAsset(draft.clientId, "status", "uploading");
    updateAsset(draft.clientId, "error", undefined);
    let uploadedAsset: Partial<AssetDraft> = currentDraft;

    try {
      let uploadTarget = currentDraft.upload;

      if (!uploadTarget) {
        let response = await fetch("/api/admin/assets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            productId: draftProductId,
            kind: draft.kind,
            filename: file.name,
            sizeBytes: file.size,
            contentType: currentDraft.contentType,
          }),
        });
        let payload = await response.json() as { asset?: Partial<AssetDraft>; upload?: SignedMediaUploadTarget; error?: string; errorCode?: string };

        if (response.status === 415) {
          const formData = new FormData();
          formData.append("productId", draftProductId);
          formData.append("kind", draft.kind);
          formData.append("file", file);
          response = await fetch("/api/admin/assets", { method: "POST", body: formData });
          payload = await response.json() as { asset?: Partial<AssetDraft>; upload?: SignedMediaUploadTarget; error?: string; errorCode?: string };
        }

        if (!response.ok || !payload.asset) {
          throw new Error(payload.errorCode ? getAdminErrorMessage(payload.errorCode, "pl") : payload.error || "Upload nie powiódł się.");
        }

        uploadedAsset = payload.asset;
        uploadTarget = payload.upload;
        setAssets((current) => current.map((asset) => asset.clientId === draft.clientId
          ? {
            ...asset,
            ...payload.asset,
            sortOrder: asset.kind === "gallery" ? asset.sortOrder : payload.asset?.sortOrder ?? asset.sortOrder,
            upload: payload.upload,
            status: "uploading",
            progress: 0,
            error: undefined,
          }
          : asset));
      }

      if (uploadTarget) {
        await uploadMedia(file, uploadTarget, currentDraft.contentType, (progress) => {
          updateAsset(draft.clientId, "progress", progress);
        });
      }

      const currentState = assetsRef.current.find((asset) => asset.clientId === draft.clientId);
      const stale = !isCurrentUpload(draft.kind, version) || !currentState || currentState.removed;

      if (stale) {
        const storagePath = uploadedAsset.storagePath ?? (uploadTarget?.driver === "supabase-tus" ? uploadTarget.path : undefined);
        if (storagePath) {
          await deleteUploadedStorage(draft.kind, storagePath, uploadedAsset.storageProvider);
        }
        setAssets((current) => current.filter((asset) => asset.clientId !== draft.clientId));
        return;
      }

      setAssets((current) => current.map((asset) => {
        if (asset.clientId === draft.clientId) {
          return {
            ...asset,
            ...uploadedAsset,
            sortOrder: asset.kind === "gallery" ? asset.sortOrder : uploadedAsset.sortOrder ?? asset.sortOrder,
            upload: uploadTarget,
            status: "uploaded",
            uploaded: true,
            file,
            progress: 100,
            removed: false,
            error: undefined,
          } as AssetDraft;
        }

        if (!MEDIA_UPLOAD_SPECS[draft.kind].multiple && asset.kind === draft.kind && !asset.removed) {
          return { ...asset, removed: true };
        }

        return asset;
      }));
    } catch (error) {
      if (uploadedAsset.id && uploadedAsset.storagePath) {
        try {
          await deleteUploadedStorage(
            draft.kind,
            uploadedAsset.storagePath,
            uploadedAsset.storageProvider,
          );
        } catch {
          console.error("Nie udało się posprzątać nieudanego uploadu.", {
            assetId: uploadedAsset.id,
          });
        }
      }
      setAssets((current) => current.map((asset) => asset.clientId === draft.clientId ? {
        ...asset,
        id: "",
        path: "",
        storagePath: undefined,
        storageProvider: "supabase" as const,
        upload: undefined,
        uploaded: false,
        status: "failed",
        error: getMediaUploadErrorMessage(error),
      } : asset));
    }
  };

  const removeAsset = async (asset: AssetDraft) => {
    if (!asset.id || asset.uploaded || asset.upload) {
      try {
        if (asset.storagePath) await deleteUploadedStorage(asset.kind, asset.storagePath, asset.storageProvider);
        markDirty();
        setAssets((current) => current.filter((item) => item.clientId !== asset.clientId));
      } catch (error) {
        setMediaErrors((current) => ({
          ...current,
          [asset.kind]: getMediaErrorMessage(error, "Nie udało się usunąć pliku. Spróbuj ponownie."),
        }));
      }
      return;
    }
    updateAsset(asset.clientId, "removed", true);
  };

  const deleteUploadedStorage = async (
    kind: ProductAsset["kind"],
    storagePath: string,
    storageProvider?: ProductAsset["storageProvider"],
  ) => {
    const response = await fetch("/api/admin/assets", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: draftProductId, kind, storagePath, storageProvider: storageProvider ?? "supabase" }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: string; errorCode?: string } | null;
      throw new Error(payload?.errorCode ? getAdminErrorMessage(payload.errorCode, "pl") : payload?.error || "Nie udało się usunąć pliku.");
    }
  };

  const retryUpload = (asset: AssetDraft) => {
    const version = MEDIA_UPLOAD_SPECS[asset.kind].multiple ? 0 : nextUploadVersion(asset.kind);
    return uploadAsset(asset, version);
  };

  const reorderGallery = (clientId: string, direction: -1 | 1) => {
    markDirty();
    setAssets((current) => {
      const gallery = sortGalleryAssets(current.filter((asset) => !asset.removed && asset.kind === "gallery"));
      const index = gallery.findIndex((asset) => asset.clientId === clientId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= gallery.length) return current;

      const reordered = gallery.slice();
      [reordered[index], reordered[nextIndex]] = [reordered[nextIndex], reordered[index]];
      const sortOrders = new Map(reordered.map((asset, order) => [asset.clientId, order + 1]));
      return current.map((asset) => sortOrders.has(asset.clientId) ? { ...asset, sortOrder: sortOrders.get(asset.clientId)! } : asset);
    });
  };

  const updateAmazon = <K extends keyof AmazonDraft>(clientId: string, field: K, value: AmazonDraft[K]) => {
    markDirty();
    setAmazonLinks((current) => current.map((link) => link.clientId === clientId ? { ...link, [field]: value } : link));
  };

  const setPrimaryAmazon = (clientId: string) => {
    markDirty();
    setAmazonLinks((current) => current.map((link) => ({ ...link, isPrimary: link.clientId === clientId })));
  };

  const addAmazon = () => {
    markDirty();
    setAmazonLinks((current) => {
      const nextMarket = amazonMarketOptions.find(({ value }) =>
        !current.some((link) => !link.removed && link.market === value),
      )?.value;

      if (!nextMarket) {
        return current;
      }

      return [...current, {
        clientId: `amazon-${Date.now()}-${current.length}`,
        id: "",
        market: nextMarket,
        url: "",
        isPrimary: current.every((link) => link.removed),
        removed: false,
      }];
    });
  };

  const removeAmazon = (link: AmazonDraft) => {
    if (!link.id) {
      markDirty();
      setAmazonLinks((current) => current.filter((item) => item.clientId !== link.clientId));
      return;
    }
    updateAmazon(link.clientId, "removed", true);
  };

  const updatePremium = <K extends keyof PremiumDraft>(clientId: string, field: K, value: PremiumDraft[K]) => {
    markDirty();
    setPremiumCodes((current) => current.map((code) => code.clientId === clientId ? { ...code, [field]: value } : code));
    setPremiumErrors((current) => {
      if (!current[clientId]) return current;
      const next = { ...current };
      delete next[clientId];
      return next;
    });
  };

  const addPremium = () => {
    markDirty();
    setPremiumCodes((current) => [...current, {
      clientId: `code-${Date.now()}-${current.length}`,
      id: "",
      code: "",
      active: true,
      removed: false,
    }]);
  };

  const removePremium = (code: PremiumDraft) => {
    if (!code.id) {
      markDirty();
      setPremiumCodes((current) => current.filter((item) => item.clientId !== code.clientId));
      return;
    }
    updatePremium(code.clientId, "removed", true);
  };

  const validatePremiumCodesBeforeSubmit = () => {
    const activeCodes = premiumCodes.filter((code) => !code.removed);
    const issues = validatePremiumCodeEntries(activeCodes);
    const nextErrors: Partial<Record<string, AdminErrorCode>> = {};

    for (const issue of issues) {
      const code = activeCodes[issue.index];
      if (code) {
        nextErrors[code.clientId] = issue.reason === "required"
          ? "admin.validation.premium_code_required"
          : issue.reason === "too_long"
            ? "admin.validation.premium_code_too_long"
            : "admin.conflict.premium_code_duplicate";
      }
    }

    setPremiumErrors(nextErrors);
    return issues.length === 0;
  };

  const premiumErrorMessages = Array.from(new Set(
    Object.values(premiumErrors)
      .filter((code): code is AdminErrorCode => Boolean(code))
      .map((code) => getAdminErrorMessage(code, "pl")),
  ));

  const handleSave = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSaving || hasActiveMediaUpload || !saveAction) return;

    if (!validatePremiumCodesBeforeSubmit()) {
      setSaveStatus("error");
      scheduleAfterRender(() => {
        formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      });
      return;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);
    if (productTextErrors.length) {
      const mapped = mapProductSaveErrors(productTextErrors, formData, amazonLinks, premiumCodes);
      setSaveStatus("error");
      setSaveErrorCodes(productTextErrors);
      setFieldErrors(mapped.fieldErrors);
      scheduleAfterRender(() => focusFirstError(mapped.focusTarget));
      return;
    }

    setIsSaving(true);
    setSaveStatus("idle");
    setSaveErrorCodes([]);
    setFieldErrors({});

    startTransition(async () => {
      try {
        const result = await saveAction(formData);
        if (!result.ok) {
          const mapped = mapProductSaveErrors(result.errors, formData, amazonLinks, premiumCodes);
          const cleanupFailures = new Map((result.mediaCleanupFailures ?? []).map((failure) => [failure.assetId, failure]));
          setAssets((current) => current.map((asset) => {
            if (!asset.uploaded) return asset;
            if (cleanupFailures.has(asset.id)) {
              return {
                ...asset,
                error: "Nie udało się usunąć niezapisanego pliku. Możesz ponowić zapis albo użyć Usuń, aby ponowić sprzątanie.",
              };
            }
            return {
              ...asset,
              id: "",
              path: "",
              storagePath: undefined,
              upload: undefined,
              uploaded: false,
              status: "failed",
              error: "Produkt nie został zapisany. Prześlij ten plik ponownie przed kolejną próbą.",
            };
          }));
          setSaveStatus("error");
          setSaveErrorCodes(result.errors);
          setFieldErrors(mapped.fieldErrors);
          setPremiumErrors(mapped.premiumErrors);
          scheduleAfterRender(() => focusFirstError(mapped.focusTarget));
          return;
        }

        setAssets((current) => current.map((asset) => ({ ...asset, uploaded: false, file: undefined, upload: undefined })));
        isDirtyRef.current = false;
        setIsDirty(false);
        setSaveStatus("saved");
        setSaveErrorCodes([]);
        setFieldErrors({});
        setPremiumErrors({});
        scheduleAfterRender(() => {
          const form = formRef.current;
          if (form) savedFormSignatureRef.current = formSignature(form);
        });

        if (!product) {
          const href = `/admin/products/${result.id}?saved=1`;
          const owner = currentEditorUrlRef.current;
          const guard = readProductEditorHistoryGuard(window.history.state);
          if (!navigationApiAvailableRef.current && owner && guard?.owner === owner && guard.role === "guard") {
            pendingCreatedProductHrefRef.current = href;
            window.history.back();
          } else {
            setCreatedProductHref(href);
          }
        }
      } catch {
        setSaveStatus("error");
        setSaveErrorCodes([ADMIN_ERROR_CODES.INTERNAL]);
      } finally {
        setIsSaving(false);
      }
    });
  };

  return (
    <div className="min-w-0 pb-28">
      <form ref={formRef} id="product-editor-form" action={saveFormAction ? nativeSaveFormAction : undefined} onSubmit={handleSave} onChangeCapture={markDirty} className="grid gap-6">
        <input type="hidden" name="id" value={draftProductId} />
        <input type="hidden" name="coverAssetId" value={coverAsset?.id ?? ""} />
        <input type="hidden" name="videoAssetId" value={videoAsset?.id ?? ""} />
        <input type="hidden" name="mediaUploadState" value={hasActiveMediaUpload ? "active" : "idle"} />

        <fieldset disabled={isSaving} className="m-0 grid min-w-0 gap-6 border-0 p-0">
        <AdminEditorHeader
          backHref="/admin/products"
          backLabel="Produkty"
          title={title}
          subtitle={product ? `ID: ${product.id}` : "Nowy produkt zaczyna jako szkic."}
          status={<Badge className={statusClass(productStatus)}>{statusLabels[productStatus]}</Badge>}
        />

        <noscript>
          <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--color-border)] bg-white/95 px-4 pt-3 shadow-[0_-8px_30px_rgba(47,35,29,0.08)] sm:px-6 lg:left-64 lg:px-8" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
            <div className="mx-auto flex max-w-6xl justify-end">
              <button type="submit" className={buttonClassName({ className: "w-fit" })}>Zapisz produkt</button>
            </div>
          </div>
        </noscript>

        {hasActiveMediaUpload ? <p role="status" className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Zapis produktu będzie dostępny po zakończeniu przesyłania plików.</p> : null}
        {feedback && showRouteFeedback ? <div role="alert" className="rounded-md border border-[var(--color-border)] bg-white px-4 py-3 text-sm text-[var(--color-terracotta)]">{feedback}</div> : null}
        {saveErrorCodes.length ? <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"><p className="font-medium">Nie udało się zapisać. Twoje wpisane wartości są zachowane.</p><ul className="mt-2 list-disc space-y-1 pl-5">{Array.from(new Set(saveErrorCodes)).map((code) => <li key={code}>{getAdminErrorMessage(code, "pl")}</li>)}</ul></div> : null}

        <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_19rem]">
          <main className="grid min-w-0 gap-6">
      <AdminEditorSection title="Podstawowe informacje" description="Treść produktu jest edytowana po angielsku.">
              <div className="grid min-w-0 gap-5">
                <div className="grid min-w-0 gap-4">
                  <Field label="Tytuł" htmlFor="product-title" error={titleError}>
                    <Input id="product-title" name="title" value={content.title} maxLength={PRODUCT_TITLE_MAX_LENGTH} onChange={(event) => updateContent("title", event.target.value)} aria-invalid={Boolean(titleError)} aria-describedby={`product-title-help product-title-counter${titleLimitWarning ? " product-title-warning" : ""}${titleError ? " product-title-error" : ""}`} />
                    <div className="flex items-start justify-between gap-3 text-sm">
                      <p id="product-title-help" className="min-w-0 leading-5 text-[var(--color-muted)]">Używany w katalogu i na stronie produktu.</p>
                      <p id="product-title-counter" className={`shrink-0 ${titleOverLimit ? "text-red-800" : titleLimitWarning ? "text-amber-800" : "text-[var(--color-muted)]"}`}>{content.title.length} / {PRODUCT_TITLE_MAX_LENGTH} znaków</p>
                    </div>
                    {titleLimitWarning ? <p id="product-title-warning" role="status" className="text-sm text-amber-800">{titleLimitWarning}</p> : null}
                  </Field>
                  <Field label="Krótki opis" htmlFor="product-short-description" error={shortDescriptionError}>
                    <Textarea id="product-short-description" name="shortDescription" value={content.shortDescription} rows={4} maxLength={PRODUCT_SHORT_DESCRIPTION_MAX_LENGTH} onChange={(event) => updateContent("shortDescription", event.target.value)} className="min-h-28 resize-y" aria-invalid={Boolean(shortDescriptionError)} aria-describedby={`product-short-description-help product-short-description-counter${shortDescriptionLimitWarning ? " product-short-description-warning" : ""}${shortDescriptionError ? " product-short-description-error" : ""}`} />
                    <div className="flex items-start justify-between gap-3 text-sm">
                      <p id="product-short-description-help" className="min-w-0 leading-5 text-[var(--color-muted)]">Wyświetlany na kartach i w podglądzie produktu. Używany też jako opis SEO, gdy osobne pole SEO jest puste.</p>
                      <p id="product-short-description-counter" className={`shrink-0 ${shortDescriptionOverLimit ? "text-red-800" : shortDescriptionLimitWarning ? "text-amber-800" : "text-[var(--color-muted)]"}`}>{content.shortDescription.length} / {PRODUCT_SHORT_DESCRIPTION_MAX_LENGTH} znaków</p>
                    </div>
                    {shortDescriptionLimitWarning ? <p id="product-short-description-warning" role="status" className="text-sm text-amber-800">{shortDescriptionLimitWarning}</p> : null}
                  </Field>
                  <Field label="Długi opis" htmlFor="product-long-description">
                    <Textarea id="product-long-description" name="longDescription" value={content.longDescription} onChange={(event) => updateContent("longDescription", event.target.value)} className="min-h-48" />
                  </Field>
                  <AdminDisclosure className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-4" summary="SEO i wygląd w Google">
                    <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">Puste pole użyje fallbacku: tytułu produktu lub krótkiego opisu.</p>
                    <div className="mt-4 grid gap-4">
                      <Field label="SEO title" htmlFor="product-seo-title"><Input id="product-seo-title" name="seoTitle" value={content.seoTitle} onChange={(event) => updateContent("seoTitle", event.target.value)} /></Field>
                      <Field label="SEO description" htmlFor="product-seo-description"><Textarea id="product-seo-description" name="seoDescription" value={content.seoDescription} onChange={(event) => updateContent("seoDescription", event.target.value)} className="min-h-28" /></Field>
                    </div>
                  </AdminDisclosure>
                </div>
              </div>
            </AdminEditorSection>

            <MediaSections assets={assets} errors={mediaErrors} fieldErrors={fieldErrors} onUpload={uploadFiles} onRemove={removeAsset} onUndo={(asset) => updateAsset(asset.clientId, "removed", false)} onRetry={(asset) => void retryUpload(asset)} onMove={reorderGallery} />

            <AdminEditorSection title="Sprzedaż na Amazon" description="Dodaj maksymalnie jeden link dla każdego rynku i wybierz jeden domyślny.">
              <div id="product-amazon-links" className="grid gap-3">
                {amazonLinks.length === 0 ? <p className="text-sm text-[var(--color-muted)]">Nie dodano jeszcze rynku.</p> : null}
                {amazonLinks.map((link, index) => (
                  <AmazonEditor
                    key={link.clientId}
                    link={link}
                    index={index}
                    availableMarkets={amazonMarketOptions.filter(({ value }) => value === link.market || !usedAmazonMarkets.has(value))}
                    onChange={updateAmazon}
                    onPrimary={setPrimaryAmazon}
                    onRemove={removeAmazon}
                    onUndo={() => updateAmazon(link.clientId, "removed", false)}
                  />
                ))}
                <Button type="button" variant="outline" onClick={addAmazon} disabled={!canAddAmazonMarket} className="w-fit"><Plus className="size-4" aria-hidden />Dodaj rynek</Button>
                {!canAddAmazonMarket ? <p className="text-sm text-[var(--color-muted)]">Dodano wszystkie dostępne rynki.</p> : null}
                {fieldErrors["product-amazon-links"]?.map((message) => <p key={message} className="text-sm text-red-800">{message}</p>)}
              </div>
            </AdminEditorSection>

            <AdminEditorSection title="Dostęp premium" description="Kody są pokazywane bez technicznych identyfikatorów; ich aktywność pozostaje zapisywana w obecnym modelu.">
              <div id="product-premium-codes" className="grid gap-3">
                {fieldErrors["product-premium-codes"]?.map((message) => <p key={message} role="alert" className="text-sm text-red-800">{message}</p>)}
                {premiumErrorMessages.length ? <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">Popraw błędy kodów premium oznaczone poniżej.</div> : null}
                {premiumCodes.length === 0 ? <p className="text-sm text-[var(--color-muted)]">Nie dodano jeszcze kodów premium.</p> : null}
                {premiumCodes.map((code, index) => (
                  <PremiumEditor key={code.clientId} code={code} index={index} error={premiumErrors[code.clientId] ? getAdminErrorMessage(premiumErrors[code.clientId]!, "pl") : undefined} onChange={updatePremium} onRemove={removePremium} onUndo={() => updatePremium(code.clientId, "removed", false)} />
                ))}
                <Button type="button" variant="outline" onClick={addPremium} className="w-fit"><Plus className="size-4" aria-hidden />Dodaj kod</Button>
              </div>
            </AdminEditorSection>
          </main>

          <aside className="grid h-fit min-w-0 gap-6 xl:sticky xl:top-6">
            <AdminEditorSection title="Publikacja i katalog">
              <div className="grid gap-4">
              <Field label="Status" htmlFor="product-status" error={fieldErrors["product-status"]?.[0]}>
                <select id="product-status" name="status" value={productStatus} onChange={(event) => setProductStatus(event.target.value as Product["status"])} aria-invalid={Boolean(fieldErrors["product-status"]?.length)} aria-describedby={fieldErrors["product-status"]?.length ? "product-status-error" : undefined} className="h-11 w-full rounded-md border border-[var(--color-border)] bg-white px-3 text-sm outline-none focus:border-[var(--color-terracotta)] focus:ring-4 focus:ring-[var(--color-terracotta-ring)]">
                  <option value="draft">Szkic</option><option value="published">Opublikowany</option><option value="archived">Zarchiwizowany</option>
                </select>
              </Field>
              <p className="text-xs leading-5 text-[var(--color-muted)]">Produkt opublikowany jest widoczny w katalogu. Szkic i archiwum pozostają ukryte.</p>
              <Field label="Adres produktu" htmlFor="product-slug" error={fieldErrors["product-slug"]?.[0]}>
                <Input id="product-slug" name="slug" value={productSlug} onChange={(event) => setProductSlug(event.target.value)} placeholder="wygenerujemy-z-tytulu-angielskiego" aria-invalid={Boolean(fieldErrors["product-slug"]?.length)} aria-describedby={fieldErrors["product-slug"]?.length ? "product-slug-error" : undefined} />
                <p className="text-xs leading-5 text-[var(--color-muted)]">Zostaw puste, aby utworzyć adres z angielskiego tytułu. {productSlug ? `/products/${productSlug}` : "Adres zostanie pokazany po zapisaniu."}</p>
              </Field>
              <Field label="Pozycja w katalogu" htmlFor="product-sort-order">
                <Input id="product-sort-order" name="sortOrder" type="number" defaultValue={submittedValue(submittedValues, "sortOrder", String(product?.sortOrder ?? 100))} />
                <p className="text-xs leading-5 text-[var(--color-muted)]">Niższa liczba wyświetla produkt wcześniej.</p>
              </Field>
              <Field label="Przypomnienie o opinii po (dniach)" htmlFor="product-review-delay">
                <Input id="product-review-delay" name="reviewDelayDays" type="number" min={1} defaultValue={submittedValue(submittedValues, "reviewDelayDays", String(product?.reviewDelayDays ?? 14))} />
                <p className="text-xs leading-5 text-[var(--color-muted)]">Liczba dni od odblokowania produktu do przypomnienia.</p>
              </Field>
              </div>
            </AdminEditorSection>

            <AdminEditorSection title="Organizacja">
              <div className="grid gap-4">
                <Field label="Segment" htmlFor="product-audience"><select id="product-audience" name="audience" defaultValue={submittedValue(submittedValues, "audience", product?.audience ?? "kids")} className="h-11 w-full rounded-md border border-[var(--color-border)] bg-white px-3 text-sm"><option value="kids">Dzieci</option><option value="adults">Dorośli</option></select></Field>
                <Field label="Typ produktu" htmlFor="product-type"><select id="product-type" name="productType" defaultValue={submittedValue(submittedValues, "productType", product?.productType ?? "coloring-book")} className="h-11 w-full rounded-md border border-[var(--color-border)] bg-white px-3 text-sm">{product?.productType && !productTypes.includes(product.productType) ? <option value={product.productType}>{formatProductType(product.productType)}</option> : null}{productTypes.map((type) => <option key={type} value={type}>{formatProductType(type)}</option>)}</select></Field>
                <CheckboxGroup label="Kategorie" name="categoryIds" values={categories.map((category) => ({ id: category.id, label: taxonomyLabel(category.translations, category.slug) }))} selected={submittedValuesFor(submittedValues, "categoryIds", product?.categoryIds ?? [])} />
                <CheckboxGroup label="Tagi" name="tagIds" values={tags.map((tag) => ({ id: tag.id, label: taxonomyLabel(tag.translations, tag.slug) }))} selected={submittedValuesFor(submittedValues, "tagIds", product?.tagIds ?? [])} />
              </div>
            </AdminEditorSection>
          </aside>
        </div>
        </fieldset>
      </form>

      {product && archiveAction && deleteAction ? (
        <DangerZone product={product} archiveAction={archiveAction} deleteAction={deleteAction} disabled={isDirty || isSaving} />
      ) : null}

      {saveBarRoot ? createPortal(
        <div data-testid="product-save-bar" className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--color-border)] bg-white/95 px-4 pt-3 shadow-[0_-8px_30px_rgba(47,35,29,0.08)] backdrop-blur sm:px-6 lg:left-64 lg:px-8" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
            <p role={saveStatus === "error" ? "alert" : "status"} aria-live="polite" className={`min-w-0 text-sm ${saveStatus === "error" ? "text-red-800" : "text-[var(--color-muted)]"}`}>
              {isSaving ? "Zapisywanie…" : saveStatus === "saved" ? "Zapisano. Zmiany są aktualne." : saveStatus === "error" ? "Zapis nie powiódł się. Sprawdź wskazane błędy." : isDirty ? "Niezapisane zmiany" : product || createdProductHref ? "Wszystkie zmiany są zapisane" : "Nowy produkt nie został jeszcze zapisany"}
            </p>
            <ProductSubmitButton pending={isSaving} dirty={isDirty} disabled={hasActiveMediaUpload || !saveAction} />
          </div>
        </div>,
        saveBarRoot,
      ) : null}
    </div>
  );
}

function ProductSubmitButton({ pending, dirty, disabled = false }: { pending: boolean; dirty: boolean; disabled?: boolean }) {
  return <Button type="submit" form="product-editor-form" disabled={pending || disabled} className="shrink-0"><Save className="size-4" aria-hidden />{pending ? "Zapisywanie…" : dirty ? "Zapisz zmiany" : "Zapisz"}</Button>;
}

function MediaSections({
  assets,
  errors,
  fieldErrors,
  onUpload,
  onRemove,
  onUndo,
  onRetry,
  onMove,
}: {
  assets: AssetDraft[];
  errors: Partial<Record<ProductAsset["kind"], string>>;
  fieldErrors: Record<string, string[]>;
  onUpload: (kind: ProductAsset["kind"], files: FileList | File[]) => void;
  onRemove: (asset: AssetDraft) => void;
  onUndo: (asset: AssetDraft) => void;
  onRetry: (asset: AssetDraft) => void;
  onMove: (clientId: string, direction: -1 | 1) => void;
}) {
  return <div className="grid min-w-0 gap-6">
    <MediaSection kind="cover" title="OKŁADKA" description="Jedna grafika reprezentująca produkt. Możesz ją później zastąpić lub usunąć." assets={assets} error={errors.cover} fieldErrors={fieldErrors} onUpload={onUpload} onRemove={onRemove} onUndo={onUndo} onRetry={onRetry} onMove={onMove} />
    <MediaSection kind="gallery" title="GALERIA" description="Dodaj do 20 obrazów i ustaw ich kolejność przyciskami góra/dół." assets={assets} error={errors.gallery} fieldErrors={fieldErrors} onUpload={onUpload} onRemove={onRemove} onUndo={onUndo} onRetry={onRetry} onMove={onMove} />
    <MediaSection kind="video" title="WIDEO FLIPTHROUGH" description="Jedno publiczne wideo pokazujące zawartość produktu." assets={assets} error={errors.video} fieldErrors={fieldErrors} onUpload={onUpload} onRemove={onRemove} onUndo={onUndo} onRetry={onRetry} onMove={onMove} />
    <MediaSection kind="public_download" title="PUBLICZNE PLIKI DO POBRANIA" description="Pliki dostępne dla każdego odwiedzającego — bez logowania i bez odblokowania." assets={assets} error={errors.public_download} fieldErrors={fieldErrors} onUpload={onUpload} onRemove={onRemove} onUndo={onUndo} onRetry={onRetry} onMove={onMove} />
    <MediaSection kind="premium_download" title="MATERIAŁY PREMIUM" description="Prywatne materiały dostępne dopiero po weryfikacji e-maila i odblokowaniu produktu." assets={assets} error={errors.premium_download} fieldErrors={fieldErrors} onUpload={onUpload} onRemove={onRemove} onUndo={onUndo} onRetry={onRetry} onMove={onMove} />
  </div>;
}

function MediaSection({
  kind,
  title,
  description,
  assets,
  error,
  fieldErrors,
  onUpload,
  onRemove,
  onUndo,
  onRetry,
  onMove,
}: {
  kind: ProductAsset["kind"];
  title: string;
  description: string;
  assets: AssetDraft[];
  error?: string;
  fieldErrors: Record<string, string[]>;
  onUpload: (kind: ProductAsset["kind"], files: FileList | File[]) => void;
  onRemove: (asset: AssetDraft) => void;
  onUndo: (asset: AssetDraft) => void;
  onRetry: (asset: AssetDraft) => void;
  onMove: (clientId: string, direction: -1 | 1) => void;
}) {
  const sectionAssets = assets.filter((asset) => asset.kind === kind);
  const activeAssets = sectionAssets.filter((asset) => !asset.removed);
  const visibleAssets = kind === "gallery" ? sortGalleryAssets(activeAssets) : activeAssets;
  const spec = MEDIA_UPLOAD_SPECS[kind];

  const serverError = fieldErrors[`media-section-${kind}`]?.[0];

  return <div id={`media-section-${kind}`} className="min-w-0"><AdminEditorSection title={title} description={description}>
    <div className="grid min-w-0 gap-4">
      <UploadDropzone kind={kind} accept={spec.accept} multiple={spec.multiple} onFiles={(files) => onUpload(kind, files)} />
      <p className="text-xs leading-5 text-[var(--color-muted)]">{uploadHint(kind)}</p>
      {error ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{error}</p> : null}
      {serverError ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{serverError}</p> : null}
      {visibleAssets.length ? <div className="grid min-w-0 gap-3" aria-live="polite">{visibleAssets.map((asset, index) => <MediaAssetRow key={asset.clientId} asset={asset} kind={kind} index={index} total={visibleAssets.length} onRemove={onRemove} onRetry={onRetry} onMove={onMove} />)}</div> : <p className="rounded-lg border border-dashed border-[var(--color-border)] px-4 py-5 text-sm text-[var(--color-muted)]">Nie dodano jeszcze plików.</p>}
      {sectionAssets.filter((asset) => asset.removed).map((asset) => <RemovedAssetRow key={asset.clientId} asset={asset} onUndo={onUndo} />)}
    </div>
  </AdminEditorSection></div>;
}

function UploadDropzone({
  kind,
  accept,
  multiple,
  onFiles,
}: {
  kind: ProductAsset["kind"];
  accept: string;
  multiple: boolean;
  onFiles: (files: FileList) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const inputId = `media-upload-${kind}`;
  const openPicker = () => inputRef.current?.click();

  return <div
    role="button"
    tabIndex={0}
    aria-controls={inputId}
    aria-label={`Wybierz pliki do sekcji ${mediaTitle(kind)}`}
    onClick={openPicker}
    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openPicker(); } }}
    onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
    onDragLeave={() => setDragging(false)}
    onDrop={(event) => { event.preventDefault(); setDragging(false); if (event.dataTransfer.files.length) onFiles(event.dataTransfer.files); }}
    className={`grid min-h-36 cursor-pointer place-items-center rounded-xl border-2 border-dashed px-5 py-6 text-center transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)] ${dragging ? "border-[var(--color-terracotta)] bg-[var(--color-blush)]" : "border-[var(--color-border)] bg-[var(--color-bg)] hover:border-[var(--color-terracotta)] hover:bg-[var(--color-blush)]"}`}
  >
    <input ref={inputRef} id={inputId} type="file" accept={accept} multiple={multiple} className="sr-only" aria-label={`Wybierz pliki do sekcji ${mediaTitle(kind)}`} onClick={(event) => event.stopPropagation()} onChange={(event) => { if (event.target.files?.length) onFiles(event.target.files); event.currentTarget.value = ""; }} />
    <span className="grid justify-items-center gap-2">
      <span className="grid size-11 place-items-center rounded-full bg-white text-[var(--color-terracotta)] shadow-sm"><ImagePlus className="size-5" aria-hidden /></span>
      <span className="font-medium">Przeciągnij pliki tutaj lub kliknij, aby wybrać</span>
      <span className="text-xs text-[var(--color-muted)]">Wybór z klawiatury: Enter lub Spacja</span>
    </span>
  </div>;
}

function MediaAssetRow({ asset, kind, index, total, onRemove, onRetry, onMove }: { asset: AssetDraft; kind: ProductAsset["kind"]; index: number; total: number; onRemove: (asset: AssetDraft) => void; onRetry: (asset: AssetDraft) => void; onMove: (clientId: string, direction: -1 | 1) => void }) {
  const isUploading = asset.status === "uploading" || asset.status === "queued";
  const isFailed = asset.status === "failed";
  const isImage = asset.contentType.startsWith("image/") || /\.(png|jpe?g|gif|svg|webp)$/i.test(asset.filename);
  const isVideo = kind === "video" && asset.contentType.startsWith("video/");

  return <div className="grid min-w-0 gap-3 rounded-xl border border-[var(--color-border)] bg-white p-3 sm:grid-cols-[5rem_minmax(0,1fr)_auto] sm:items-center">
    {asset.status === "uploaded" && isImage ? <AssetPreview asset={asset} /> : asset.status === "uploaded" && isVideo ? <AssetVideoPreview asset={asset} /> : <div className="grid size-20 shrink-0 place-items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-terracotta)]">{kind === "video" ? <Video className="size-6" aria-hidden /> : kind.includes("download") ? <FileText className="size-6" aria-hidden /> : <ImagePlus className="size-6" aria-hidden />}</div>}
    <div className="min-w-0">
      <p className="break-words font-medium">{asset.filename || "Nowy plik"}</p>
      <p className="mt-1 text-xs text-[var(--color-muted)]">{formatBytes(asset.sizeBytes)}</p>
      <p className={`mt-2 inline-flex items-center gap-1 text-xs ${isFailed ? "text-red-800" : "text-[var(--color-muted)]"}`} role={isUploading || isFailed ? "status" : undefined} aria-live="polite">
        {isUploading ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : isFailed ? <X className="size-3.5" aria-hidden /> : asset.status === "queued" ? <LoaderCircle className="size-3.5" aria-hidden /> : <span className="size-1.5 rounded-full bg-emerald-600" aria-hidden />}
        {asset.status === "uploading" ? "Przesyłanie…" : isFailed ? asset.error || "Upload nie powiódł się." : asset.status === "queued" ? "Oczekuje" : "Przesłano"}
      </p>
      {isUploading ? <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--color-bg)]" role="progressbar" aria-label="Postęp przesyłania" aria-valuemin={0} aria-valuemax={100} aria-valuenow={asset.progress ?? 0}><div className="h-full rounded-full bg-[var(--color-terracotta)] transition-[width]" style={{ width: `${asset.progress ?? 0}%` }} /></div> : null}
      {asset.status === "uploaded" && asset.error ? <p role="alert" className="mt-2 text-xs text-red-800">{asset.error}</p> : null}
    </div>
    <div className="flex flex-wrap items-center justify-end gap-1 sm:max-w-32">
      {kind === "gallery" ? <><Button type="button" variant="ghost" size="icon" disabled={index === 0} onClick={() => onMove(asset.clientId, -1)} aria-label={`Przenieś ${asset.filename} wyżej`}><MoveUp className="size-4" aria-hidden /></Button><Button type="button" variant="ghost" size="icon" disabled={index === total - 1} onClick={() => onMove(asset.clientId, 1)} aria-label={`Przenieś ${asset.filename} niżej`}><MoveDown className="size-4" aria-hidden /></Button></> : null}
      <Button type="button" variant="ghost" size="sm" disabled={asset.status === "uploading"} onClick={() => onRemove(asset)} className="text-red-800"><Trash2 className="size-4" aria-hidden />Usuń</Button>
    </div>
    {asset.status === "failed" ? <div className="sm:col-span-2"><Button type="button" variant="outline" size="sm" onClick={() => onRetry(asset)}><RotateCcw className="size-4" aria-hidden />Ponów</Button></div> : null}
    {asset.status === "uploaded" ? hiddenAssetFields(asset) : null}
  </div>;

}

function AssetPreview({ asset }: { asset: AssetDraft }) {
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = previewRef.current;
    if (!element) return;

    const preview = asset.file ? URL.createObjectURL(asset.file) : asset.path;
    if (preview) element.style.backgroundImage = `url("${preview}")`;

    return () => {
      if (asset.file) URL.revokeObjectURL(preview);
      element.style.backgroundImage = "";
    };
  }, [asset.file, asset.path]);

  return <div ref={previewRef} role="img" aria-label={`Podgląd ${asset.filename}`} className="size-20 shrink-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] bg-cover bg-center" />;
}

function AssetVideoPreview({ asset }: { asset: AssetDraft }) {
  const previewRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = previewRef.current;
    if (!element) return;

    const preview = asset.file ? URL.createObjectURL(asset.file) : asset.path;
    if (preview) {
      element.src = preview;
      element.load();
    }

    return () => {
      if (asset.file) URL.revokeObjectURL(preview);
      element.removeAttribute("src");
      element.load();
    };
  }, [asset.file, asset.path]);

  return <video ref={previewRef} className="size-20 shrink-0 rounded-lg border border-[var(--color-border)] bg-black object-cover" controls preload="metadata" aria-label={`Podgląd ${asset.filename}`} />;
}

function RemovedAssetRow({ asset, onUndo }: { asset: AssetDraft; onUndo: (asset: AssetDraft) => void }) {
  return <div className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900"><span className="min-w-0 break-words">„{asset.filename || asset.title}” zostanie usunięty po zapisaniu.</span><Button type="button" variant="ghost" size="sm" onClick={() => onUndo(asset)}><Undo2 className="size-4" aria-hidden />Cofnij</Button>{hiddenAssetFields(asset, true)}</div>;
}

function hiddenAssetFields(asset: AssetDraft, removed = false) {
  const path = asset.storagePath || asset.path;
  if (!asset.id || !path) return null;
  return <span className="hidden" aria-hidden>
    <input type="hidden" name="assetClientId" value={asset.clientId} />
    <input type="hidden" name="assetId" value={asset.id} />
    <input type="hidden" name="assetKind" value={asset.kind} />
    <input type="hidden" name="assetBucket" value={asset.bucket} />
    <input type="hidden" name="assetPath" value={path} />
    <input type="hidden" name="assetStorageProvider" value={asset.storageProvider ?? "supabase"} />
    <input type="hidden" name="assetFilename" value={asset.filename} />
    <input type="hidden" name="assetContentType" value={asset.contentType} />
    <input type="hidden" name="assetSizeBytes" value={asset.sizeBytes ?? ""} />
    <input type="hidden" name="assetTitle" value={asset.title || asset.filename} />
    <input type="hidden" name="assetSortOrder" value={asset.sortOrder} />
    <input type="hidden" name="assetUploaded" value={asset.uploaded ? "1" : "0"} />
    {removed ? <><input type="hidden" name="assetRemove" value={asset.id} /><input type="hidden" name="assetRemoveClientId" value={asset.clientId} /></> : null}
  </span>;
}

function mediaTitle(kind: ProductAsset["kind"]) {
  return { cover: "okładki", gallery: "galerii", video: "wideo flipthrough", public_download: "publicznych plików", premium_download: "materiałów premium" }[kind];
}

function uploadHint(kind: ProductAsset["kind"]) {
  return { cover: "1 obraz · PNG, JPG lub WEBP · maks. 20 MB", gallery: "Maks. 20 obrazów · PNG, JPG lub WEBP · maks. 20 MB każdy", video: "1 plik · MP4 lub WebM · maks. 50 MB", public_download: "Wiele plików · PDF, PNG, JPG lub WEBP · maks. 20 MB każdy", premium_download: "Wiele plików · PDF, PNG, JPG lub WEBP · maks. 50 MB każdy" }[kind];
}

function AmazonEditor({
  link,
  index,
  availableMarkets,
  onChange,
  onPrimary,
  onRemove,
  onUndo,
}: {
  link: AmazonDraft;
  index: number;
  availableMarkets: ReadonlyArray<{ value: AmazonLink["market"]; label: string }>;
  onChange: <K extends keyof AmazonDraft>(clientId: string, field: K, value: AmazonDraft[K]) => void;
  onPrimary: (clientId: string) => void;
  onRemove: (link: AmazonDraft) => void;
  onUndo: () => void;
}) {
  if (link.removed) {
    return <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"><span>Rynek {link.market} zostanie usunięty.</span><><input type="hidden" name="amazonClientId" value={link.clientId} /><input type="hidden" name="amazonId" value={link.id} /><input type="hidden" name="amazonMarket" value={link.market} /><input type="hidden" name="amazonUrl" value={link.url} /><input type="hidden" name="amazonRemove" value={link.id} /><input type="hidden" name="amazonRemoveClientId" value={link.clientId} /><Button type="button" variant="ghost" size="sm" onClick={onUndo}><Undo2 className="size-4" aria-hidden />Cofnij</Button></></div>;
  }
  const primaryValue = link.id || `new-${index}`;
  return <div className="grid min-w-0 gap-3 rounded-lg border border-[var(--color-border)] bg-white p-4 sm:grid-cols-[10rem_minmax(0,1fr)_auto_auto]"><input type="hidden" name="amazonClientId" value={link.clientId} /><input type="hidden" name="amazonId" value={link.id} /><Field label="Rynek" htmlFor={`amazon-market-${link.clientId}`}><select id={`amazon-market-${link.clientId}`} name="amazonMarket" value={link.market} onChange={(event) => onChange(link.clientId, "market", event.target.value as AmazonDraft["market"])} className="h-11 w-full rounded-md border border-[var(--color-border)] bg-white px-3 text-sm">{availableMarkets.map((market) => <option key={market.value} value={market.value}>{market.label}</option>)}</select></Field><Field label="Link" htmlFor={`amazon-url-${link.clientId}`}><Input id={`amazon-url-${link.clientId}`} name="amazonUrl" value={link.url} onChange={(event) => onChange(link.clientId, "url", event.target.value)} placeholder="https://www.amazon.com/..." /></Field><label className="flex items-end gap-2 pb-3 text-sm"><input type="radio" name="amazonPrimary" value={primaryValue} checked={link.isPrimary} onChange={() => onPrimary(link.clientId)} /><Star className="size-4" aria-hidden />Domyślny</label><Button type="button" variant="ghost" size="sm" onClick={() => onRemove(link)} className="self-end text-red-800">Usuń</Button></div>;
}

function PremiumEditor({
  code,
  index,
  error,
  onChange,
  onRemove,
  onUndo,
}: {
  code: PremiumDraft;
  index: number;
  error?: string;
  onChange: <K extends keyof PremiumDraft>(clientId: string, field: K, value: PremiumDraft[K]) => void;
  onRemove: (code: PremiumDraft) => void;
  onUndo: () => void;
}) {
  if (code.removed) {
    return <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"><span>Kod {code.code || "(pusty)"} zostanie usunięty.</span><><input type="hidden" name="premiumCodeClientId" value={code.clientId} /><input type="hidden" name="premiumCodeId" value={code.id} /><input type="hidden" name="premiumCode" value={code.code} /><input type="hidden" name="premiumCodeRemove" value={code.id} /><input type="hidden" name="premiumCodeRemoveClientId" value={code.clientId} /><Button type="button" variant="ghost" size="sm" onClick={onUndo}><Undo2 className="size-4" aria-hidden />Cofnij</Button></></div>;
  }
  const activeValue = code.id || `new-${index}`;
  const inputId = `premium-code-${code.clientId}`;
  const errorId = `${inputId}-error`;
  return <div className="grid min-w-0 gap-3 rounded-lg border border-[var(--color-border)] bg-white p-4 sm:grid-cols-[minmax(0,1fr)_auto_auto]"><input type="hidden" name="premiumCodeClientId" value={code.clientId} /><input type="hidden" name="premiumCodeId" value={code.id} /><Field label="Kod" htmlFor={inputId}><Input id={inputId} name="premiumCode" value={code.code} maxLength={MAX_PREMIUM_CODE_LENGTH} onChange={(event) => onChange(code.clientId, "code", event.target.value.toUpperCase())} placeholder="LOMI-BOOK-2026" aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} />{error ? <p id={errorId} role="alert" className="text-sm text-red-800">{error}</p> : null}</Field><label className="flex items-end gap-2 pb-3 text-sm"><input type="checkbox" name="premiumCodeActive" value={activeValue} checked={code.active} onChange={(event) => onChange(code.clientId, "active", event.target.checked)} />Aktywny</label><Button type="button" variant="ghost" size="sm" onClick={() => onRemove(code)} className="self-end text-red-800">Usuń</Button></div>;
}

function CheckboxGroup({ label, name, values, selected }: { label: string; name: string; values: Array<{ id: string; label: string }>; selected: string[] }) {
  return <fieldset className="grid gap-2"><legend className="text-sm font-medium">{label}</legend>{values.length ? values.map((value) => <label key={value.id} className="flex min-w-0 items-start gap-2 text-sm"><input type="checkbox" name={name} value={value.id} defaultChecked={selected.includes(value.id)} className="mt-0.5 shrink-0" /><span className="break-words">{value.label}</span></label>) : <p className="text-sm text-[var(--color-muted)]">Brak dostępnych elementów.</p>}</fieldset>;
}

function Field({ label, htmlFor, children, error }: { label: string; htmlFor?: string; children: React.ReactNode; error?: string }) {
  return <div className="grid min-w-0 gap-2"><Label htmlFor={htmlFor}>{label}</Label>{children}{error ? <p id={htmlFor ? `${htmlFor}-error` : undefined} className="text-sm text-red-800">{error}</p> : null}</div>;
}

function DangerZone({
  product,
  archiveAction,
  deleteAction,
  disabled,
}: {
  product: Product;
  archiveAction: (formData: FormData) => void | Promise<void>;
  deleteAction: (formData: FormData) => void | Promise<void>;
  disabled: boolean;
}) {
  return <section className="grid gap-4 rounded-lg border border-red-200 bg-red-50/60 p-5"><div><h2 className="font-serif text-2xl font-semibold text-red-950">Strefa niebezpieczna</h2><p className="mt-1 text-sm leading-6 text-red-900/80">Archiwizowanie i usuwanie nie są główną akcją edytora.</p>{disabled ? <p className="mt-2 text-sm text-red-900">Zapisz zmiany przed archiwizacją lub usunięciem produktu.</p> : null}</div><div className="flex flex-wrap gap-2"><form action={archiveAction}><input type="hidden" name="id" value={product.id} /><Button type="submit" variant="outline" disabled={disabled} className="border-red-200 text-red-900 hover:bg-red-100"><Archive className="size-4" aria-hidden />Archiwizuj</Button></form><form action={deleteAction} onSubmit={(event) => { if (!window.confirm("Czy na pewno usunąć ten produkt?")) event.preventDefault(); }}><input type="hidden" name="id" value={product.id} /><button type="submit" disabled={disabled} className={buttonClassName({ variant: "outline", className: "border-red-200 text-red-900 hover:bg-red-100" })}><Trash2 className="size-4" aria-hidden />Usuń produkt</button></form></div></section>;
}

function getProductTextLimitWarning(length: number, maximum: number) {
  const remaining = maximum - length;
  if (remaining < 0 || remaining > PRODUCT_TEXT_WARNING_THRESHOLD) return undefined;
  if (remaining === 0) return `Osiągnięto limit ${maximum} znaków.`;

  const remainder = remaining % 100;
  const unit = remaining === 1
    ? "znak"
    : remaining % 10 >= 2 && remaining % 10 <= 4 && (remainder < 12 || remainder > 14)
      ? "znaki"
      : "znaków";
  return `Zbliżasz się do limitu. Pozostało ${remaining} ${unit}.`;
}

type ProductSaveErrorMapping = {
  fieldErrors: Record<string, string[]>;
  premiumErrors: Partial<Record<string, AdminErrorCode>>;
  focusTarget?: string;
};

function mapProductSaveErrors(
  errors: AdminErrorCode[],
  formData: FormData,
  amazonLinks: AmazonDraft[],
  premiumCodes: PremiumDraft[],
): ProductSaveErrorMapping {
  const fieldErrors: Record<string, string[]> = {};
  const premiumErrors: Partial<Record<string, AdminErrorCode>> = {};
  let focusTarget: string | undefined;

  const addFieldError = (target: string, code: AdminErrorCode) => {
    const message = getAdminErrorMessage(code, "pl");
    fieldErrors[target] = Array.from(new Set([...(fieldErrors[target] ?? []), message]));
    focusTarget ??= target;
  };

  for (const code of errors) {
    switch (code) {
      case ADMIN_ERROR_CODES.VALIDATION_PRODUCT_TITLE_REQUIRED:
      case ADMIN_ERROR_CODES.VALIDATION_PRODUCT_TITLE_TOO_LONG:
        addFieldError("product-title", code);
        break;
      case ADMIN_ERROR_CODES.VALIDATION_PRODUCT_SHORT_DESCRIPTION_TOO_LONG:
        addFieldError("product-short-description", code);
        break;
      case ADMIN_ERROR_CODES.VALIDATION_SLUG_REQUIRED:
      case ADMIN_ERROR_CODES.CONFLICT_SLUG:
        addFieldError("product-slug", code);
        break;
      case ADMIN_ERROR_CODES.VALIDATION_PUBLISH_REQUIREMENTS: {
        let foundTarget = false;
        if (!String(formData.get("title") ?? "").trim()) {
          addFieldError("product-title", code);
          foundTarget = true;
        }
        if (!String(formData.get("shortDescription") ?? "").trim()) {
          addFieldError("product-short-description", code);
          foundTarget = true;
        }
        if (!String(formData.get("coverAssetId") ?? "").trim()) {
          addFieldError("media-section-cover", code);
          foundTarget = true;
        }
        if (!amazonLinks.some((link) => !link.removed && link.url.trim())) {
          addFieldError("product-amazon-links", code);
          foundTarget = true;
        }
        if (!foundTarget) addFieldError("product-status", code);
        break;
      }
      case ADMIN_ERROR_CODES.CONFLICT_AMAZON_MARKET_DUPLICATE:
        addFieldError("product-amazon-links", code);
        break;
      case ADMIN_ERROR_CODES.VALIDATION_COVER_DUPLICATE:
        addFieldError("media-section-cover", code);
        break;
      case ADMIN_ERROR_CODES.VALIDATION_VIDEO_DUPLICATE:
        addFieldError("media-section-video", code);
        break;
      case ADMIN_ERROR_CODES.VALIDATION_GALLERY_LIMIT:
        addFieldError("media-section-gallery", code);
        break;
      case ADMIN_ERROR_CODES.VALIDATION_PREMIUM_CODE_REQUIRED:
      case ADMIN_ERROR_CODES.VALIDATION_PREMIUM_CODE_TOO_LONG:
      case ADMIN_ERROR_CODES.CONFLICT_PREMIUM_CODE_DUPLICATE: {
        const activeCodes = premiumCodes.filter((premiumCode) => !premiumCode.removed);
        let affectedCodes = activeCodes;

        if (code === ADMIN_ERROR_CODES.VALIDATION_PREMIUM_CODE_REQUIRED) {
          affectedCodes = activeCodes.filter((premiumCode) => !premiumCode.code.trim());
        } else if (code === ADMIN_ERROR_CODES.VALIDATION_PREMIUM_CODE_TOO_LONG) {
          affectedCodes = activeCodes.filter((premiumCode) => premiumCode.code.length > MAX_PREMIUM_CODE_LENGTH);
        } else if (code === ADMIN_ERROR_CODES.CONFLICT_PREMIUM_CODE_DUPLICATE) {
          const duplicateIndexes = new Set(validatePremiumCodeEntries(activeCodes).map((issue) => issue.index));
          affectedCodes = activeCodes.filter((_, index) => duplicateIndexes.has(index));
        }

        affectedCodes.forEach((premiumCode) => {
          premiumErrors[premiumCode.clientId] = code;
          focusTarget ??= `premium-code-${premiumCode.clientId}`;
        });
        if (!focusTarget) focusTarget = "product-premium-codes";
        break;
      }
      case ADMIN_ERROR_CODES.CONFLICT_PREMIUM_CODE_EXISTING: {
        const submittedCodes = premiumCodes.filter((premiumCode) => !premiumCode.removed && premiumCode.code.trim());
        if (submittedCodes.length === 1) {
          premiumErrors[submittedCodes[0].clientId] = code;
          focusTarget ??= `premium-code-${submittedCodes[0].clientId}`;
        } else {
          addFieldError("product-premium-codes", code);
        }
        break;
      }
      case ADMIN_ERROR_CODES.VALIDATION_MEDIA_UPLOAD_ACTIVE:
      case ADMIN_ERROR_CODES.VALIDATION_MEDIA_UPLOAD_STATE:
      case ADMIN_ERROR_CODES.VALIDATION_ASSET_UPLOAD_INCOMPLETE:
      case ADMIN_ERROR_CODES.VALIDATION_ASSET_PATH:
      case ADMIN_ERROR_CODES.VALIDATION_ASSET_FILE:
      case ADMIN_ERROR_CODES.VALIDATION_ASSET_VISIBILITY: {
        const knownKinds = new Set<ProductAsset["kind"]>(["cover", "gallery", "video", "public_download", "premium_download"]);
        const submittedKinds = formData.getAll("assetKind").map(String).filter((kind): kind is ProductAsset["kind"] => knownKinds.has(kind as ProductAsset["kind"]));
        for (const kind of new Set(submittedKinds.length ? submittedKinds : ["cover" as const])) {
          addFieldError(`media-section-${kind}`, code);
        }
        break;
      }
      default:
        break;
    }
  }

  if (errors.includes(ADMIN_ERROR_CODES.CONFLICT_AMAZON_MARKET_DUPLICATE) && amazonLinks.every((link) => link.removed)) {
    focusTarget ??= "product-amazon-links";
  }

  return { fieldErrors, premiumErrors, focusTarget };
}

function formSignature(form: HTMLFormElement) {
  return formDataSignature(new FormData(form));
}

function readProductEditorHistoryGuard(state: unknown): ProductEditorHistoryGuard | null {
  if (!state || typeof state !== "object") return null;
  const guard = (state as Record<string, unknown>)[productEditorHistoryGuardKey];
  if (!guard || typeof guard !== "object") return null;
  const { owner, role, forwardHref } = guard as Record<string, unknown>;
  if (typeof owner !== "string" || (role !== "base" && role !== "guard")) return null;
  return { owner, role, forwardHref: typeof forwardHref === "string" ? forwardHref : undefined };
}

function withProductEditorHistoryGuard(state: unknown, guard: ProductEditorHistoryGuard) {
  const currentState = state && typeof state === "object" ? state as Record<string, unknown> : {};
  return { ...currentState, [productEditorHistoryGuardKey]: guard };
}

function formDataSignature(formData: FormData) {
  return JSON.stringify(Array.from(formData.entries()).map(([name, value]) => [
    name,
    value instanceof File ? `${value.name}:${value.size}:${value.lastModified}` : value,
  ]));
}

function scheduleAfterRender(callback: () => void) {
  if (typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(callback);
  } else {
    window.setTimeout(callback, 0);
  }
}

function focusFirstError(targetId?: string) {
  if (!targetId) return;
  const target = document.getElementById(targetId);
  if (!target) return;

  target.scrollIntoView?.({ behavior: "smooth", block: "center" });
  const focusable = target.matches("input, select, textarea, button, [tabindex]")
    ? target
    : target.querySelector<HTMLElement>("input, select, textarea, button, [tabindex]");
  focusable?.focus({ preventScroll: true });
}

function submittedValue(values: ProductSaveFormState["values"], name: string, fallback: string) {
  const entries = values?.[name];
  return entries?.[entries.length - 1] ?? fallback;
}

function submittedValuesFor(values: ProductSaveFormState["values"], name: string, fallback: string[]) {
  return values ? values[name] ?? [] : fallback;
}

function formDataFromProductSaveValues(values: NonNullable<ProductSaveFormState["values"]>) {
  const formData = new FormData();
  for (const [name, entries] of Object.entries(values)) {
    for (const value of entries) formData.append(name, value);
  }
  return formData;
}

function parseProductStatus(value: string): Product["status"] {
  return value === "published" || value === "archived" ? value : "draft";
}

function buildProductContent(
  product?: Product,
  values?: ProductSaveFormState["values"],
): ProductContentDraft {
  const english = product?.translations.find((item) => item.locale === "en");
  return {
    title: submittedValue(values ?? null, "title", english?.title ?? ""),
    shortDescription: submittedValue(values ?? null, "shortDescription", english?.shortDescription ?? ""),
    longDescription: submittedValue(values ?? null, "longDescription", english?.longDescription ?? ""),
    seoTitle: submittedValue(values ?? null, "seoTitle", english?.seoTitle ?? ""),
    seoDescription: submittedValue(values ?? null, "seoDescription", english?.seoDescription ?? ""),
  };
}

function buildAssets(
  product?: Product,
  values?: ProductSaveFormState["values"],
): AssetDraft[] {
  if (values) {
    const ids = values.assetId ?? [];
    const removedClientIds = new Set(values.assetRemoveClientId ?? []);
    const removedIds = new Set(values.assetRemove ?? []);
    return ids.map((id, index) => {
      const itemValue = (name: string, fallback = "") => values[ name ]?.[index] ?? fallback;
      const clientId = itemValue("assetClientId", `submitted-asset-${index}-${id}`);
      const sizeBytes = Number(itemValue("assetSizeBytes"));
      const kind = itemValue("assetKind", "gallery") as ProductAsset["kind"];
      const path = itemValue("assetPath");
      return {
        clientId,
        id,
        kind,
        bucket: itemValue("assetBucket"),
        path,
        filename: itemValue("assetFilename"),
        contentType: itemValue("assetContentType"),
        sizeBytes: Number.isFinite(sizeBytes) && sizeBytes > 0 ? sizeBytes : undefined,
        title: itemValue("assetTitle"),
        sortOrder: Number(itemValue("assetSortOrder", String(index + 1))) || index + 1,
        removed: removedClientIds.has(clientId) || removedIds.has(id),
        status: "uploaded" as const,
        uploaded: itemValue("assetUploaded") === "1",
      };
    });
  }

  return (product?.assets ?? [])
    .filter((asset) => asset.isActive !== false)
    .map((asset, index) => ({ clientId: `existing-asset-${asset.id}`, id: asset.id, kind: asset.kind, bucket: asset.bucket, path: asset.path, storagePath: asset.storagePath, storageProvider: asset.storageProvider ?? "supabase", filename: asset.filename, contentType: asset.contentType, sizeBytes: asset.sizeBytes, title: asset.title ?? "", sortOrder: asset.sortOrder || index + 1, removed: false, status: "uploaded" as const, uploaded: false }));
}

function buildAmazonLinks(
  product?: Product,
  values?: ProductSaveFormState["values"],
): AmazonDraft[] {
  if (values) {
    const ids = values.amazonId ?? [];
    const primary = values.amazonPrimary?.[0];
    const removedClientIds = new Set(values.amazonRemoveClientId ?? []);
    const removedIds = new Set(values.amazonRemove ?? []);
    return ids.map((id, index) => {
      const clientId = values.amazonClientId?.[index] || (id ? `existing-amazon-${id}` : `submitted-amazon-${index}`);
      return {
        clientId,
        id,
        market: values.amazonMarket?.[index] === "amazon.de" ? "amazon.de" : "amazon.com",
        url: values.amazonUrl?.[index] ?? "",
        isPrimary: primary === (id || `new-${index}`),
        removed: removedClientIds.has(clientId) || (Boolean(id) && removedIds.has(id)),
      };
    });
  }

  return (product?.amazonLinks ?? []).map((link) => ({ clientId: `existing-amazon-${link.id}`, id: link.id, market: link.market, url: link.url, isPrimary: link.isPrimary, removed: false }));
}

function buildPremiumCodes(
  product?: Product,
  values?: ProductSaveFormState["values"],
): PremiumDraft[] {
  if (values) {
    const ids = values.premiumCodeId ?? [];
    const activeValues = new Set(values.premiumCodeActive ?? []);
    const removedClientIds = new Set(values.premiumCodeRemoveClientId ?? []);
    const removedIds = new Set(values.premiumCodeRemove ?? []);
    return ids.map((id, index) => {
      const clientId = values.premiumCodeClientId?.[index] || (id ? `existing-code-${id}` : `submitted-code-${index}`);
      return {
        clientId,
        id,
        code: values.premiumCode?.[index] ?? "",
        active: activeValues.has(id || `new-${index}`),
        removed: removedClientIds.has(clientId) || (Boolean(id) && removedIds.has(id)),
      };
    });
  }

  return (product?.premiumCodes ?? []).map((code) => ({ clientId: `existing-code-${code.id}`, id: code.id, code: code.code, active: code.active, removed: false }));
}

function createClientId() {
  return globalThis.crypto?.randomUUID?.() ?? `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatProductType(value: string) {
  return value.split("-").map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(" ");
}

function statusClass(status: Product["status"]) {
  return { draft: "border-amber-200 bg-amber-50 text-amber-900", published: "border-emerald-200 bg-emerald-50 text-emerald-900", archived: "border-slate-200 bg-slate-100 text-slate-700" }[status];
}

function taxonomyLabel(translations: Array<{ locale: string; name: string }>, fallback: string) {
  return translations.find((translation) => translation.locale === "en")?.name || fallback;
}
