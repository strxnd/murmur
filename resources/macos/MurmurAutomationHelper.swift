import ApplicationServices
import AppKit
import Foundation

private let copyKeyCode: CGKeyCode = 8
private let pasteKeyCode: CGKeyCode = 9

func emitJson(_ payload: [String: Any]) {
  let data = try! JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write("\n".data(using: .utf8)!)
}

func isTrusted() -> Bool {
  AXIsProcessTrusted()
}

func emitShortcut(keyCode: CGKeyCode, flags: CGEventFlags) -> Bool {
  guard let source = CGEventSource(stateID: .hidSystemState),
        let down = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: true),
        let up = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: false) else {
    return false
  }

  down.flags = flags
  up.flags = flags
  down.post(tap: .cghidEventTap)
  up.post(tap: .cghidEventTap)
  return true
}

func selectedText() -> String? {
  let systemWide = AXUIElementCreateSystemWide()
  var focused: CFTypeRef?
  let focusResult = AXUIElementCopyAttributeValue(systemWide, kAXFocusedUIElementAttribute as CFString, &focused)
  guard focusResult == .success, let focusedElement = focused else {
    return nil
  }

  var selected: CFTypeRef?
  let selectedResult = AXUIElementCopyAttributeValue(focusedElement as! AXUIElement, kAXSelectedTextAttribute as CFString, &selected)
  guard selectedResult == .success else {
    return nil
  }
  return selected as? String
}

func accessibilityWindowBounds(_ window: AXUIElement) -> CGRect? {
  var positionValue: CFTypeRef?
  var sizeValue: CFTypeRef?
  guard AXUIElementCopyAttributeValue(window, kAXPositionAttribute as CFString, &positionValue) == .success,
        AXUIElementCopyAttributeValue(window, kAXSizeAttribute as CFString, &sizeValue) == .success,
        let positionValue,
        let sizeValue else {
    return nil
  }

  var position = CGPoint.zero
  var size = CGSize.zero
  guard AXValueGetValue(positionValue as! AXValue, .cgPoint, &position),
        AXValueGetValue(sizeValue as! AXValue, .cgSize, &size) else {
    return nil
  }
  return CGRect(origin: position, size: size)
}

func coreGraphicsWindowId(_ window: AXUIElement, processIdentifier: pid_t) -> CGWindowID? {
  guard let targetBounds = accessibilityWindowBounds(window),
        let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
          as? [[String: Any]] else {
    return nil
  }

  for info in windows {
    guard let ownerPid = info[kCGWindowOwnerPID as String] as? NSNumber,
          ownerPid.int32Value == processIdentifier,
          let windowNumber = info[kCGWindowNumber as String] as? NSNumber,
          let boundsDictionary = info[kCGWindowBounds as String] as? NSDictionary else {
      continue
    }

    var bounds = CGRect.zero
    guard CGRectMakeWithDictionaryRepresentation(boundsDictionary, &bounds) else {
      continue
    }
    let matchesBounds = abs(bounds.origin.x - targetBounds.origin.x) < 1 &&
      abs(bounds.origin.y - targetBounds.origin.y) < 1 &&
      abs(bounds.size.width - targetBounds.size.width) < 1 &&
      abs(bounds.size.height - targetBounds.size.height) < 1
    if matchesBounds {
      return CGWindowID(windowNumber.uint32Value)
    }
  }

  return nil
}

func activeWindowMetadata() -> [String: Any] {
  var payload: [String: Any] = [
    "ok": true,
    "trusted": isTrusted()
  ]

  if let app = NSWorkspace.shared.frontmostApplication {
    if let name = app.localizedName {
      payload["appName"] = name
    }
    if let bundleIdentifier = app.bundleIdentifier {
      payload["appId"] = bundleIdentifier
    }

    if isTrusted() {
      let axApp = AXUIElementCreateApplication(app.processIdentifier)
      var focusedWindow: CFTypeRef?
      let focusedResult = AXUIElementCopyAttributeValue(axApp, kAXFocusedWindowAttribute as CFString, &focusedWindow)
      if focusedResult == .success, let window = focusedWindow {
        let windowElement = window as! AXUIElement
        if let windowId = coreGraphicsWindowId(windowElement, processIdentifier: app.processIdentifier) {
          payload["windowId"] = String(windowId)
        }
        var title: CFTypeRef?
        let titleResult = AXUIElementCopyAttributeValue(windowElement, kAXTitleAttribute as CFString, &title)
        if titleResult == .success, let titleText = title as? String, !titleText.isEmpty {
          payload["windowTitle"] = titleText
        }
      }
    }
  }

  return payload
}

private var releaseKeyCode: CGKeyCode = 0
private var releaseRequiredFlags = CGEventFlags()

func eventTapCallback(proxy: CGEventTapProxy, type: CGEventType, event: CGEvent, refcon: UnsafeMutableRawPointer?) -> Unmanaged<CGEvent>? {
  if type == .keyUp && event.getIntegerValueField(.keyboardEventKeycode) == Int64(releaseKeyCode) {
    emitJson(["event": "released"])
    fflush(stdout)
  }
  return Unmanaged.passUnretained(event)
}

func watchRelease(keyCode: CGKeyCode, modifierMask: UInt64) {
  releaseKeyCode = keyCode
  releaseRequiredFlags = CGEventFlags(rawValue: modifierMask)

  let mask = CGEventMask(1 << CGEventType.keyUp.rawValue)
  guard let tap = CGEvent.tapCreate(
    tap: .cgSessionEventTap,
    place: .headInsertEventTap,
    options: .listenOnly,
    eventsOfInterest: mask,
    callback: eventTapCallback,
    userInfo: nil
  ) else {
    emitJson(["ok": false, "trusted": isTrusted(), "error": "Unable to create CGEvent tap."])
    exit(2)
  }

  let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
  CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
  CGEvent.tapEnable(tap: tap, enable: true)
  emitJson(["ok": true, "trusted": isTrusted(), "event": "ready"])
  fflush(stdout)
  CFRunLoopRun()
}

let arguments = Array(CommandLine.arguments.dropFirst())
guard let command = arguments.first else {
  emitJson(["ok": false, "error": "Missing command."])
  exit(2)
}

switch command {
case "status":
  emitJson(["ok": true, "trusted": isTrusted()])
case "copy":
  guard isTrusted() else {
    emitJson(["ok": false, "trusted": false, "error": "Accessibility is not trusted."])
    exit(1)
  }
  emitJson(["ok": emitShortcut(keyCode: copyKeyCode, flags: .maskCommand), "trusted": true])
case "paste":
  guard isTrusted() else {
    emitJson(["ok": false, "trusted": false, "error": "Accessibility is not trusted."])
    exit(1)
  }
  emitJson(["ok": emitShortcut(keyCode: pasteKeyCode, flags: .maskCommand), "trusted": true])
case "selected-text":
  guard isTrusted() else {
    emitJson(["ok": false, "trusted": false, "error": "Accessibility is not trusted."])
    exit(1)
  }
  emitJson(["ok": true, "trusted": true, "text": selectedText() ?? ""])
case "active-window":
  emitJson(activeWindowMetadata())
case "event-tap-release":
  guard isTrusted() else {
    emitJson(["ok": false, "trusted": false, "error": "Accessibility is not trusted."])
    exit(1)
  }
  guard arguments.count >= 3,
        let keyCode = UInt16(arguments[1]),
        let modifierMask = UInt64(arguments[2]) else {
    emitJson(["ok": false, "trusted": true, "error": "event-tap-release requires key code and modifier mask."])
    exit(2)
  }
  watchRelease(keyCode: CGKeyCode(keyCode), modifierMask: modifierMask)
default:
  emitJson(["ok": false, "error": "Unknown command \(command)."])
  exit(2)
}
