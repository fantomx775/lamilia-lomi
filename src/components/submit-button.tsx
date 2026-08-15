"use client";

import { useFormStatus } from "react-dom";
import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";

type Props = ComponentProps<typeof Button> & {
  pendingLabel: string;
};

export function SubmitButton({ pendingLabel, children, disabled, ...props }: Props) {
  const { pending } = useFormStatus();

  return (
    <Button {...props} disabled={disabled || pending} type="submit">
      {pending ? pendingLabel : children}
    </Button>
  );
}
