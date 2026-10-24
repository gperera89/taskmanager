import SwiftUI

@main
struct CuraApp: App {
    @StateObject private var store = Store()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(store)
                .frame(minWidth: 900, minHeight: 580)
        }
        .defaultSize(width: 1160, height: 760)

        Settings {
            SettingsView()
                .environmentObject(store)
        }
    }
}
