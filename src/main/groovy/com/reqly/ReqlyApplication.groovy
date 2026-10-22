package com.reqly

import com.reqly.desktop.DesktopLauncher
import org.springframework.boot.SpringApplication
import org.springframework.boot.autoconfigure.SpringBootApplication

@SpringBootApplication
class ReqlyApplication {

    static void main(String[] args) {
        // The installed app sets -Dreqly.desktop=true: open the browser, show a menu-bar icon, log to a file
        if (Boolean.getBoolean("reqly.desktop")) {
            DesktopLauncher.launch(args)
            return
        }
        SpringApplication.run(ReqlyApplication, args)
    }
}
