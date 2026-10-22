// Reqly's native macOS shell: starts the bundled Java server and shows Reqly in its own window
// (WKWebView, Safari's engine), with a Dock icon and the usual Mac menus. Quitting stops the server.
//
// Bundle layout (produced by `./gradlew packageMacApp`):
//   Contents/MacOS/Reqly              this program
//   Contents/app/reqly-<version>.jar  the server
//   Contents/runtime/Contents/Home    the Java runtime jpackage bundles

import AppKit
import WebKit

// REQLY_PORT / REQLY_JAVA_OPTS are for testing a build next to another Reqly (e.g. a different data dir)
let env = ProcessInfo.processInfo.environment
let port = Int(env["REQLY_PORT"] ?? "") ?? 8899
let baseURL = URL(string: "http://localhost:\(port)/")!
let statusURL = URL(string: "http://127.0.0.1:\(port)/api/auth/status")!
let logDir = URL(fileURLWithPath: javaProperty("reqly.data-dir") ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("reqly-data").path)
    .appendingPathComponent("logs")
let extraJavaOptions = (env["REQLY_JAVA_OPTS"] ?? "").split(separator: " ").map(String.init)

func javaProperty(_ name: String) -> String? {
    (env["REQLY_JAVA_OPTS"] ?? "").split(separator: " ").first { $0.hasPrefix("-D\(name)=") }.map { String($0.dropFirst(name.count + 3)) }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var popups: [NSWindow] = []
    var server: Process?
    var downloadTargets: [ObjectIdentifier: URL] = [:]
    var quitting = false

    func applicationDidFinishLaunching(_ note: Notification) {
        buildMenu()
        buildWindow()
        showSplash("Starting Reqly…")
        serverIsUp { up in
            if up { self.loadApp() } else { self.startServer() }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }

    func applicationShouldHandleReopen(_ app: NSApplication, hasVisibleWindows: Bool) -> Bool {
        if !hasVisibleWindows { window.makeKeyAndOrderFront(nil) }
        return true
    }

    /// Lets the page save open tabs, then stops the server we started (Spring shuts down cleanly on SIGTERM).
    func applicationShouldTerminate(_ app: NSApplication) -> NSApplication.TerminateReply {
        if quitting { return .terminateNow }
        quitting = true
        webView.evaluateJavaScript("typeof persistTabs !== 'undefined' && persistTabs.flush && persistTabs.flush()") { _, _ in
            DispatchQueue.global().async {
                if let p = self.server, p.isRunning {
                    p.terminate()
                    let deadline = Date().addingTimeInterval(15)
                    while p.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.1) }
                    if p.isRunning { kill(p.processIdentifier, SIGKILL) }
                }
                DispatchQueue.main.async { app.reply(toApplicationShouldTerminate: true) }
            }
        }
        return .terminateLater
    }

    // MARK: Server

    func serverIsUp(_ done: @escaping (Bool) -> Void) {
        var req = URLRequest(url: statusURL, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 0.8)
        req.httpMethod = "GET"
        URLSession.shared.dataTask(with: req) { data, resp, _ in
            let ok = (resp as? HTTPURLResponse)?.statusCode == 200
                && String(data: data ?? Data(), encoding: .utf8)?.contains("hasUsers") == true
            DispatchQueue.main.async { done(ok) }
        }.resume()
    }

    func startServer() {
        let contents = Bundle.main.bundleURL.appendingPathComponent("Contents")
        let java = contents.appendingPathComponent("runtime/Contents/Home/bin/java")
        let appDir = contents.appendingPathComponent("app")
        let jar = (try? FileManager.default.contentsOfDirectory(at: appDir, includingPropertiesForKeys: nil))?
            .first { $0.pathExtension == "jar" }
        guard FileManager.default.isExecutableFile(atPath: java.path), let jar = jar else {
            return fail("This copy of Reqly is incomplete (no Java runtime or server found). Reinstall Reqly.")
        }
        try? FileManager.default.createDirectory(at: logDir, withIntermediateDirectories: true)
        let p = Process()
        p.executableURL = java
        p.arguments = ["-Dreqly.desktop=true", "-Dreqly.native=true",
                       "-Dreqly.parentPid=\(ProcessInfo.processInfo.processIdentifier)",
                       "-Dapple.awt.UIElement=true", "-Djava.awt.headless=true", "-Xmx768m"]
            + extraJavaOptions + ["-jar", jar.path, "--server.port=\(port)"]
        p.currentDirectoryURL = FileManager.default.homeDirectoryForCurrentUser
        let console = logDir.appendingPathComponent("console.log")
        FileManager.default.createFile(atPath: console.path, contents: nil)
        if let h = try? FileHandle(forWritingTo: console) { p.standardOutput = h; p.standardError = h }
        p.terminationHandler = { proc in
            DispatchQueue.main.async {
                if !self.quitting { self.fail("Reqly's server stopped (exit code \(proc.terminationStatus)). Another app may be using port \(port).") }
            }
        }
        do { try p.run() } catch { return fail("Could not start Reqly's server: \(error.localizedDescription)") }
        server = p
        waitForServer(until: Date().addingTimeInterval(90))
    }

    func waitForServer(until deadline: Date) {
        serverIsUp { up in
            if up { return self.loadApp() }
            if self.server?.isRunning != true { return }
            if Date() > deadline { return self.fail("Reqly's server did not start within 90 seconds.") }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { self.waitForServer(until: deadline) }
        }
    }

    func loadApp() { webView.load(URLRequest(url: baseURL)) }

    func fail(_ message: String) {
        showSplash(message, error: true)
    }

    // MARK: Window

    func buildWindow() {
        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "developerExtrasEnabled") // right-click → Inspect Element
        webView = makeWebView(config)
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1400, height: 900),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "Reqly"
        window.minSize = NSSize(width: 900, height: 560)
        window.backgroundColor = NSColor(red: 0.04, green: 0.05, blue: 0.09, alpha: 1)
        window.contentView = webView
        window.center()
        window.setFrameAutosaveName("ReqlyMainWindow")
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func makeWebView(_ config: WKWebViewConfiguration) -> WKWebView {
        let wv = WKWebView(frame: .zero, configuration: config)
        wv.navigationDelegate = self
        wv.uiDelegate = self
        wv.allowsMagnification = true
        wv.setValue(false, forKey: "drawsBackground")
        if #available(macOS 13.3, *) { wv.isInspectable = true }
        return wv
    }

    func showSplash(_ text: String, error: Bool = false) {
        let esc = text.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
        let extra = error ? "<p><a href=\"reqly-shell:logs\">Show logs</a> · <a href=\"reqly-shell:retry\">Try again</a></p>" : "<div class=s></div>"
        webView.loadHTMLString("""
            <!doctype html><meta charset=utf-8><style>
            html{height:100%;background:#0a0d17;color:#c9d4f2;font:15px -apple-system,system-ui;display:flex;align-items:center;justify-content:center}
            body{text-align:center;max-width:520px} a{color:#7cc4ff} p{color:\(error ? "#ff8a8a" : "#c9d4f2")}
            .s{width:28px;height:28px;margin:18px auto;border:3px solid #24314f;border-top-color:#7cc4ff;border-radius:50%;animation:r .8s linear infinite}
            @keyframes r{to{transform:rotate(360deg)}}</style><body><p>\(esc)</p>\(extra)</body>
            """, baseURL: nil)
    }

    // MARK: Navigation: the app stays in the window, everything else opens in the default browser

    func isApp(_ url: URL?) -> Bool {
        guard let url = url else { return false }
        return (url.host == "localhost" || url.host == "127.0.0.1") && url.port == port
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.cancel) }
        if url.scheme == "reqly-shell" {
            decisionHandler(.cancel)
            if url.absoluteString.hasSuffix("logs") { NSWorkspace.shared.open(logDir) }
            else { showSplash("Starting Reqly…"); serverIsUp { up in up ? self.loadApp() : self.startServer() } }
            return
        }
        if action.shouldPerformDownload { return decisionHandler(.download) }
        if isApp(url) || url.scheme == "about" || url.scheme == "blob" || url.scheme == "data" { return decisionHandler(.allow) }
        if action.navigationType == .linkActivated || action.targetFrame?.isMainFrame == true {
            NSWorkspace.shared.open(url)
            return decisionHandler(.cancel)
        }
        decisionHandler(.allow) // subframes, e.g. the sandboxed script and HTML-preview frames
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(response.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { loadFailed(error) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { loadFailed(error) }
    func loadFailed(_ error: Error) {
        let code = (error as NSError).code
        if code == NSURLErrorCancelled || code == 102 /* frame load interrupted: became a download */ { return }
        fail("Could not load Reqly: \(error.localizedDescription)")
    }

    /// window.open / target=_blank: Reqly pages (admin, privacy…) get their own window, other sites the browser.
    func webView(_ webView: WKWebView, createWebViewWith config: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard let url = action.request.url, isApp(url) else {
            if let url = action.request.url { NSWorkspace.shared.open(url) }
            return nil
        }
        let wv = makeWebView(config)
        let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1200, height: 820),
                         styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        w.title = url.path == "/admin" ? "Reqly Admin" : "Reqly"
        w.contentView = wv
        w.isReleasedWhenClosed = false
        w.cascadeTopLeft(from: window.frame.origin)
        w.center()
        w.makeKeyAndOrderFront(nil)
        popups.append(w)
        NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: w, queue: .main) { [weak self] _ in
            self?.popups.removeAll { $0 === w }
        }
        return wv
    }

    func webViewDidClose(_ webView: WKWebView) { webView.window?.close() }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if let title = webView.title, !title.isEmpty, let w = webView.window, w !== window || isApp(webView.url) {
            w.title = title.replacingOccurrences(of: " — API Testing", with: "")
        }
    }

    // MARK: File pickers and JS dialogs

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = false
        panel.beginSheetModal(for: webView.window ?? window) { r in completionHandler(r == .OK ? panel.urls : nil) }
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = NSAlert(); a.messageText = message; a.runModal(); completionHandler()
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = NSAlert(); a.messageText = message; a.addButton(withTitle: "OK"); a.addButton(withTitle: "Cancel")
        completionHandler(a.runModal() == .alertFirstButtonReturn)
    }

    // MARK: Downloads (exports, saved responses, runner reports)

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                  suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedFilename
        panel.directoryURL = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
        panel.beginSheetModal(for: NSApp.keyWindow ?? window) { r in
            guard r == .OK, let url = panel.url else { return completionHandler(nil) }
            try? FileManager.default.removeItem(at: url) // the panel already asked about replacing it
            self.downloadTargets[ObjectIdentifier(download)] = url
            completionHandler(url)
        }
    }

    func downloadDidFinish(_ download: WKDownload) {
        if let url = downloadTargets.removeValue(forKey: ObjectIdentifier(download)) {
            NSWorkspace.shared.activateFileViewerSelecting([url])
        }
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloadTargets.removeValue(forKey: ObjectIdentifier(download))
        let a = NSAlert(); a.messageText = "Download failed"; a.informativeText = error.localizedDescription; a.runModal()
    }

    // MARK: Menus

    func buildMenu() {
        let main = NSMenu()
        func add(_ title: String, _ items: [NSMenuItem]) {
            let item = NSMenuItem(); let menu = NSMenu(title: title)
            items.forEach(menu.addItem); item.submenu = menu; main.addItem(item)
        }
        func item(_ title: String, _ action: Selector?, _ key: String = "", _ mods: NSEvent.ModifierFlags = .command) -> NSMenuItem {
            let i = NSMenuItem(title: title, action: action, keyEquivalent: key); i.keyEquivalentModifierMask = mods; return i
        }
        add("Reqly", [
            item("About Reqly", #selector(NSApplication.orderFrontStandardAboutPanel(_:))),
            .separator(),
            item("Hide Reqly", #selector(NSApplication.hide(_:)), "h"),
            item("Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
            item("Show All", #selector(NSApplication.unhideAllApplications(_:))),
            .separator(),
            item("Quit Reqly", #selector(NSApplication.terminate(_:)), "q"),
        ])
        add("File", [
            item("New Tab", #selector(newTab), "t"),
            item("Close Tab", #selector(closeTab), "w"),
            item("Close Window", #selector(NSWindow.performClose(_:)), "w", [.command, .shift]),
        ])
        add("Edit", [
            item("Undo", Selector(("undo:")), "z"),
            item("Redo", Selector(("redo:")), "z", [.command, .shift]),
            .separator(),
            item("Cut", #selector(NSText.cut(_:)), "x"),
            item("Copy", #selector(NSText.copy(_:)), "c"),
            item("Paste", #selector(NSText.paste(_:)), "v"),
            item("Select All", #selector(NSText.selectAll(_:)), "a"),
        ])
        add("View", [
            item("Reload", #selector(reload), "r"),
            .separator(),
            item("Actual Size", #selector(zoomReset), "0"),
            item("Zoom In", #selector(zoomIn), "+"),
            item("Zoom Out", #selector(zoomOut), "-"),
            .separator(),
            item("Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]),
        ])
        let windowMenu = [item("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"),
                          item("Zoom", #selector(NSWindow.performZoom(_:))),
                          .separator(),
                          item("Bring All to Front", #selector(NSApplication.arrangeInFront(_:)))]
        add("Window", windowMenu)
        NSApp.windowsMenu = main.items.last?.submenu
        add("Help", [
            item("Show Logs", #selector(showLogs)),
            item("Open in Browser", #selector(openInBrowser)),
        ])
        NSApp.mainMenu = main
    }

    var activeWebView: WKWebView { (NSApp.keyWindow?.contentView as? WKWebView) ?? webView }

    /// ⌘T / ⌘W act on Reqly's own request tabs in the main window; ⌘W closes other windows.
    @objc func newTab() { webView.evaluateJavaScript("typeof newTab === 'function' && newTab()") }
    @objc func closeTab() {
        if NSApp.keyWindow !== window { NSApp.keyWindow?.performClose(nil); return }
        webView.evaluateJavaScript("typeof closeTab === 'function' && state.activeTabId != null && !document.querySelector('.modal-overlay.active') && closeTab(state.activeTabId)")
    }
    @objc func reload() { activeWebView.reload() }
    @objc func zoomIn() { activeWebView.pageZoom = min(2.0, activeWebView.pageZoom + 0.1) }
    @objc func zoomOut() { activeWebView.pageZoom = max(0.5, activeWebView.pageZoom - 0.1) }
    @objc func zoomReset() { activeWebView.pageZoom = 1.0 }
    @objc func showLogs() { NSWorkspace.shared.open(logDir) }
    @objc func openInBrowser() { NSWorkspace.shared.open(activeWebView.url.flatMap { isApp($0) ? $0 : nil } ?? baseURL) }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
