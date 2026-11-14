import { useEffect, useRef, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import {
  SheetClose,
  SheetDescription,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
} from "@/components/ui/sheet";
import type { Detail } from "./detail";
import { ErrorState } from "./list-states";
import type { RecordKind } from "./open-record";

const KIND_TEXT = {
  task: { noun: "task", register: "task list" },
  decision: { noun: "decision", register: "decision register" },
  raid: { noun: "RAID item", register: "RAID register" },
  lesson: { noun: "lesson", register: "lessons log" },
} as const satisfies Record<RecordKind, { noun: string; register: string }>;

/**
 * A right-hand sheet, open while `detail` is not closed. Radix gives the focus trap, Escape, scroll lock, an inert
 * background and focus return. It composes Dialog.Content directly because `SheetContent` hard-codes a black overlay
 * and a 24rem cap.
 */
export function DetailSheet<T extends { readonly id: string }>({
  detail,
  kind,
  title,
  summary,
  onClose,
  children,
}: {
  detail: Detail<T>;
  kind: RecordKind;
  /** The sheet's accessible name. */
  title: (item: T) => string;
  summary?: ((item: T) => string | null) | undefined;
  onClose: () => void;
  children: (item: T) => ReactNode;
}): ReactNode {
  const opener = useRef<HTMLElement | null>(null);
  const lastId = useRef<string | null>(null);
  const id =
    detail.state === "closed" ? null : detail.state === "ready" ? detail.item.id : detail.id;
  useEffect(() => {
    if (id !== null) lastId.current = id;
  }, [id]);

  const rememberOpener = () => {
    const active = document.activeElement;
    opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
  };

  // Radix's own fallback focuses the Dialog.Trigger, and this sheet has none (the URL opens it), so focus is always
  // placed here. The opener can be gone by the time the sheet closes: a decided item leaves the Pending list, and a
  // deep link never had one. Then focus goes to the record's row if it is on the page, else to the page heading.
  const returnFocus = (event: Event) => {
    event.preventDefault();
    if (opener.current?.isConnected) {
      opener.current.focus();
      return;
    }
    const key = `${kind}:${lastId.current ?? ""}`;
    const row = Array.from(document.querySelectorAll<HTMLElement>("[data-record]")).find(
      (element) => element.dataset["record"] === key,
    );
    (row ?? document.querySelector<HTMLElement>("h1"))?.focus();
  };

  const text = KIND_TEXT[kind];
  const description = detail.state === "ready" && summary ? summary(detail.item) : null;

  return (
    <Dialog.Root
      open={detail.state !== "closed"}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetPortal>
        <SheetOverlay className="bg-foreground/25" />
        <Dialog.Content
          className="detail-panel data-[state=open]:animate-in data-[state=open]:slide-in-from-right"
          onOpenAutoFocus={rememberOpener}
          onCloseAutoFocus={returnFocus}
          aria-busy={detail.state === "loading" || undefined}
        >
          <header className="detail-head">
            {detail.state === "ready" ? (
              <code className="record-id">{detail.item.id}</code>
            ) : (
              <span />
            )}
            <SheetClose className="detail-close" aria-label="Close">
              <X aria-hidden="true" />
            </SheetClose>
          </header>
          <SheetTitle className="detail-title text-xl">
            {detail.state === "ready" ? title(detail.item) : id}
          </SheetTitle>
          {description !== null && (
            <SheetDescription className="detail-summary">{description}</SheetDescription>
          )}
          <div className="detail-body">
            {detail.state === "ready" && children(detail.item)}
            {detail.state === "loading" && (
              <p className="quiet">
                Loading {text.noun} {detail.id}.
              </p>
            )}
            {detail.state === "missing" && (
              <p>
                {detail.id} is not in the {text.register}.
              </p>
            )}
            {detail.state === "failed" && <ErrorState error={detail.error} />}
          </div>
        </Dialog.Content>
      </SheetPortal>
    </Dialog.Root>
  );
}
