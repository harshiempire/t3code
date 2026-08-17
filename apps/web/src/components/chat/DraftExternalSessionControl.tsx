import { memo, useState } from "react";
import { SquareTerminalIcon, XIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";

const CLAUDE_SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Draft-only control for attaching an external Claude Code CLI session that
 * the thread's first turn should resume. Renders as a subtle affordance
 * while unset and as a removable chip once a session id is attached. The
 * session id must match the project's directory on disk for the resume to
 * pick up the prior conversation, so keep the copy explicit about Claude
 * Code rather than generic.
 */
export const DraftExternalSessionControl = memo(function DraftExternalSessionControl(props: {
  externalResumeSessionId: string | null;
  onChange: (externalResumeSessionId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pendingSessionId, setPendingSessionId] = useState("");
  const trimmedPendingSessionId = pendingSessionId.trim();
  const isPendingSessionIdValid = CLAUDE_SESSION_ID_PATTERN.test(trimmedPendingSessionId);

  if (props.externalResumeSessionId !== null) {
    return (
      <div className="pointer-events-auto mx-auto mb-2 flex w-fit items-center gap-1.5 rounded-full border border-border/60 bg-muted/40 py-1 ps-3 pe-1 text-muted-foreground text-xs">
        <SquareTerminalIcon aria-hidden="true" className="size-3.5 shrink-0" />
        <span>
          Resuming Claude Code session{" "}
          <span className="font-mono">{props.externalResumeSessionId.slice(0, 8)}</span>
        </span>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Remove resumed Claude Code session"
          className="size-5 rounded-full"
          onClick={() => props.onChange(null)}
        >
          <XIcon aria-hidden="true" className="size-3" />
        </Button>
      </div>
    );
  }

  return (
    <div className="pointer-events-auto mx-auto mb-2 flex w-fit">
      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) {
            setPendingSessionId("");
          }
        }}
      >
        <PopoverTrigger
          render={
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1.5 rounded-full px-3 text-muted-foreground/70 text-xs hover:text-foreground/80"
            />
          }
        >
          <SquareTerminalIcon aria-hidden="true" className="size-3.5" />
          Resume a Claude Code session
        </PopoverTrigger>
        <PopoverPopup align="center" className="w-80 p-3">
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!isPendingSessionIdValid) return;
              props.onChange(trimmedPendingSessionId.toLowerCase());
              setPendingSessionId("");
              setOpen(false);
            }}
          >
            <div className="text-muted-foreground text-xs">
              Paste the session id of a Claude Code CLI conversation started in this project's
              directory. The first message you send continues that conversation with its full
              context. Earlier terminal messages stay in the terminal.
            </div>
            <Input
              autoFocus
              value={pendingSessionId}
              onChange={(event) => setPendingSessionId(event.target.value)}
              placeholder="e.g. f66f4325-82ae-4e1c-999a-9c0f4efe4320"
              spellCheck={false}
              className="font-mono text-xs"
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" type="button" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" type="submit" disabled={!isPendingSessionIdValid}>
                Attach session
              </Button>
            </div>
          </form>
        </PopoverPopup>
      </Popover>
    </div>
  );
});
