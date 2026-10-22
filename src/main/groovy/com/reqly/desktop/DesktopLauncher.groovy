package com.reqly.desktop

import com.reqly.ReqlyApplication
import org.springframework.boot.SpringApplication
import org.springframework.boot.context.event.ApplicationReadyEvent
import org.springframework.context.ConfigurableApplicationContext

import javax.imageio.ImageIO
import java.awt.*
import java.nio.file.Files
import java.nio.file.Paths

/**
 * Starts Reqly as a desktop app: one instance per machine, opens the default browser,
 * and adds a menu-bar / system-tray icon with "Open Reqly" and "Quit".
 */
class DesktopLauncher {

    static final int PORT = 8899
    static final String URL = "http://localhost:${PORT}/".toString()

    static void launch(String[] args) {
        def dataDir = Paths.get(System.getProperty("user.home"), "reqly-data")
        Files.createDirectories(dataDir.resolve("logs"))
        System.setProperty("logging.file.name", dataDir.resolve("logs").resolve("reqly.log").toString())
        System.setProperty("apple.awt.UIElement", "true") // no Dock icon or menu: the menu-bar icon is the UI

        // Already running? Just bring it up in the browser.
        if (reqlyAlreadyRunning()) {
            openBrowser()
            return
        }

        def app = new SpringApplication(ReqlyApplication)
        app.setHeadless(false)
        // A Groovy closure listener receives every event, so filter for "ready"
        app.addListeners({ e -> if (e instanceof ApplicationReadyEvent) onReady(e.applicationContext) } as org.springframework.context.ApplicationListener)
        app.run(args)
    }

    private static void onReady(ConfigurableApplicationContext ctx) {
        installTray(ctx)
        openBrowser()
    }

    private static boolean reqlyAlreadyRunning() {
        try {
            def conn = new java.net.URL("http://127.0.0.1:${PORT}/api/auth/status").openConnection() as HttpURLConnection
            conn.connectTimeout = 800
            conn.readTimeout = 800
            return conn.responseCode == 200 && conn.inputStream.text.contains("hasUsers")
        } catch (ignored) {
            return false
        }
    }

    static void openBrowser() {
        try {
            if (Desktop.isDesktopSupported() && Desktop.desktop.isSupported(Desktop.Action.BROWSE)) {
                Desktop.desktop.browse(new URI(URL))
                return
            }
        } catch (ignored) { /* fall through to the OS command */ }
        def os = System.getProperty("os.name").toLowerCase()
        def cmd = os.contains("mac") ? ["open", URL] : os.contains("win") ? ["rundll32", "url.dll,FileProtocolHandler", URL] : ["xdg-open", URL]
        try { new ProcessBuilder(cmd).start() } catch (ignored) { System.err.println("Open ${URL} in your browser") }
    }

    private static void installTray(ConfigurableApplicationContext ctx) {
        if (GraphicsEnvironment.isHeadless() || !SystemTray.isSupported()) return
        EventQueue.invokeLater {
            try {
                def image = ImageIO.read(DesktopLauncher.getResource("/static/tray-icon.png"))
                def menu = new PopupMenu()
                def open = new MenuItem("Open Reqly")
                open.addActionListener { openBrowser() }
                def logs = new MenuItem("Show logs")
                logs.addActionListener { try { Desktop.desktop.open(new File(System.getProperty("logging.file.name")).parentFile) } catch (ignored) {} }
                def quit = new MenuItem("Quit Reqly")
                quit.addActionListener {
                    SystemTray.systemTray.trayIcons.each { SystemTray.systemTray.remove(it) }
                    System.exit(SpringApplication.exit(ctx))
                }
                menu.add(open)
                menu.add(logs)
                menu.addSeparator()
                menu.add(quit)
                def icon = new TrayIcon(image, "Reqly: running on localhost:${PORT}", menu)
                icon.imageAutoSize = true
                icon.addActionListener { openBrowser() }
                SystemTray.systemTray.add(icon)
            } catch (Exception e) {
                System.err.println("Reqly: no tray icon (${e.message})")
            }
        }
    }
}
