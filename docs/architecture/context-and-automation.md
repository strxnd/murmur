# Context and Automation

Context capture combines active-window metadata, selected text, and recent clipboard text. Paste automation uses the same serialized text-automation queue so copy and paste shortcuts do not overlap.

```mermaid
sequenceDiagram
  participant Main as AppController
  participant Context as ContextService
  participant Queue as TextAutomationService queue
  participant Clipboard as Electron and Linux clipboard
  participant Backend as Linux automation backend
  participant Paste as PasteService

  Main->>Context: capture({ selectedText })
  Context->>Context: Capture desktop metadata
  alt selected text enabled and automation available
    Context->>Queue: runExclusive(copy selection)
    Queue->>Clipboard: Snapshot text/html/rtf/image
    Queue->>Clipboard: Write sentinel
    Queue->>Backend: Send copy shortcut
    Queue->>Clipboard: Poll clipboard or primary selection
    Queue->>Clipboard: Restore original clipboard snapshot
    Queue-->>Context: selectedText or undefined
  end
  Context-->>Main: ContextSnapshot
  Main->>Paste: insertText(output)
  Paste->>Queue: runExclusive(paste output)
  Queue->>Clipboard: Write output to clipboard and primary selection
  Queue->>Backend: Send paste shortcut
  Queue-->>Paste: success or fallback message
  Paste-->>Main: pasted flag and message
```

## Desktop Metadata

[`DesktopMetadataService`](../../src/main/services/context-metadata.ts) supports Linux metadata backends:

- X11 through `xdotool` and `xprop`.
- Hyprland through `hyprctl`.
- GNOME Shell through `gdbus` and `org.gnome.Shell.Eval`.
- KDE KWin through `qdbus` or `qdbus6` plus a temporary KWin script callback.

The capability report advertises active app metadata when at least one backend is detected. Focused text and browser-domain capability flags are currently reported as unavailable, although the shared `ContextSnapshot` type has fields for them.

## Selected Text

Selected-text capture is implemented by copying the current selection, reading the clipboard or primary selection, and restoring the original clipboard snapshot. It only runs when selected-text capture is enabled and text automation is available.

## Paste Automation

[`LinuxTextAutomationService`](../../src/main/services/linux-text-automation.ts) orders candidate backends by desktop environment:

- Native helper when built and executable.
- `wtype` for wlroots Wayland sessions.
- `xdotool` for X11 or XWayland targets.
- `ydotool` when configured.
- XDG RemoteDesktop keyboard portal.

If every backend fails or none are available, Murmur leaves output on the clipboard and reports a fallback message.
