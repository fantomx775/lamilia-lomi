import { renderRichTextValue } from "@/lib/rich-text";

export function RichTextContent({ value, className = "" }: { value: string; className?: string }) {
  return (
    <div className={`break-words ${className}`.trim()}>
      {renderRichTextValue(value)}
    </div>
  );
}
