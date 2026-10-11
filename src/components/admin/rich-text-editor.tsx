"use client";

import type { JSONContent } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Italic, Link2, Link2Off, List, ListOrdered, Minus, Quote, Redo2, Underline, Undo2 } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { importRichTextHtml, richTextDocumentToHtml, type RichTextHtmlWarning } from "@/lib/rich-text-html";
import {
  richTextDocumentForEditor,
  sanitizeRichTextHref,
  serializeRichTextDocument,
} from "@/lib/rich-text";

const extensions = [
  StarterKit.configure({
    heading: { levels: [2, 3] },
    blockquote: {},
    code: false,
    codeBlock: false,
    horizontalRule: {},
    strike: false,
    underline: {},
    link: {
      autolink: true,
      linkOnPaste: true,
      openOnClick: false,
      defaultProtocol: "https",
      isAllowedUri: (href) => Boolean(sanitizeRichTextHref(href)),
      HTMLAttributes: {
        target: "_blank",
        rel: "noopener noreferrer nofollow",
      },
    },
  }),
];

type LinkSelection = { from: number; to: number; activeLink: boolean; selectedText: string };

export function RichTextEditor({
  id,
  name,
  label,
  value,
  onChange,
  onSourceDraftChange,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSourceDraftChange?: (hasUnappliedDraft: boolean) => void;
}) {
  const onChangeRef = useRef(onChange);
  const lastValueRef = useRef(value);
  const linkSelectionRef = useRef<LinkSelection | null>(null);
  const linkTextInputRef = useRef<HTMLInputElement>(null);
  const htmlTextareaRef = useRef<HTMLTextAreaElement>(null);
  const onSourceDraftChangeRef = useRef(onSourceDraftChange);
  const [formValue, setFormValue] = useState(value);
  const [mode, setMode] = useState<"rich" | "html">("rich");
  const [htmlSource, setHtmlSource] = useState(() => richTextDocumentToHtml(value));
  const [htmlHasUnappliedChanges, setHtmlHasUnappliedChanges] = useState(false);
  const [htmlWarnings, setHtmlWarnings] = useState<RichTextHtmlWarning[]>([]);
  const [htmlCanConvert, setHtmlCanConvert] = useState(true);
  const [linkPanelOpen, setLinkPanelOpen] = useState(false);
  const [linkText, setLinkText] = useState("");
  const [linkHref, setLinkHref] = useState("");
  const [linkError, setLinkError] = useState("");
  const [, setToolbarRevision] = useState(0);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onSourceDraftChangeRef.current = onSourceDraftChange;
  }, [onSourceDraftChange]);

  const editor = useEditor({
    extensions,
    content: richTextDocumentForEditor(value) as JSONContent,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        id,
        role: "textbox",
        "aria-label": label,
        "aria-multiline": "true",
        class: "min-h-64 w-full rounded-b-xl bg-white px-4 py-3 text-sm leading-7 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-terracotta)] [&_h2]:mt-6 [&_h2]:font-serif [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-5 [&_h3]:font-serif [&_h3]:text-lg [&_h3]:font-semibold [&_p]:whitespace-pre-wrap [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--color-terracotta)] [&_blockquote]:pl-4 [&_hr]:my-6 [&_hr]:border-[var(--color-border)] [&_u]:underline",
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      const nextValue = serializeRichTextDocument(currentEditor.getJSON());
      lastValueRef.current = nextValue;
      setFormValue(nextValue);
      onChangeRef.current(nextValue);
    },
    onSelectionUpdate: () => setToolbarRevision((revision) => revision + 1),
  }, []);

  useEffect(() => {
    if (value === lastValueRef.current) return;
    lastValueRef.current = value;
    setFormValue(value);
    editor?.commands.setContent(richTextDocumentForEditor(value) as JSONContent, { emitUpdate: false });
  }, [editor, value]);

  useEffect(() => {
    if (linkPanelOpen) linkTextInputRef.current?.focus();
  }, [linkPanelOpen]);

  useEffect(() => {
    htmlTextareaRef.current?.setCustomValidity(
      htmlHasUnappliedChanges ? "Najpierw skonwertuj albo popraw źródło HTML." : "",
    );
  }, [htmlHasUnappliedChanges, mode]);

  const rememberSelection = () => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    linkSelectionRef.current = {
      from,
      to,
      activeLink: editor.isActive("link"),
      selectedText: editor.state.doc.textBetween(from, to, " "),
    };
    setLinkText(editor.state.doc.textBetween(from, to, " ") || String(editor.getAttributes("link").text ?? ""));
    setLinkHref(String(editor.getAttributes("link").href ?? ""));
    setLinkError("");
    setLinkPanelOpen(true);
  };

  const applyLink = () => {
    if (!editor) return;
    const safeHref = sanitizeRichTextHref(linkHref);
    if (!safeHref) {
      setLinkError("Wpisz bezpieczny adres: https://, mailto: lub ścieżkę wewnętrzną zaczynającą się od /.");
      return;
    }

    const selection = linkSelectionRef.current ?? {
      from: editor.state.selection.from,
      to: editor.state.selection.to,
      activeLink: editor.isActive("link"),
      selectedText: editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, " "),
    };
    const replacementText = linkText.trim();

    if (selection.from !== selection.to) {
      if (replacementText && replacementText !== selection.selectedText) {
        editor.chain().focus().insertContentAt(
          { from: selection.from, to: selection.to },
          {
            type: "text",
            text: replacementText,
            marks: [{ type: "link", attrs: { href: safeHref } }],
          },
        ).run();
      } else {
        editor.chain().focus().setTextSelection({ from: selection.from, to: selection.to }).setLink({ href: safeHref }).run();
      }
    } else if (selection.activeLink) {
      editor.chain().focus().extendMarkRange("link").setLink({ href: safeHref }).run();
    } else if (replacementText) {
      editor.chain().focus().insertContentAt(selection.from, {
        type: "text",
        text: replacementText,
        marks: [{ type: "link", attrs: { href: safeHref } }],
      }).run();
    } else {
      setLinkError("Zaznacz tekst albo wpisz tekst linku.");
      return;
    }

    setLinkPanelOpen(false);
    setLinkError("");
  };

  const cancelLink = () => {
    setLinkPanelOpen(false);
    setLinkError("");
  };

  const enterHtmlMode = () => {
    if (mode === "html") return;
    setLinkPanelOpen(false);
    setHtmlSource(richTextDocumentToHtml(formValue));
    setHtmlWarnings([]);
    setHtmlCanConvert(true);
    setHtmlHasUnappliedChanges(false);
    onSourceDraftChangeRef.current?.(false);
    setMode("html");
  };

  const commitHtmlConversion = () => {
    const imported = importRichTextHtml(htmlSource);
    setHtmlWarnings(imported.warnings);
    setHtmlCanConvert(imported.canConvert);
    if (!imported.canConvert) return;

    const nextValue = serializeRichTextDocument(imported.document);
    lastValueRef.current = nextValue;
    setFormValue(nextValue);
    setHtmlSource(richTextDocumentToHtml(nextValue));
    editor?.commands.setContent(richTextDocumentForEditor(nextValue) as JSONContent, { emitUpdate: false });
    onChangeRef.current(nextValue);
    setHtmlHasUnappliedChanges(false);
    onSourceDraftChangeRef.current?.(false);
    setHtmlWarnings([]);
    setMode("rich");
  };

  const returnToRichMode = () => {
    setLinkPanelOpen(false);
    if (!htmlHasUnappliedChanges) {
      setMode("rich");
      return;
    }

    const imported = importRichTextHtml(htmlSource);
    setHtmlWarnings(imported.warnings);
    setHtmlCanConvert(imported.canConvert);
    if (imported.canConvert && imported.warnings.length === 0) commitHtmlConversion();
  };

  const handleHtmlSourceChange = (nextSource: string) => {
    setHtmlSource(nextSource);
    setHtmlHasUnappliedChanges(true);
    htmlTextareaRef.current?.setCustomValidity("Najpierw skonwertuj albo popraw źródło HTML.");
    setHtmlWarnings([]);
    setHtmlCanConvert(true);
    onSourceDraftChangeRef.current?.(true);
  };

  const buttonClassName = "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-md border border-[var(--color-border)] bg-white px-3 text-sm text-[var(--color-ink)] transition hover:bg-[var(--color-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-terracotta)] disabled:cursor-not-allowed disabled:opacity-50";
  const isToolbarDisabled = !editor || mode !== "rich";

  return (
    <div className="grid min-w-0 gap-2">
      <input type="hidden" name={name} value={formValue} disabled={!editor} />
      <input type="hidden" data-rich-text-draft="true" value={htmlHasUnappliedChanges ? htmlSource : ""} />
      <noscript>
        <div className="grid gap-2">
          <label className="text-sm font-medium" htmlFor={`${id}-plain-text`}>Treść w formacie zwykłego tekstu</label>
          <textarea
            id={`${id}-plain-text`}
            name={name}
            defaultValue={value}
            className="min-h-64 w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-3 text-sm leading-6 outline-none focus:border-[var(--color-terracotta)] focus:ring-4 focus:ring-[var(--color-terracotta-ring)]"
          />
        </div>
      </noscript>

      <div className="min-w-0 overflow-hidden rounded-xl border border-[var(--color-border)] bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-bg)] p-2" role="toolbar" aria-label={`Formatowanie: ${label}`}>
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Styl tekstu">
            <select
              aria-label="Styl akapitu"
              disabled={isToolbarDisabled}
              value={editor?.isActive("heading", { level: 2 }) ? "h2" : editor?.isActive("heading", { level: 3 }) ? "h3" : "paragraph"}
              onChange={(event) => {
                if (!editor) return;
                if (event.target.value === "h2") editor.chain().focus().toggleHeading({ level: 2 }).run();
                else if (event.target.value === "h3") editor.chain().focus().toggleHeading({ level: 3 }).run();
                else editor.chain().focus().setParagraph().run();
              }}
              className="min-h-11 min-w-32 rounded-md border border-[var(--color-border)] bg-white px-3 text-sm text-[var(--color-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-terracotta)] disabled:opacity-50"
            >
              <option value="paragraph">Akapit</option>
              <option value="h2">Nagłówek 2</option>
              <option value="h3">Nagłówek 3</option>
            </select>
            <ToolbarButton label="Pogrubienie" pressed={Boolean(editor?.isActive("bold"))} disabled={isToolbarDisabled} className={buttonClassName} onClick={() => editor?.chain().focus().toggleBold().run()}>
              <Bold className="size-4" aria-hidden />
            </ToolbarButton>
            <ToolbarButton label="Kursywa" pressed={Boolean(editor?.isActive("italic"))} disabled={isToolbarDisabled} className={buttonClassName} onClick={() => editor?.chain().focus().toggleItalic().run()}>
              <Italic className="size-4" aria-hidden />
            </ToolbarButton>
            <ToolbarButton label="Podkreślenie" pressed={Boolean(editor?.isActive("underline"))} disabled={isToolbarDisabled} className={buttonClassName} onClick={() => editor?.chain().focus().toggleUnderline().run()}>
              <Underline className="size-4" aria-hidden />
            </ToolbarButton>
          </div>

          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Listy, cytaty i linki">
            <ToolbarButton label="Lista punktowana" pressed={Boolean(editor?.isActive("bulletList"))} disabled={isToolbarDisabled} className={buttonClassName} onClick={() => editor?.chain().focus().toggleBulletList().run()}>
              <List className="size-4" aria-hidden />
            </ToolbarButton>
            <ToolbarButton label="Lista numerowana" pressed={Boolean(editor?.isActive("orderedList"))} disabled={isToolbarDisabled} className={buttonClassName} onClick={() => editor?.chain().focus().toggleOrderedList().run()}>
              <ListOrdered className="size-4" aria-hidden />
            </ToolbarButton>
            <ToolbarButton label="Cytat" pressed={Boolean(editor?.isActive("blockquote"))} disabled={isToolbarDisabled} className={buttonClassName} onClick={() => editor?.chain().focus().toggleBlockquote().run()}>
              <Quote className="size-4" aria-hidden />
            </ToolbarButton>
            <ToolbarButton label="Linia pozioma" disabled={isToolbarDisabled} className={buttonClassName} onClick={() => editor?.chain().focus().setHorizontalRule().run()}>
              <Minus className="size-4" aria-hidden />
            </ToolbarButton>
            <ToolbarButton label="Dodaj lub edytuj link" pressed={Boolean(editor?.isActive("link"))} disabled={isToolbarDisabled} className={buttonClassName} onMouseDown={(event) => event.preventDefault()} onClick={rememberSelection}>
              <Link2 className="size-4" aria-hidden />
            </ToolbarButton>
            <ToolbarButton label="Usuń link" disabled={isToolbarDisabled || !editor?.isActive("link")} className={buttonClassName} onClick={() => editor?.chain().focus().extendMarkRange("link").unsetLink().run()}>
              <Link2Off className="size-4" aria-hidden />
            </ToolbarButton>
          </div>

          <div className="flex items-center gap-1" role="group" aria-label="Cofnij i ponów">
            <ToolbarButton label="Cofnij ostatnią zmianę" disabled={!editor || mode !== "rich" || !editor.can().undo()} className={buttonClassName} onClick={() => editor?.chain().focus().undo().run()}>
              <Undo2 className="size-4" aria-hidden />
            </ToolbarButton>
            <ToolbarButton label="Przywróć ostatnią zmianę" disabled={!editor || mode !== "rich" || !editor.can().redo()} className={buttonClassName} onClick={() => editor?.chain().focus().redo().run()}>
              <Redo2 className="size-4" aria-hidden />
            </ToolbarButton>
          </div>

          <div className="ml-auto flex items-center gap-1" role="group" aria-label="Tryb edycji">
            <button type="button" aria-pressed={mode === "rich"} className={buttonClassName + (mode === "rich" ? " border-[var(--color-terracotta)] bg-[var(--color-terracotta-ring)]" : "")} onClick={returnToRichMode}>
              Rich Text
            </button>
            <button type="button" aria-pressed={mode === "html"} className={buttonClassName + (mode === "html" ? " border-[var(--color-terracotta)] bg-[var(--color-terracotta-ring)]" : "")} onClick={enterHtmlMode}>
              HTML
            </button>
          </div>
        </div>

        {linkPanelOpen && editor ? (
          <div className="grid gap-3 border-b border-[var(--color-border)] bg-white p-3 sm:grid-cols-[minmax(8rem,1fr)_minmax(12rem,1.5fr)_auto] sm:items-end" role="group" aria-label="Ustawienia linku">
            <label className="grid gap-1 text-sm font-medium" htmlFor={`${id}-link-text`}>
              Tekst linku
              <input
                ref={linkTextInputRef}
                id={`${id}-link-text`}
                value={linkText}
                onChange={(event) => setLinkText(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); applyLink(); } }}
                className="min-h-11 w-full rounded-md border border-[var(--color-border)] px-3 font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-terracotta)]"
              />
            </label>
            <label className="grid gap-1 text-sm font-medium" htmlFor={`${id}-link-href`}>
              Adres strony
              <input
                id={`${id}-link-href`}
                inputMode="url"
                value={linkHref}
                onChange={(event) => setLinkHref(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); applyLink(); } }}
                placeholder="https://example.com lub /terms"
                className="min-h-11 w-full rounded-md border border-[var(--color-border)] px-3 font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-terracotta)]"
              />
            </label>
            <div className="flex flex-wrap gap-2 sm:justify-end">
              <Button type="button" onClick={applyLink}>Zapisz link</Button>
              <Button type="button" variant="outline" onClick={cancelLink}>Anuluj</Button>
            </div>
            {linkError ? <p className="text-sm text-red-800 sm:col-span-3" role="alert">{linkError}</p> : null}
          </div>
        ) : null}

        {mode === "html" ? (
          <div className="grid min-w-0 gap-3 bg-white p-3 sm:p-4">
            <label className="grid gap-2 text-sm font-medium" htmlFor={id + "-html-source"}>
              Źródło HTML
              <textarea
                ref={htmlTextareaRef}
                id={id + "-html-source"}
                aria-label="Źródło HTML"
                aria-invalid={htmlHasUnappliedChanges && htmlWarnings.length > 0}
                value={htmlSource}
                onChange={(event) => handleHtmlSourceChange(event.target.value)}
                onInvalid={() => {
                  const imported = importRichTextHtml(htmlSource);
                  setHtmlWarnings(imported.warnings.length ? imported.warnings : [{
                    code: "invalid-markup",
                    message: "Najpierw użyj trybu Rich Text, aby zastosować zmiany źródła HTML.",
                  }]);
                  setHtmlCanConvert(imported.canConvert);
                }}
                spellCheck={false}
                autoCapitalize="off"
                wrap="soft"
                rows={12}
                className="min-h-64 w-full resize-y rounded-b-xl border border-[var(--color-border)] bg-white px-3 py-3 font-mono text-xs leading-6 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-terracotta)] sm:text-sm"
              />
            </label>
            {htmlWarnings.length ? (
              <div className="grid gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" role="status" aria-live="polite">
                <p className="font-semibold">Przed konwersją sprawdź obsługiwane formatowanie:</p>
                <ul className="grid list-disc gap-1 pl-5">
                  {htmlWarnings.map((warning) => <li key={warning.code + ":" + warning.message}>{warning.message}</li>)}
                </ul>
                {htmlCanConvert && htmlHasUnappliedChanges ? (
                  <div><Button type="button" variant="outline" onClick={commitHtmlConversion}>Użyj obsługiwanej treści</Button></div>
                ) : null}
              </div>
            ) : null}
            <p className="text-xs leading-5 text-[var(--color-muted)]">
              Zapisane zostaną tylko akapity, nagłówki 2–3, listy, cytaty, linie, pogrubienie, kursywa, podkreślenie i bezpieczne linki.
            </p>
          </div>
        ) : (
          <div className="min-h-64 bg-white">
            <EditorContent editor={editor} />
            {!editor ? <p className="px-4 py-3 text-sm text-[var(--color-muted)]" role="status">Ładowanie edytora…</p> : null}
          </div>
        )}
      </div>

      <p className="text-xs leading-5 text-[var(--color-muted)]">
        Możesz wklejać tekst z Worda lub Dokumentów Google. Zmiany w źródle HTML przejrzyj i zastosuj przed zapisem.
        Zaznacz tekst przed dodaniem linku albo wpisz jego treść w ustawieniach linku.
      </p>
    </div>
  );
}

function ToolbarButton({
  label,
  pressed,
  disabled,
  className,
  onClick,
  onMouseDown,
  children,
}: {
  label: string;
  pressed?: boolean;
  disabled: boolean;
  className: string;
  onClick?: () => void;
  onMouseDown?: (event: MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`${className}${pressed ? " border-[var(--color-terracotta)] bg-[var(--color-terracotta-ring)]" : ""}`}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      disabled={disabled}
      onPointerDown={(event) => event.preventDefault()}
      onMouseDown={onMouseDown ?? ((event) => event.preventDefault())}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
