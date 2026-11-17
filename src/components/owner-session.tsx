import { useId, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { forgetOwnerKey, rememberOwnerKey, useOwnerKey } from "./owner-key";

export function OwnerKeyControl(): ReactNode {
  const key = useOwnerKey();
  if (key === null) return <OwnerKeyDialog />;
  return (
    <div className="owner-mode">
      <span className="owner-mode-label">
        <ShieldCheck aria-hidden="true" />
        Owner mode
      </span>
      <Button type="button" variant="ghost" size="sm" onClick={forgetOwnerKey}>
        Forget key
      </Button>
    </div>
  );
}

/**
 * Public mode's pointer to owner mode: says what needs the key and opens the same key dialog as the header. Storing the
 * key unmounts the prompt with its button, so focus moves to `focusAfter`, which the caller keeps mounted or mounts.
 */
export function OwnerKeyPrompt({
  children,
  focusAfter,
}: {
  children: ReactNode;
  focusAfter: RefObject<HTMLElement | null>;
}): ReactNode {
  return (
    <div className="owner-key-prompt">
      <p>{children}</p>
      <OwnerKeyDialog trigger="Enter owner key" focusAfter={focusAfter} />
    </div>
  );
}

function OwnerKeyDialog({
  trigger = "Owner key",
  focusAfter,
}: {
  trigger?: string;
  focusAfter?: RefObject<HTMLElement | null>;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const stored = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const errorId = useId();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const entry = new FormData(event.currentTarget).get("owner-key");
    const value = typeof entry === "string" ? entry.trim() : "";
    if (value === "" || /\s/.test(value)) {
      setError("Paste the owner key as one piece of text, with no spaces.");
      return;
    }
    if (!rememberOwnerKey(value)) {
      setError("This browser blocks session storage, so it cannot keep the key.");
      return;
    }
    stored.current = true;
    setOpen(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          {trigger}
        </Button>
      </DialogTrigger>
      <DialogContent
        onCloseAutoFocus={(event) => {
          const target = stored.current ? focusAfter?.current : null;
          if (target === null || target === undefined) return;
          event.preventDefault();
          target.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Owner key</DialogTitle>
          <DialogDescription>
            Reading the dashboard needs no key. The owner key unlocks decisions and stays in this
            browser tab until you close it.
          </DialogDescription>
        </DialogHeader>
        <form className="owner-key-form" onSubmit={submit}>
          <label htmlFor={inputId}>Owner key</label>
          <input
            id={inputId}
            name="owner-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            required
            aria-invalid={error !== null || undefined}
            aria-describedby={error !== null ? errorId : undefined}
          />
          {error !== null && (
            <p id={errorId} role="alert" className="field-error">
              {error}
            </p>
          )}
          <Button type="submit">Use key</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
